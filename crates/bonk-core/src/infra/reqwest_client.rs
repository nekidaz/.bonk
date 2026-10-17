use crate::domain::http::{BodyParam, HttpRequest};
use std::path::Path;

/// Upper bound on a single multipart form-data file. Building the request reads
/// the file into memory, so without a cap a large attachment could exhaust RAM.
/// Kept in the same order of magnitude as the HTTP response body cap.
const MAX_FORM_FILE_BYTES: u64 = 100 * 1024 * 1024;

pub fn build_request_to(
    client: &reqwest::Client,
    req: &HttpRequest,
    method: reqwest::Method,
    url: &str,
) -> Result<reqwest::Request, String> {
    let is_multipart = req.body_mode.as_deref() == Some("form-data");
    let mut rb = client.request(method, url);
    let disabled = req.disabled_headers.as_deref().unwrap_or_default();
    for (k, v) in &req.headers {
        if (is_multipart && k.eq_ignore_ascii_case("content-type")) || disabled.contains(k) {
            continue;
        }
        rb = rb.header(k, v);
    }
    if is_multipart {
        if let Some(form) = build_multipart_form(req)? {
            rb = rb.multipart(form);
        }
    } else if req.body_mode.as_deref() == Some("binary") {
        if let Some(path) = req
            .binary_file_path
            .as_deref()
            .filter(|path| !path.trim().is_empty())
        {
            rb = rb.body(read_upload(path, "binary file")?);
        } else if let Some(body) = &req.body {
            rb = rb.body(body.clone());
        }
    } else if let Some(body) = &req.body {
        rb = rb.body(body.clone());
    }
    rb.build()
        .map_err(|e| format!("request error: {}", error_text(&e)))
}

/// A network error with its causes: reqwest's own text is only «error sending request»,
/// the DNS / refused / TLS reason sits in `source()` (like unwrapping Go's wrapped errors).
/// The URL is left out, the caller shows it already.
pub fn net_error(e: reqwest::Error) -> String {
    error_text(&e.without_url())
}

/// `e: cause: cause…`, skipping a cause whose text the previous one already includes.
pub fn error_text(e: &dyn std::error::Error) -> String {
    let mut out = e.to_string();
    let mut last = out.clone();
    let mut source = e.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !last.contains(&text) {
            out.push_str(": ");
            out.push_str(&text);
        }
        last = text;
        source = cause.source();
    }
    out
}

/// Read a request-body file into memory, rejecting oversized files by metadata
/// first so a huge attachment can't OOM the process. Regular files only:
/// `/dev/zero` or a FIFO reports size 0, passes the cap and reads (or blocks) forever.
// ponytail: trusts metadata().len(); a Linux /proc file that under-reports its
// size can still read past the cap — switch to File::take if that ever matters.
fn read_upload(path: &str, what: &str) -> Result<Vec<u8>, String> {
    let failed = |e: std::io::Error| format!("failed to read {what} '{path}': {e}");
    let meta = std::fs::metadata(path).map_err(failed)?;
    if !meta.is_file() {
        return Err(format!("{what} '{path}' is not a regular file"));
    }
    if meta.len() > MAX_FORM_FILE_BYTES {
        return Err(format!(
            "{what} '{path}' is {} bytes, larger than the {MAX_FORM_FILE_BYTES}-byte limit",
            meta.len()
        ));
    }
    std::fs::read(path).map_err(failed)
}

fn enabled_body_params(req: &HttpRequest) -> impl Iterator<Item = &BodyParam> {
    req.body_params
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
}

fn form_file_path(row: &BodyParam) -> Option<&str> {
    row.file_path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .or_else(|| {
            let value = row.value.trim();
            (!value.is_empty()).then_some(value)
        })
}

