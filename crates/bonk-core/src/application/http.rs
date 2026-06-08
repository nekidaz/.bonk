use crate::domain::http::{HttpRequest, HttpResponse, RequestSettings};
use crate::domain::url::normalize_url;
use crate::infra::reqwest_client::build_request_to;
use std::collections::BTreeMap;
use std::time::Instant;

pub async fn http_send(
    client: reqwest::Client,
    req: HttpRequest,
    settings: RequestSettings,
) -> Result<HttpResponse, String> {
    let settings = settings.normalized();
    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
        .map_err(|e| format!("bad method: {e}"))?;
    let request_url = normalize_url(&req.url);
    let request = build_request_to(&client, &req, method, &request_url)?;
    let start = Instant::now();
    let resp = client.execute(request).await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();
    let headers: BTreeMap<String, String> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    // Read raw bytes so the size reflects the real (decompressed) body length and
    // non-UTF-8/binary bodies don't get mis-measured; decode lossily for display.
    // Keep this bounded so very large responses do not freeze the editor.
    let (bytes, body_truncated) = read_body_limited(resp, settings.max_response_body_bytes).await?;
    let size_bytes = bytes.len();
    let body = String::from_utf8_lossy(&bytes).into_owned();
    Ok(HttpResponse {
        status,
        headers,
        body,
        final_url,
        elapsed_ms: start.elapsed().as_millis() as u64,
        size_bytes,
        body_truncated,
    })
}

async fn read_body_limited(
    mut resp: reqwest::Response,
    max_bytes: usize,
) -> Result<(Vec<u8>, bool), String> {
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
                body_mode: None,
                raw_body_format: None,
                body_params: None,
                auth: None,
            };
            let first = http_send(client.clone(), req.clone(), RequestSettings::default())
                .await
                .unwrap();
            let second = http_send(client, req, RequestSettings::default())
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
