use std::{collections::BTreeMap, time::Duration};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use bonk_core::domain::{
    http::{BodyParam, HttpRequest, RequestSettings},
    workspace::{Param, RequestNode, TreeNode},
};

use crate::vars::variable_regex;

pub(crate) fn count_tree(nodes: &[TreeNode], requests: &mut usize, folders: &mut usize) {
    for node in nodes {
        match node {
            TreeNode::Folder(folder) => {
                *folders += 1;
                count_tree(&folder.children, requests, folders);
            }
            TreeNode::Request(_) => *requests += 1,
        }
    }
}

pub(crate) fn collect_requests(nodes: &[TreeNode], out: &mut Vec<RequestNode>) {
    for node in nodes {
        match node {
            TreeNode::Folder(folder) => collect_requests(&folder.children, out),
            TreeNode::Request(request) => out.push((**request).clone()),
        }
    }
}

pub(crate) fn materialize_body_and_params(request: &mut HttpRequest, params: Option<&[Param]>) {
    if let Some(rows) = params.filter(|rows| !rows.is_empty()) {
        request.url = sync_url_with_params(&request.url, rows);
    }
    match request.body_mode.as_deref().unwrap_or("raw") {
        "none" => request.body = None,
        "urlencoded" => {
            let rows = enabled_body_params(request);
            if !rows.is_empty() {
                request.body = Some(
                    rows.into_iter()
                        .map(|row| {
                            format!(
                                "{}={}",
                                encode_preserving_vars(&row.key, true),
                                encode_preserving_vars(&row.value, true)
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("&"),
                );
                set_header_if_missing(
                    &mut request.headers,
                    "Content-Type",
                    "application/x-www-form-urlencoded",
                );
            }
        }
        "form-data" => request.body = None,
        "graphql" => {
            // Variables alone still make a request (the query may come from a script).
            let has_vars = request
                .graphql_variables
                .as_deref()
                .is_some_and(|vars| !vars.trim().is_empty());
            if request.body.as_deref().is_some_and(|body| !body.is_empty()) || has_vars {
                request.body.get_or_insert_with(String::new);
                set_header_if_missing(&mut request.headers, "Content-Type", "application/json");
            } else {
                request.body = None;
            }
        }
        "raw" if raw_is_json(request) && request.body.as_deref().is_some_and(|b| !b.is_empty()) => {
            set_header_if_missing(&mut request.headers, "Content-Type", "application/json");
        }
        _ => {}
    }
}

/// The raw body's format: the explicit one, else sniffed like `currentRawFormat` in httpBody.ts.
fn raw_is_json(request: &HttpRequest) -> bool {
    match request.raw_body_format.as_deref() {
        Some(format) => format == "JSON",
        None => {
            let body = request.body.as_deref().unwrap_or_default().trim_start();
            body.starts_with('{') || body.starts_with('[')
        }
    }
}

pub(crate) fn enabled_body_params(request: &HttpRequest) -> Vec<&BodyParam> {
    request
        .body_params
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
        .collect()
}

pub(crate) fn set_header_if_missing(
    headers: &mut BTreeMap<String, String>,
    name: &str,
    value: &str,
) {
    if !headers.keys().any(|key| key.eq_ignore_ascii_case(name)) {
        headers.insert(name.into(), value.into());
    }
}

pub(crate) fn apply_auth(request: &mut HttpRequest) -> Result<(), String> {
    let Some(auth) = request.auth.clone() else {
        return Ok(());
    };
    match auth.auth_type.as_str() {
        "none" | "" | "inherit" => {}
        "bearer" => {
            if let Some(token) = auth.bearer_token.filter(|value| !value.trim().is_empty()) {
                set_header_if_missing(
                    &mut request.headers,
                    "Authorization",
                    &format!("Bearer {}", token.trim()),
                );
            }
        }
        "basic" => {
            let username = auth.basic_username.unwrap_or_default();
            let password = auth.basic_password.unwrap_or_default();
            if !username.is_empty() || !password.is_empty() {
                let value = BASE64.encode(format!("{username}:{password}"));
                set_header_if_missing(
                    &mut request.headers,
                    "Authorization",
                    &format!("Basic {value}"),
                );
            }
        }
        "apiKey" | "apikey" | "api-key" => {
            let name = auth.api_key_name.unwrap_or_default();
            let value = auth.api_key_value.unwrap_or_default();
            if !name.trim().is_empty() {
                if auth.api_key_in.as_deref().unwrap_or("header") == "query" {
                    request.url = append_query(&request.url, name.trim(), &value);
                } else {
                    set_header_if_missing(&mut request.headers, name.trim(), &value);
                }
            }
        }
        other => return Err(format!("unsupported auth type: {other}")),
    }
    Ok(())
}

pub(crate) fn sync_url_with_params(url: &str, params: &[Param]) -> String {
    let pairs = params
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
        .map(|row| {
            format!(
                "{}={}",
                encode_preserving_vars(row.key.trim(), false),
                encode_preserving_vars(&row.value, false)
            )
        })
        .collect::<Vec<_>>();
    let (without_hash, hash) = url
        .split_once('#')
        .map_or((url, ""), |(left, right)| (left, right));
    let base = without_hash
        .split_once('?')
        .map_or(without_hash, |(left, _)| left);
    let query = if pairs.is_empty() {
        String::new()
    } else {
        format!("?{}", pairs.join("&"))
    };
    let hash = if hash.is_empty() {
        String::new()
    } else {
        format!("#{hash}")
    };
    format!("{base}{query}{hash}")
}

pub(crate) fn append_query(url: &str, name: &str, value: &str) -> String {
    let (before_hash, hash) = url
        .split_once('#')
        .map_or((url, ""), |(left, right)| (left, right));
    let joiner = if before_hash.contains('?') {
        if before_hash.ends_with('?') || before_hash.ends_with('&') {
            ""
        } else {
            "&"
        }
    } else {
        "?"
    };
    let hash = if hash.is_empty() {
        String::new()
    } else {
        format!("#{hash}")
    };
    format!(
        "{before_hash}{joiner}{}={}{hash}",
        encode_preserving_vars(name, false),
        encode_preserving_vars(value, false)
    )
}

pub(crate) fn encode_preserving_vars(value: &str, space_as_plus: bool) -> String {
    let re = variable_regex();
    let mut out = String::new();
    let mut last = 0;
    for matched in re.find_iter(value) {
        out.push_str(&percent_encode(
            &value[last..matched.start()],
            space_as_plus,
        ));
        out.push_str(matched.as_str());
        last = matched.end();
    }
    out.push_str(&percent_encode(&value[last..], space_as_plus));
    out
}

pub(crate) fn percent_encode(value: &str, space_as_plus: bool) -> String {
    let encoded = url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>();
    if space_as_plus {
        encoded
    } else {
        encoded.replace('+', "%20")
    }
}

pub(crate) fn target_host_allowed(patterns: &[String], host: &str, port: Option<u16>) -> bool {
    if patterns.is_empty() {
        return true;
    }
    let host = host.to_ascii_lowercase();
    let authority = port.map(|port| format!("{host}:{port}"));
    patterns.iter().any(|candidate| {
        let candidate = candidate.to_ascii_lowercase();
        candidate == host
            || authority.as_deref() == Some(candidate.as_str())
            || candidate
                .strip_prefix("*.")
                .is_some_and(|suffix| host.ends_with(&format!(".{suffix}")))
    })
}

pub(crate) fn build_http_client(
    settings: &RequestSettings,
    target_hosts: &[String],
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(format!("bonk-mcp/{}", env!("CARGO_PKG_VERSION")))
        .pool_max_idle_per_host(16)
        .tcp_nodelay(true)
        .danger_accept_invalid_certs(!settings.validate_tls);
    if settings.timeout_ms > 0 {
        builder = builder.timeout(Duration::from_millis(settings.timeout_ms));
    }
    if settings.follow_redirects {
        let target_hosts = target_hosts.to_vec();
        builder = builder.redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 10 {
                return attempt.error(std::io::Error::other("too many redirects"));
            }
            let target = attempt.url();
            if !matches!(target.scheme(), "http" | "https") {
                return attempt.error(std::io::Error::other(
                    "redirect target must use http or https",
                ));
            }
            let Some(host) = target.host_str().map(str::to_owned) else {
                return attempt.error(std::io::Error::other("redirect target has no host"));
            };
            let port = target.port();
            if target_host_allowed(&target_hosts, &host, port) {
                attempt.follow()
            } else {
                attempt.error(std::io::Error::other(format!(
                    "redirect target host `{host}` is not allowed"
                )))
            }
        }));
    } else {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    }
    builder
        .build()
        .map_err(|error| format!("failed to build HTTP client: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_encoder_preserves_placeholders() {
        assert_eq!(
            encode_preserving_vars("hello {{ token }} world", false),
            "hello%20{{ token }}%20world"
        );
    }

    /// `src/shared/model/requestPrep.cases.json` is the spec the app's TS preparation also
    /// runs (`httpBody.parity.test.ts`): the same saved request must go out the same way.
    #[test]
    fn shared_cases_match_the_app() {
        #[derive(serde::Deserialize)]
        struct Case {
            name: String,
            request: HttpRequest,
            #[serde(default)]
            params: Vec<Param>,
            scope: BTreeMap<String, String>,
            expected: serde_json::Value,
        }
        let cases: Vec<Case> = serde_json::from_str(include_str!(
            "../../../src/shared/model/requestPrep.cases.json"
        ))
        .unwrap();
        let mut mismatches = Vec::new();
        for case in cases {
            // execute_http's order.
            let mut request = case.request;
            materialize_body_and_params(&mut request, Some(&case.params));
            crate::vars::resolve_http_request(&mut request, &case.scope).unwrap();
            apply_auth(&mut request).unwrap();
            // Disabled headers are dropped at send time (bonk-core reqwest_client).
            let off = request.disabled_headers.clone().unwrap_or_default();
            request.headers.retain(|key, _| !off.contains(key));
            let got = serde_json::json!({
                "url": request.url,
                "headers": request.headers,
                "body": request.body,
            });
            if got != case.expected {
                mismatches.push(format!(
                    "{}\n  got:  {got}\n  want: {}",
                    case.name, case.expected
                ));
            }
        }
        assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
    }
}
