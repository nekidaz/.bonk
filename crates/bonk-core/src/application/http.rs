use crate::domain::http::{cookie_host_excluded, HttpRequest, HttpResponse, RequestSettings};
use crate::domain::sse::{is_event_stream, SseEvent, SseParser, StreamEnd, StreamEndReason};
use crate::domain::url::normalize_url;
use crate::infra::cookie_jar::CookieJar;
use crate::infra::metrics::{NetProto, METRICS};
use crate::infra::reqwest_client::build_request_to;
use std::collections::BTreeMap;
use std::future::Future;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Live mode (a single send from the editor): no deadline on the body, events as they come.
pub struct StreamHooks<'a> {
    /// Headers arrived and the response is a stream (called before the first event), with the
    /// same `started_at_ms` that ends up in `StreamEnd`.
    pub on_open: &'a (dyn Fn(u64) + Sync),
    pub on_event: &'a (dyn Fn(&SseEvent) + Sync),
    /// `true` ends the stream softly (`StreamEndReason::Stopped`). A dropped sender is not a stop.
    pub stop: tokio::sync::watch::Receiver<bool>,
}

/// Send `req`. `jar` is the cookie jar `client` was built with: the response then reports
/// its `Set-Cookie`s and what they did to the jar.
pub async fn http_send(
    client: reqwest::Client,
    req: HttpRequest,
    settings: RequestSettings,
    jar: Option<&CookieJar>,
) -> Result<HttpResponse, String> {
    http_send_with(client, req, settings, jar, None).await
}

/// `http_send`, plus live streaming of `text/event-stream` responses when `live` is set.
/// `settings.timeout_ms` is a deadline for the whole request (headers and body) counted
/// from the start; a headless event stream that hits it ends with `Timeout` and keeps
/// what it got, while a live one ignores it once the headers are in.
pub async fn http_send_with(
    client: reqwest::Client,
    req: HttpRequest,
    settings: RequestSettings,
    jar: Option<&CookieJar>,
    live: Option<StreamHooks<'_>>,
) -> Result<HttpResponse, String> {
    let settings = settings.normalized();
    let jar_before = jar.map(CookieJar::list);
    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
        .map_err(|e| format!("bad method: {e}"))?;
    let request_url = normalize_url(&req.url);
    let request = build_request_to(&client, &req, method, &request_url)?;
    let start = Instant::now();
    let started_at_ms = now_ms();
    // 0 means "no timeout", like before.
    let deadline = (settings.timeout_ms > 0)
        .then(|| tokio::time::Instant::now() + Duration::from_millis(settings.timeout_ms));
    let timed_out = || format!("request timed out after {} ms", settings.timeout_ms);
    let resp = until(deadline, client.execute(request))
        .await
        .ok_or_else(timed_out)?
        .map_err(|e| e.to_string())?;
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
    let is_stream = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(is_event_stream);
    // Read raw bytes so the size reflects the real (decompressed) body length and
    // non-UTF-8/binary bodies don't get mis-measured; decode lossily for display.
    // Keep this bounded so very large responses do not freeze the editor.
    let (bytes, body_truncated, events, stream_end) = if is_stream {
        let s = read_stream(
            resp,
            settings.max_response_body_bytes,
            deadline,
            started_at_ms,
            live,
        )
        .await;
        let end = StreamEnd {
            reason: s.reason,
            started_at_ms,
            error: s.error,
        };
        let truncated = s.reason == StreamEndReason::Truncated;
        (s.body, truncated, s.events, Some(end))
    } else {
        let (bytes, truncated) = until(
            deadline,
            read_body_limited(resp, settings.max_response_body_bytes),
        )
        .await
        .ok_or_else(timed_out)??;
        (bytes, truncated, Vec::new(), None)
    };
    let size_bytes = bytes.len();
    METRICS.record_net(
        if is_stream {
            NetProto::Sse
        } else {
            NetProto::Http
        },
        (req.url.len() + req.body.as_ref().map_or(0, String::len)) as u64,
        size_bytes as u64,
    );
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
        events,
        stream_end,
    })
}

/// Epoch milliseconds, for event and stream timestamps.
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Run `fut` to completion, or give up at `deadline` (`None`). No deadline: just run it.
async fn until<F: Future>(deadline: Option<tokio::time::Instant>, fut: F) -> Option<F::Output> {
    match deadline {
        Some(d) => tokio::time::timeout_at(d, fut).await.ok(),
        None => Some(fut.await),
    }
}

/// Resolves at `deadline`; never when there is none.
async fn sleep_until(deadline: Option<tokio::time::Instant>) {
    match deadline {
        Some(d) => tokio::time::sleep_until(d).await,
        None => std::future::pending().await,
    }
}