fn build_multipart_form(req: &HttpRequest) -> Result<Option<reqwest::multipart::Form>, String> {
    let mut form = reqwest::multipart::Form::new();
    let mut any = false;
    for row in enabled_body_params(req) {
        any = true;
        if row.kind.as_deref() == Some("file") {
            let path = form_file_path(row)
                .filter(|path| !path.is_empty())
                .ok_or_else(|| format!("form-data file '{}' has no file selected", row.key))?;
            let bytes = read_upload(path, "form-data file")?;
            let filename = Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("file")
                .to_string();
            let part = reqwest::multipart::Part::bytes(bytes).file_name(filename);
            form = form.part(row.key.clone(), part);
        } else {
            form = form.text(row.key.clone(), row.value.clone());
        }
    }
    Ok(any.then_some(form))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn build_request_sets_method_url_headers() {
        let client = reqwest::Client::new();
        let mut headers = BTreeMap::new();
        headers.insert("x-test".into(), "1".into());
        let req = HttpRequest {
            method: "post".into(),
            url: "https://example.com/api".into(),
            headers,
            body: Some("{}".into()),
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
        let built = build_request_to(&client, &req, reqwest::Method::POST, &req.url).unwrap();
        assert_eq!(built.method().as_str(), "POST");
        assert_eq!(built.url().as_str(), "https://example.com/api");
        assert_eq!(built.headers().get("x-test").unwrap(), "1");
    }

    #[test]
    fn build_request_reads_binary_file_bytes() {
        let path = std::env::temp_dir().join(format!(
            "bonk-binary-body-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let bytes = [0, 255, 10, 42];
        std::fs::write(&path, bytes).unwrap();
        let req = HttpRequest {
            method: "POST".into(),
            url: "https://example.com/upload".into(),
            headers: BTreeMap::new(),
            body: None,
            graphql_variables: None,
            binary_file_path: Some(path.to_string_lossy().into_owned()),
            body_mode: Some("binary".into()),
            raw_body_format: None,
            body_params: None,
            auth: None,
            pre_request_script: None,
            test_script: None,
            header_notes: None,
            disabled_headers: None,
        };
        let built = build_request_to(
            &reqwest::Client::new(),
            &req,
            reqwest::Method::POST,
            &req.url,
        )
        .unwrap();
        std::fs::remove_file(path).unwrap();
        assert_eq!(
            built.body().and_then(reqwest::Body::as_bytes),
            Some(bytes.as_slice())
        );
    }

    #[cfg(unix)]
    #[test]
    fn build_request_rejects_non_regular_upload_files() {
        // `/dev/zero` reports size 0, so the size cap alone let the read run forever.
        let req = HttpRequest {
            method: "POST".into(),
            url: "https://example.com/upload".into(),
            headers: BTreeMap::new(),
            body: None,
            graphql_variables: None,
            binary_file_path: Some("/dev/zero".into()),
            body_mode: Some("binary".into()),
            raw_body_format: None,
            body_params: None,
            auth: None,
            pre_request_script: None,
            test_script: None,
            header_notes: None,
            disabled_headers: None,
        };
        let error = build_request_to(
            &reqwest::Client::new(),
            &req,
            reqwest::Method::POST,
            &req.url,
        )
        .unwrap_err();
        assert!(error.contains("not a regular file"), "{error}");
    }

    #[test]
    fn build_request_lets_reqwest_own_multipart_content_type() {
        let client = reqwest::Client::new();
        let req = HttpRequest {
            method: "post".into(),
            url: "https://example.com/upload".into(),
            headers: BTreeMap::from([
                (
                    "Content-Type".into(),
                    "multipart/form-data; boundary=wrong".into(),
                ),
                ("x-test".into(), "1".into()),
            ]),
            body: Some("ignored".into()),
            graphql_variables: None,
            binary_file_path: None,
            body_mode: Some("form-data".into()),
            raw_body_format: None,
            body_params: Some(vec![BodyParam {
                key: "name".into(),
                value: "bonk".into(),
                description: String::new(),
                enabled: true,
                kind: Some("text".into()),
                file_path: None,
            }]),
            auth: None,
            pre_request_script: None,
            test_script: None,
            header_notes: None,
            disabled_headers: None,
        };
        let built = build_request_to(&client, &req, reqwest::Method::POST, &req.url).unwrap();
        assert_eq!(built.headers().get("x-test").unwrap(), "1");
        let content_type = built
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(content_type.starts_with("multipart/form-data; boundary="));
        assert_ne!(content_type, "multipart/form-data; boundary=wrong");
    }

    #[tokio::test]
    async fn net_error_keeps_the_cause_and_drops_the_url() {
        // Bind then drop: nothing listens on that port any more.
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let e = reqwest::get(format!("http://127.0.0.1:{port}/secret-path"))
            .await
            .unwrap_err();
        let text = net_error(e);
        assert!(text.to_lowercase().contains("refused"), "{text}");
        assert!(!text.contains("secret-path"), "{text}");
    }
}
