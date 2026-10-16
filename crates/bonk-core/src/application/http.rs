use crate::domain::http::{cookie_host_excluded, HttpRequest, HttpResponse, RequestSettings};
use crate::domain::url::normalize_url;
use crate::infra::cookie_jar::CookieJar;
use crate::infra::reqwest_client::build_request_to;
use std::collections::BTreeMap;
use std::time::Instant;

/// Send `req`. `jar` is the cookie jar `client` was built with: the response then reports
/// its `Set-Cookie`s and what they did to the jar.
pub async fn http_send(
    client: reqwest::Client,
    req: HttpRequest,
    settings: RequestSettings,
    jar: Option<&CookieJar>,
) -> Result<HttpResponse, String> {
    let settings = settings.normalized();
    let jar_before = jar.map(CookieJar::list);
    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
        .map_err(|e| format!("bad method: {e}"))?;
    let request_url = normalize_url(&req.url);
    let request = build_request_to(&client, &req, method, &request_url)?;
    let start = Instant::now();
    let resp = client.execute(request).await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();
    // A repeated header (several Set-Cookie, Vary…) is one comma-joined entry, as HTTP
    // allows; collecting straight into the map would keep only the last one.
    let mut headers: BTreeMap<String, String> = BTreeMap::new();
    for (k, v) in resp.headers() {
        let v = v.to_str().unwrap_or("");
        headers
            .entry(k.to_string())
            .and_modify(|e| {
                e.push_str(", ");
                e.push_str(v);
            })
            .or_insert_with(|| v.to_string());
    }
    let set_cookies: Vec<String> = resp
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok().map(str::to_string))
        .collect();
    // Read raw bytes so the size reflects the real (decompressed) body length and
    // non-UTF-8/binary bodies don't get mis-measured; decode lossily for display.
    // Keep this bounded so very large responses do not freeze the editor.
    let (bytes, body_truncated) = read_body_limited(resp, settings.max_response_body_bytes).await?;
    let size_bytes = bytes.len();
    let body = String::from_utf8_lossy(&bytes).into_owned();
    let (cookies, jar_sends) = match (jar, jar_before) {
        (Some(jar), Some(before)) => {
            let excluded = reqwest::Url::parse(&final_url).is_ok_and(|u| {
                u.host_str()
                    .is_some_and(|h| cookie_host_excluded(h, &settings.cookies_exclude))
            });
            let saved = settings.cookies_save && !excluded;
            let sends = if excluded {
                0
            } else {
                jar.sends_to(&final_url)
            };
            (
                CookieJar::response_cookies(&set_cookies, &final_url, &before, saved),
                settings.cookies_send.then_some(sends),
            )
        }
        _ => (Vec::new(), None),
    };
    Ok(HttpResponse {
        status,
        headers,
        body,
        final_url,
        elapsed_ms: start.elapsed().as_millis() as u64,
        size_bytes,
        body_truncated,
        cookies,
        jar_sends,
        events: Vec::new(),
        stream_end: None,
    })
}

async fn read_body_limited(
    mut resp: reqwest::Response,
    max_bytes: usize,
) -> Result<(Vec<u8>, bool), String> {
    // Reject up front when the advertised Content-Length already exceeds the cap,
    // so a hostile/huge response can't make us buffer up to `max_bytes` of body
    // before we notice. This is an optimization on top of the per-chunk streaming
    // truncation below, which remains the fallback for chunked/unknown-length
    // responses (and for servers that lie about Content-Length).
    if let Some(len) = resp.content_length() {
        if len > max_bytes as u64 {
            return Ok((Vec::new(), true));
        }
    }
    let mut out = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        let remaining = max_bytes.saturating_sub(out.len());
        if remaining == 0 {
            truncated = true;
            break;
        }
        if chunk.len() > remaining {
            out.extend_from_slice(&chunk[..remaining]);
            truncated = true;
            break;
        }
        out.extend_from_slice(&chunk);
    }
    Ok((out, truncated))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    #[ignore = "network smoke test against public google.com"]
    fn google_reused_client_smoke() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let client = reqwest::Client::builder()
                .pool_max_idle_per_host(16)
                .tcp_nodelay(true)
                .build()
                .unwrap();
            let req = HttpRequest {
                method: "GET".into(),
                url: "https://google.com".into(),
                headers: BTreeMap::new(),
                body: None,
                graphql_variables: None,
                binary_file_path: None,
                body_mode: None,
                raw_body_format: None,
                body_params: None,
                auth: None,
                pre_request_script: None,
                test_script: None,
                header_notes: None,
                disabled_headers: None,
            };
            let first = http_send(
                client.clone(),
                req.clone(),
                RequestSettings::default(),
                None,
            )
            .await
            .unwrap();
            let second = http_send(client, req, RequestSettings::default(), None)
                .await
                .unwrap();
            println!(
                "google first={}ms second={}ms size={}B",
                first.elapsed_ms, second.elapsed_ms, second.size_bytes
            );
            assert!(first.status < 500);
            assert!(second.status < 500);
        });
    }
}