/// Resolves once the stop flag is `true`. No receiver, or its sender is gone: never
/// (a dropped sender means nobody can stop us, not "stop").
async fn stopped(stop: &mut Option<tokio::sync::watch::Receiver<bool>>) {
    if let Some(rx) = stop {
        if rx.wait_for(|v| *v).await.is_ok() {
            return;
        }
    }
    std::future::pending().await
}

struct StreamRead {
    body: Vec<u8>,
    events: Vec<SseEvent>,
    reason: StreamEndReason,
    error: Option<String>,
}

/// Read a `text/event-stream` body until the server closes it, the body limit is hit,
/// a read fails, the deadline passes (headless only) or the caller stops it (live only).
/// Only the bytes kept under `max_bytes` go to the parser, so memory stays bounded by
/// the body limit.
async fn read_stream(
    mut resp: reqwest::Response,
    max_bytes: usize,
    deadline: Option<tokio::time::Instant>,
    started_at_ms: u64,
    live: Option<StreamHooks<'_>>,
) -> StreamRead {
    let (on_event, mut stop, deadline) = match live {
        Some(hooks) => {
            (hooks.on_open)(started_at_ms);
            (Some(hooks.on_event), Some(hooks.stop), None)
        }
        None => (None, None, deadline),
    };
    let mut parser = SseParser::default();
    let mut body = Vec::new();
    let mut events = Vec::new();
    let mut error = None;
    let emit = |ev: SseEvent, events: &mut Vec<SseEvent>| {
        if let Some(on_event) = on_event {
            on_event(&ev);
        }
        events.push(ev);
    };
    let reason = loop {
        // Like Go's `select`: whichever happens first wins; the losers are dropped.
        let chunk = tokio::select! {
            chunk = resp.chunk() => chunk,
            () = sleep_until(deadline) => break StreamEndReason::Timeout,
            () = stopped(&mut stop) => break StreamEndReason::Stopped,
        };
        let chunk = match chunk {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break StreamEndReason::Closed,
            Err(e) => {
                error = Some(e.to_string());
                break StreamEndReason::Error;
            }
        };
        let room = max_bytes.saturating_sub(body.len());
        let kept = &chunk[..chunk.len().min(room)];
        body.extend_from_slice(kept);
        for ev in parser.push(kept, now_ms()) {
            emit(ev, &mut events);
        }
        if kept.len() < chunk.len() {
            break StreamEndReason::Truncated;
        }
    };
    if let Some(ev) = parser.finish(now_ms()) {
        emit(ev, &mut events);
    }
    StreamRead {
        body,
        events,
        reason,
        error,
    }
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
    use crate::domain::sse::{SseEvent, StreamEndReason};
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// What the fake server does after reading the request.
    enum Step {
        Write(Vec<u8>),
        Sleep(u64),
    }

    fn write(s: &str) -> Step {
        Step::Write(s.as_bytes().to_vec())
    }

    /// One-connection HTTP/1.1 server on 127.0.0.1 that plays `steps` and then
    /// closes the socket. Returns the URL to request.
    async fn serve(steps: Vec<Step>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            // Read the request head first: closing with unread bytes would send RST.
            let mut head = Vec::new();
            let mut buf = [0u8; 1024];
            while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                match sock.read(&mut buf).await {
                    Ok(0) | Err(_) => return,
                    Ok(n) => head.extend_from_slice(&buf[..n]),
                }
            }
            for step in steps {
                match step {
                    Step::Write(bytes) => {
                        // The client hung up (stop, truncation): nothing more to do.
                        if sock.write_all(&bytes).await.is_err() {
                            return;
                        }
                    }
                    Step::Sleep(ms) => tokio::time::sleep(Duration::from_millis(ms)).await,
                }
            }
        });
        format!("http://{addr}/")
    }

    const SSE_HEAD: &str = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n";

    fn get(url: &str) -> HttpRequest {
        HttpRequest {
            method: "GET".into(),
            url: url.into(),
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
        }
    }

    fn with_timeout(timeout_ms: u64) -> RequestSettings {
        RequestSettings {
            timeout_ms,
            ..RequestSettings::default()
        }
    }

    #[tokio::test]
    async fn stream_closed_by_server() {
        let url = serve(vec![
            write(SSE_HEAD),
            write("data: a\n\n"),
            Step::Sleep(50),
            write("data: b\n\n"),
        ])
        .await;
        let r = http_send(reqwest::Client::new(), get(&url), with_timeout(5_000), None)
            .await
            .unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(r.events.len(), 2);
        assert_eq!(r.events[1].data, "b");
        assert_eq!(r.stream_end.unwrap().reason, StreamEndReason::Closed);
        assert_eq!(r.body, "data: a\n\ndata: b\n\n");
    }

    #[tokio::test]
    async fn headless_stream_ends_on_timeout_with_events() {
        let url = serve(vec![
            write(SSE_HEAD),
            write("data: a\n\n"),
            Step::Sleep(10_000),
        ])
        .await;
        let start = Instant::now();
        let r = http_send(reqwest::Client::new(), get(&url), with_timeout(300), None)
            .await
            .unwrap();
        assert!(start.elapsed() < Duration::from_secs(2));
        assert_eq!(r.events.len(), 1);
        assert_eq!(r.stream_end.unwrap().reason, StreamEndReason::Timeout);
    }

    #[tokio::test]
    async fn live_stream_ignores_timeout_and_stops_softly() {
        let mut steps = vec![write(SSE_HEAD), write("data: a\n\n")];
        for _ in 0..50 {
            steps.push(Step::Sleep(100));
            steps.push(write(": ping\n"));
        }
        let url = serve(steps).await;
        let opened = AtomicUsize::new(0);
        let opened_at = AtomicU64::new(0);
        let seen = AtomicUsize::new(0);
        let on_open = |at: u64| {
            opened.fetch_add(1, Ordering::SeqCst);
            opened_at.store(at, Ordering::SeqCst);
        };
        let on_event = |_: &SseEvent| {
            seen.fetch_add(1, Ordering::SeqCst);
        };
        let (stop_tx, stop) = tokio::sync::watch::channel(false);
        let hooks = StreamHooks {
            on_open: &on_open,
            on_event: &on_event,
            stop,
        };
        let stopper = async {
            tokio::time::sleep(Duration::from_millis(600)).await;
            stop_tx.send(true).unwrap();
        };
        let (r, ()) = tokio::join!(
            http_send_with(
                reqwest::Client::new(),
                get(&url),
                with_timeout(200),
                None,
                Some(hooks),
            ),
            stopper
        );
        let r = r.unwrap();
        let end = r.stream_end.unwrap();
        assert_eq!(end.reason, StreamEndReason::Stopped);
        assert_eq!(r.events.len(), 1);
        assert_eq!(opened.load(Ordering::SeqCst), 1);
        // The live feed and the finished response share one start time.
        assert_eq!(opened_at.load(Ordering::SeqCst), end.started_at_ms);
        assert_eq!(seen.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn stream_cut_mid_way_keeps_events() {
        let url = serve(vec![
            write(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
                 Transfer-Encoding: chunked\r\n\r\n",
            ),
            write("9\r\ndata: a\n\n\r\n"),
            // Announces 32 bytes, sends 9 (no `data`, so no half event), hangs up.
            write("20\r\nevent: x\n"),
        ])
        .await;
        let r = http_send(reqwest::Client::new(), get(&url), with_timeout(5_000), None)
            .await
            .unwrap();
        assert_eq!(r.events.len(), 1);
        let end = r.stream_end.unwrap();
        assert_eq!(end.reason, StreamEndReason::Error);
        assert!(end.error.is_some());
    }

    #[tokio::test]
    async fn stream_truncated_at_body_limit() {
        // The limit can't go below 1 MiB (`RequestSettings::normalized`), so the
        // events are big: three of ~400 KB overflow it.
        let limit = 1024 * 1024;
        let event = format!("data: {}\n\n", "x".repeat(400_000));
        let url = serve(vec![
            write(SSE_HEAD),
            write(&event),
            write(&event),
            write(&event),
        ])
        .await;
        let settings = RequestSettings {
            max_response_body_bytes: limit,
            ..with_timeout(5_000)
        };
        let r = http_send(reqwest::Client::new(), get(&url), settings, None)
            .await
            .unwrap();
        assert_eq!(r.stream_end.unwrap().reason, StreamEndReason::Truncated);
        assert!(r.body_truncated);
        assert!(r.body.len() <= limit);
        assert!(r.events.len() >= 2);
    }

    #[tokio::test]
    async fn plain_response_times_out_on_headers() {
        let url = serve(vec![Step::Sleep(10_000)]).await;
        let e = http_send(reqwest::Client::new(), get(&url), with_timeout(200), None)
            .await
            .unwrap_err();
        assert_eq!(e, "request timed out after 200 ms");
    }

    #[tokio::test]
    async fn plain_response_times_out_on_body() {
        let url = serve(vec![
            write(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n",
            ),
            write("{\"a\": 1234"),
            Step::Sleep(10_000),
        ])
        .await;
        let e = http_send(reqwest::Client::new(), get(&url), with_timeout(200), None)
            .await
            .unwrap_err();
        assert_eq!(e, "request timed out after 200 ms");
    }

    #[tokio::test]
    async fn plain_response_has_no_stream_fields() {
        let url = serve(vec![write(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 8\r\n\r\n{\"a\": 1}",
        )])
        .await;
        let r = http_send(reqwest::Client::new(), get(&url), with_timeout(5_000), None)
            .await
            .unwrap();
        assert!(r.events.is_empty());
        assert!(r.stream_end.is_none());
        assert_eq!(r.body, "{\"a\": 1}");
    }

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
