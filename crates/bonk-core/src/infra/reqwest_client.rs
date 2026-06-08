use crate::domain::http::{BodyParam, HttpRequest};
use std::path::Path;

pub fn build_request_to(
    client: &reqwest::Client,
    req: &HttpRequest,
    method: reqwest::Method,
    url: &str,
) -> Result<reqwest::Request, String> {
    let is_multipart = req.body_mode.as_deref() == Some("form-data");
    let mut rb = client.request(method, url);
    for (k, v) in &req.headers {
        if is_multipart && k.eq_ignore_ascii_case("content-type") {
            continue;
        }
        rb = rb.header(k, v);
    }
    if is_multipart {
        if let Some(form) = build_multipart_form(req)? {
            rb = rb.multipart(form);
        }
    } else if let Some(body) = &req.body {
        rb = rb.body(body.clone());
    }
    rb.build().map_err(|e| match std::error::Error::source(&e) {
        Some(src) => format!("request error: {e}: {src}"),
        None => format!("request error: {e}"),
    })
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
            let bytes = std::fs::read(path)
                .map_err(|e| format!("failed to read form-data file '{path}': {e}"))?;
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
            body_mode: None,
            raw_body_format: None,
            body_params: None,
            auth: None,
        };
        let built = build_request_to(&client, &req, reqwest::Method::POST, &req.url).unwrap();
        assert_eq!(built.method().as_str(), "POST");
        assert_eq!(built.url().as_str(), "https://example.com/api");
        assert_eq!(built.headers().get("x-test").unwrap(), "1");
    }

    #[test]
    fn build_request_lets_reqwest_own_multipart_content_type() {
        let client = reqwest::Client::new();
        let req = HttpRequest {
            method: "post".into(),
            url: "https://example.com/upload".into(),
            headers: BTreeMap::from([
                ("Content-Type".into(), "multipart/form-data; boundary=wrong".into()),
                ("x-test".into(), "1".into()),
            ]),
            body: Some("ignored".into()),
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
        };
        let built = build_request_to(&client, &req, reqwest::Method::POST, &req.url).unwrap();
        assert_eq!(built.headers().get("x-test").unwrap(), "1");
        let content_type = built.headers().get("content-type").unwrap().to_str().unwrap();
        assert!(content_type.starts_with("multipart/form-data; boundary="));
        assert_ne!(content_type, "multipart/form-data; boundary=wrong");
    }
}
