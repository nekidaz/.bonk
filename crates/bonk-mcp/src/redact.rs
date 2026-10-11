use bonk_core::domain::request_prep::encode_uri_component;
use bonk_core::domain::{
    http::HttpResponse,
    workspace::{RequestNode, TreeNode},
};
use regex::Regex;

use crate::types::{HttpResponseOutput, ScriptTest};

pub(crate) fn redact_tree(nodes: &mut [TreeNode]) {
    for node in nodes {
        match node {
            TreeNode::Folder(folder) => redact_tree(&mut folder.children),
            TreeNode::Request(request) => {
                **request = redact_node((**request).clone());
            }
        }
    }
}

pub(crate) fn redact_node(mut node: RequestNode) -> RequestNode {
    node.request.url = redact_sensitive_url(&node.request.url);
    for (name, value) in &mut node.request.headers {
        if is_sensitive_header(name) {
            *value = "<redacted>".into();
        }
    }
    if let Some(auth) = node.request.auth.as_mut() {
        redact_option(&mut auth.bearer_token);
        redact_option(&mut auth.basic_password);
        redact_option(&mut auth.api_key_value);
        if let Some(oauth) = auth.oauth.as_mut() {
            for value in [&mut oauth.client_secret, &mut oauth.password] {
                if !value.is_empty() {
                    *value = "<redacted>".into();
                }
            }
        }
    }
    if let Some(grpc) = node.grpc.as_mut() {
        for (name, value) in &mut grpc.metadata {
            if is_sensitive_header(name) {
                *value = "<redacted>".into();
            }
        }
    }
    // The import link keeps a copy of the imported headers (a HAR's Authorization, say);
    // it is bookkeeping for re-import, so it is dropped rather than redacted field by field.
    node.spec = None;
    node
}

pub(crate) fn redact_option(value: &mut Option<String>) {
    if value.as_deref().is_some_and(|value| !value.is_empty()) {
        *value = Some("<redacted>".into());
    }
}

pub(crate) fn is_sensitive_header(name: &str) -> bool {
    let name = name.to_ascii_lowercase().replace('_', "-");
    matches!(
        name.as_str(),
        "authorization"
            | "proxy-authorization"
            | "cookie"
            | "set-cookie"
            | "x-api-key"
            | "api-key"
            | "apikey"
            | "key"
            | "password"
            | "passwd"
            | "credential"
    ) || name.contains("token")
        || name.contains("secret")
        || name.contains("api-key")
        || name.contains("password")
}

pub(crate) fn sanitize_http_response(
    response: HttpResponse,
    secrets: &[String],
) -> HttpResponseOutput {
    let headers = response
        .headers
        .into_iter()
        .map(|(name, value)| {
            let value = if is_sensitive_header(&name) {
                "<redacted>".into()
            } else {
                sanitize_text(&value, secrets)
            };
            (name, value)
        })
        .collect();
    HttpResponseOutput {
        status: response.status,
        headers,
        body: sanitize_text(&response.body, secrets),
        final_url: redact_url(&response.final_url, secrets),
        elapsed_ms: response.elapsed_ms,
        size_bytes: response.size_bytes,
        body_truncated: response.body_truncated,
    }
}

pub(crate) fn sanitize_tests(tests: Vec<ScriptTest>, secrets: &[String]) -> Vec<ScriptTest> {
    tests
        .into_iter()
        .map(|mut test| {
            test.name = sanitize_text(&test.name, secrets);
            test.error = test.error.map(|value| sanitize_text(&value, secrets));
            test
        })
        .collect()
}

pub(crate) fn sanitize_text(value: &str, secrets: &[String]) -> String {
    secrets
        .iter()
        .filter(|secret| !secret.is_empty())
        .fold(value.to_string(), |text, secret| {
            let encoded = encode_uri_component(secret);
            text.replace(secret, "<redacted>")
                .replace(&encoded, "<redacted>")
        })
}

pub(crate) fn sanitize_error(value: &str, secrets: &[String]) -> String {
    let sanitized = sanitize_text(value, secrets);
    let url_pattern = Regex::new(r#"https?://[^\s\"'<>]+"#).expect("valid URL regex");
    url_pattern
        .replace_all(&sanitized, |captures: &regex::Captures<'_>| {
            redact_sensitive_url(&captures[0])
        })
        .into_owned()
}

pub(crate) fn redact_url(value: &str, secrets: &[String]) -> String {
    sanitize_text(&redact_sensitive_url(value), secrets)
}

pub(crate) fn redact_sensitive_url(value: &str) -> String {
    let Ok(mut parsed) = url::Url::parse(value) else {
        return value.to_string();
    };
    let pairs = parsed
        .query_pairs()
        .map(|(name, value)| {
            let value = if is_sensitive_header(&name) {
                "<redacted>".into()
            } else {
                value.into_owned()
            };
            (name.into_owned(), value)
        })
        .collect::<Vec<_>>();
    if parsed.password().is_some() {
        let _ = parsed.set_password(Some("<redacted>"));
    }
    if !pairs.is_empty() {
        parsed.query_pairs_mut().clear().extend_pairs(pairs);
    }
    parsed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_process_secret_values() {
        assert_eq!(
            sanitize_text("token=abcd1234", &["abcd1234".into()]),
            "token=<redacted>"
        );
    }

    #[test]
    fn redacts_sensitive_url_parts() {
        let redacted = redact_sensitive_url(
            "https://user:pass@example.com/items?api_key=abc&search=visible&access_token=xyz",
        );
        assert!(!redacted.contains("pass"));
        assert!(!redacted.contains("abc"));
        assert!(!redacted.contains("xyz"));
        assert!(redacted.contains("search=visible"));
    }

    #[test]
    fn redacts_secrets_from_transport_errors() {
        let error = sanitize_error(
            "request failed for https://example.com/items?api_key=literal: token short",
            &["short".into()],
        );
        assert!(!error.contains("literal"));
        assert!(!error.contains("short"));
        assert!(error.contains("<redacted>"));
    }
}
