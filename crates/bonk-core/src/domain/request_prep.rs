//! Turning a saved/edited request into the one that goes on the wire: params into the URL,
//! the body for its mode, `{{vars}}`, auth; a gRPC call's message and metadata. The app
//! (via `http_prepare` / `http_resolve` / `grpc_prepare`)
//! and bonk-mcp both call these, so a request goes out the same way from either.
//! `src/shared/model/requestPrep.cases.json` is the spec; the app's TS copy (used only
//! for previews: cURL, code snippets) runs the same cases.

use std::{collections::BTreeMap, sync::LazyLock};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;

use super::{
    http::{AuthConfig, BodyParam, HttpRequest, OAuthConfig},
    workspace::{Param, TreeNode},
};

pub type Scope = BTreeMap<String, String>;

/// A `{{ name }}` placeholder, capturing the (padded) name. Same as `VAR_RE` in vars.ts.
pub static VAR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{\{\s*([^{}]*?)\s*\}\}").expect("valid variable regex"));

/// What URL/form encoding leaves untouched, as `encodeQueryPart` in http.ts splits it.
static ENCODE_KEEP_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{\{[^}]*\}\}").expect("valid placeholder regex"));

/// Step 1, before the pre-request script: the Params table owns the query string, the body
/// is built for its mode (with its Content-Type), switched-off headers are dropped.
/// `{{vars}}` stay as they are. Mirrors `buildUrl` + `buildRequestForSend`.
pub fn materialize(request: &mut HttpRequest, params: Option<&[Param]>) {
    if let Some(rows) = params.filter(|rows| !rows.is_empty()) {
        request.url = sync_url_with_params(&request.url, rows);
    }
    let off = request.disabled_headers.clone().unwrap_or_default();
    request.headers.retain(|key, _| !off.contains(key));
    let body = request.body.take().filter(|body| !body.is_empty());
    let mode = request.body_mode.clone().unwrap_or_else(|| "raw".into());
    request.body = match mode.as_str() {
        "none" | "form-data" => None,
        "urlencoded" => {
            let rows = enabled_body_params(request);
            if rows.is_empty() {
                None
            } else {
                let encoded = rows
                    .iter()
                    .map(|row| format!("{}={}", encode_form(&row.key), encode_form(&row.value)))
                    .collect::<Vec<_>>()
                    .join("&");
                set_header_if_missing(
                    &mut request.headers,
                    "Content-Type",
                    "application/x-www-form-urlencoded",
                );
                Some(encoded)
            }
        }
        "graphql" => {
            // Variables alone still make a request (the query may come from a script).
            let has_vars = request
                .graphql_variables
                .as_deref()
                .is_some_and(|vars| !vars.trim().is_empty());
            if body.is_some() || has_vars {
                set_header_if_missing(&mut request.headers, "Content-Type", "application/json");
                Some(body.unwrap_or_default())
            } else {
                None
            }
        }
        // The native layer streams the file; its path is not the body.
        "binary"
            if request
                .binary_file_path
                .as_deref()
                .is_some_and(|p| !p.is_empty()) =>
        {
            None
        }
        _ => {
            if mode == "raw" && body.is_some() && raw_is_json(request, body.as_deref()) {
                set_header_if_missing(&mut request.headers, "Content-Type", "application/json");
            }
            body
        }
    };
}

/// Step 2, after the pre-request script: resolve `{{vars}}` everywhere they can appear,
/// wrap a GraphQL query with its variables, then add auth (on resolved values: a Basic
/// header is base64, a `{{var}}` inside it could never be resolved later).
/// Unknown names stay visible as `{{name}}`. Mirrors `resolveRequestVars`.
pub fn resolve(request: &mut HttpRequest, scope: &Scope) -> Result<(), String> {
    let text = |value: &str| resolve_text(value, scope);
    request.url = text(&request.url);
    request.body = request.body.as_deref().map(text);
    request.binary_file_path = request.binary_file_path.as_deref().map(text);
    request.headers = std::mem::take(&mut request.headers)
        .into_iter()
        .map(|(key, value)| (text(&key), text(&value)))
        .collect();
    for row in request.body_params.iter_mut().flatten() {
        row.key = text(&row.key);
        row.value = text(&row.value);
        row.file_path = row.file_path.as_deref().map(text);
    }
    if let Some(auth) = request.auth.as_mut() {
        for value in [
            &mut auth.bearer_token,
            &mut auth.basic_username,
            &mut auth.basic_password,
            &mut auth.api_key_name,
            &mut auth.api_key_value,
        ] {
            *value = value.as_deref().map(text);
        }
        if let Some(oauth) = auth.oauth.as_mut() {
            resolve_oauth(oauth, scope);
        }
    }
    if request.body_mode.as_deref() == Some("graphql") {
        if let Some(query) = request.body.take() {
            let variables = graphql_variables(request.graphql_variables.as_deref(), scope)?;
            // ponytail: serde_json sorts object keys where JSON.stringify keeps the typed
            // order; same JSON to a server, different bytes. Enable `preserve_order` if it matters.
            request.body =
                Some(serde_json::json!({ "query": query, "variables": variables }).to_string());
        }
    }
    apply_auth(request)
}

/// `{{vars}}` resolved in every OAuth setting.
pub fn resolve_oauth(oauth: &mut OAuthConfig, scope: &Scope) {
    for value in [
        &mut oauth.auth_url,
        &mut oauth.token_url,
        &mut oauth.revoke_url,
        &mut oauth.client_id,
        &mut oauth.client_secret,
        &mut oauth.scope,
        &mut oauth.audience,
        &mut oauth.redirect_uri,
        &mut oauth.username,
        &mut oauth.password,
    ] {
        *value = resolve_text(value, scope);
    }
}

pub fn resolve_text(value: &str, scope: &Scope) -> String {
    VAR_RE
        .replace_all(value, |captures: &regex::Captures<'_>| {
            let name = captures.get(1).map_or("", |m| m.as_str()).trim();
            scope
                .get(name)
                .cloned()
                .unwrap_or_else(|| captures[0].to_string())
        })
        .into_owned()
}

/// The auth a send uses: the request's own, else the nearest ancestor folder's
/// (`.folder.bonk.json`), else none. `inherit` (or unset) means "ask the parent".
/// Mirrors `effectiveAuth` in entities/workspace/authInherit.ts.
pub fn effective_auth(tree: &[TreeNode], id: &str, own: Option<&AuthConfig>) -> AuthConfig {
    let is_set = |auth: &&AuthConfig| auth.auth_type != "inherit";
    own.filter(is_set)
        .or_else(|| nearest_folder_auth(tree, id).flatten())
        .cloned()
        .unwrap_or_else(|| AuthConfig {
            auth_type: "none".into(),
            api_key_in: Some("header".into()),
            ..AuthConfig::default()
        })
}

/// `Some(auth)` once request `id` is found under `nodes`: the closest folder on its path
/// that sets auth, or `None` if none does.
fn nearest_folder_auth<'a>(nodes: &'a [TreeNode], id: &str) -> Option<Option<&'a AuthConfig>> {
    for node in nodes {
        match node {
            TreeNode::Request(request) if request.id == id => return Some(None),
            TreeNode::Folder(folder) => {
                if let Some(found) = nearest_folder_auth(&folder.children, id) {
                    let own = folder
                        .auth
                        .as_deref()
                        .filter(|auth| auth.auth_type != "inherit");
                    return Some(found.or(own));
                }
            }
            TreeNode::Request(_) => {}
        }
    }
    None
}

/// A gRPC call's wire payload.
#[derive(Debug, PartialEq, Serialize)]
pub struct GrpcOutgoing {
    pub message: String,
    pub metadata: BTreeMap<String, String>,
}

/// After the pre-request script: `{{vars}}` resolved in the message (an empty editor is
/// protobuf's empty message, `{}`) and the metadata. Metadata is the auth's entry first,
/// explicit rows over it; over plaintext `authorization` is dropped unless the request
/// opts in (S30). `auth` is already effective (see `effective_auth`).
pub fn grpc_prepare(
    auth: Option<&AuthConfig>,
    message: &str,
    metadata: &BTreeMap<String, String>,
    scope: &Scope,
    strip_authorization: bool,
) -> GrpcOutgoing {
    let message = resolve_text(message, scope);
    let message = match message.trim() {
        "" => "{}".to_string(),
        trimmed => trimmed.to_string(),
    };
    GrpcOutgoing {
        message,
        metadata: grpc_metadata(auth, metadata, scope, strip_authorization),
    }
}

fn grpc_metadata(
    auth: Option<&AuthConfig>,
    metadata: &BTreeMap<String, String>,
    scope: &Scope,
    strip_authorization: bool,
) -> BTreeMap<String, String> {
    let text = |value: &str| resolve_text(value, scope);
    let mut out = BTreeMap::new();
    let Some(auth) = auth else {
        return explicit_metadata(out, metadata, scope, strip_authorization);
    };
    match auth.auth_type.as_str() {
        "bearer" | "oauth2" => {
            if let Some(token) = auth.bearer_token.as_deref().map(str::trim) {
                if !token.is_empty() {
                    out.insert("authorization".into(), format!("Bearer {}", text(token)));
                }
            }
        }
        "basic" => {
            let user = auth.basic_username.as_deref().unwrap_or_default();
            let password = auth.basic_password.as_deref().unwrap_or_default();
            if !user.is_empty() || !password.is_empty() {
                let token = BASE64.encode(format!("{}:{}", text(user), text(password)));
                out.insert("authorization".into(), format!("Basic {token}"));
            }
        }
        "apiKey" => {
            let name = auth.api_key_name.as_deref().unwrap_or_default().trim();
            if !name.is_empty() {
                let value = text(auth.api_key_value.as_deref().unwrap_or_default());
                out.insert(name.to_lowercase(), value);
            }
        }
        _ => {}
    }
    explicit_metadata(out, metadata, scope, strip_authorization)
}

fn explicit_metadata(
    mut out: BTreeMap<String, String>,
    metadata: &BTreeMap<String, String>,
    scope: &Scope,
    strip_authorization: bool,
) -> BTreeMap<String, String> {
    for (key, value) in metadata {
        out.insert(resolve_text(key, scope), resolve_text(value, scope));
    }
    if strip_authorization {
        out.retain(|key, _| !key.eq_ignore_ascii_case("authorization"));
    }
    out
}

/// Rebuild the query string from the enabled Params rows (`syncUrlWithParams`).
pub fn sync_url_with_params(url: &str, params: &[Param]) -> String {
    let pairs = params
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
        .map(|row| {
            format!(
                "{}={}",
                encode_query(row.key.trim()),
                encode_query(&row.value)
            )
        })
        .collect::<Vec<_>>();
    let (before_hash, hash) = split_hash(url);
    let base = before_hash
        .split_once('?')
        .map_or(before_hash, |(base, _)| base);
    if pairs.is_empty() {
        format!("{base}{hash}")
    } else {
        format!("{base}?{}{hash}", pairs.join("&"))
    }
}

/// `encodeURIComponent`: what JS leaves unescaped in a query key/value.
pub fn encode_uri_component(value: &str) -> String {
    percent_encode(value, |b| b"-_.!~*'()".contains(&b), "%20")
}

fn apply_auth(request: &mut HttpRequest) -> Result<(), String> {
    let Some(auth) = request.auth.clone() else {
        return Ok(());
    };
    match auth.auth_type.as_str() {
        "none" | "" | "inherit" => {}
        // The send path puts the keychain token into `bearer_token` (application::oauth).
        "bearer" | "oauth2" => {
            if let Some(token) = auth.bearer_token.filter(|token| !token.trim().is_empty()) {
                let value = format!("Bearer {}", token.trim());
                set_header_if_missing(&mut request.headers, "Authorization", &value);
            }
        }
        "basic" => {
            let username = auth.basic_username.unwrap_or_default();
            let password = auth.basic_password.unwrap_or_default();
            if !username.is_empty() || !password.is_empty() {
                let value = format!("Basic {}", BASE64.encode(format!("{username}:{password}")));
                set_header_if_missing(&mut request.headers, "Authorization", &value);
            }
        }
        "apiKey" | "apikey" | "api-key" => {
            let name = auth.api_key_name.unwrap_or_default();
            let name = name.trim();
            if let Some(value) = auth.api_key_value.filter(|_| !name.is_empty()) {
                if auth.api_key_in.as_deref() == Some("query") {
                    request.url = append_query(&request.url, name, &value);
                } else {
                    set_header_if_missing(&mut request.headers, name, &value);
                }
            }
        }
        other => return Err(format!("unsupported auth type: {other}")),
    }
    Ok(())
}

/// The GraphQL Variables editor text as a JSON object with `{{vars}}` resolved in its strings.
fn graphql_variables(source: Option<&str>, scope: &Scope) -> Result<Value, String> {
    let source = source.unwrap_or_default().trim();
    if source.is_empty() {
        return Ok(Value::Object(Default::default()));
    }
    let value: Value = serde_json::from_str(source)
        .map_err(|_| "GraphQL variables must be valid JSON.".to_string())?;
    if !value.is_object() {
        return Err("GraphQL variables must be a JSON object.".into());
    }
    fn walk(value: Value, scope: &Scope) -> Value {
        match value {
            Value::String(text) => Value::String(resolve_text(&text, scope)),
            Value::Array(items) => {
                Value::Array(items.into_iter().map(|v| walk(v, scope)).collect())
            }
            Value::Object(map) => {
                Value::Object(map.into_iter().map(|(k, v)| (k, walk(v, scope))).collect())
            }
            other => other,
        }
    }
    Ok(walk(value, scope))
}

/// The raw body's format is JSON: the explicit one, else sniffed like `currentRawFormat`.
fn raw_is_json(request: &HttpRequest, body: Option<&str>) -> bool {
    match request.raw_body_format.as_deref() {
        Some(format) => format == "JSON",
        None => {
            let body = body.unwrap_or_default().trim_start();
            body.starts_with('{') || body.starts_with('[')
        }
    }
}

fn enabled_body_params(request: &HttpRequest) -> Vec<&BodyParam> {
    request
        .body_params
        .iter()
        .flatten()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
        .collect()
}

fn set_header_if_missing(headers: &mut BTreeMap<String, String>, name: &str, value: &str) {
    if !headers.keys().any(|key| key.eq_ignore_ascii_case(name)) {
        headers.insert(name.into(), value.into());
    }
}

fn append_query(url: &str, name: &str, value: &str) -> String {
    let (before_hash, hash) = split_hash(url);
    let joiner = match before_hash.contains('?') {
        false => "?",
        true if before_hash.ends_with('?') || before_hash.ends_with('&') => "",
        true => "&",
    };
    format!(
        "{before_hash}{joiner}{}={}{hash}",
        encode_query(name),
        encode_query(value)
    )
}

/// (`url` before `#`, `#…` or "").
fn split_hash(url: &str) -> (&str, &str) {
    url.find('#').map_or((url, ""), |at| url.split_at(at))
}

fn encode_query(value: &str) -> String {
    keep_placeholders(value, encode_uri_component)
}

/// `application/x-www-form-urlencoded` like URLSearchParams: space → `+`.
fn encode_form(value: &str) -> String {
    keep_placeholders(value, |part| {
        percent_encode(part, |b| b"*-._".contains(&b), "+")
    })
}

/// Encode the text around `{{…}}` placeholders, so the vars still resolve after encoding.
fn keep_placeholders(value: &str, encode: impl Fn(&str) -> String) -> String {
    let mut out = String::new();
    let mut last = 0;
    for placeholder in ENCODE_KEEP_RE.find_iter(value) {
        out.push_str(&encode(&value[last..placeholder.start()]));
        out.push_str(placeholder.as_str());
        last = placeholder.end();
    }
    out.push_str(&encode(&value[last..]));
    out
}

fn percent_encode(value: &str, keep: impl Fn(u8) -> bool, space: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || keep(byte) {
            out.push(byte as char);
        } else if byte == b' ' {
            out.push_str(space);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::workspace::{FolderNode, RequestNode};

    /// The spec the app's TS preview runs too (`httpBody.parity.test.ts`).
    #[test]
    fn shared_cases_match_the_app() {
        #[derive(serde::Deserialize)]
        struct Case {
            name: String,
            request: HttpRequest,
            #[serde(default)]
            params: Vec<Param>,
            scope: Scope,
            expected: Value,
        }
        let cases: Vec<Case> = serde_json::from_str(include_str!(
            "../../../../src/shared/model/requestPrep.cases.json"
        ))
        .unwrap();
        let mut mismatches = Vec::new();
        for case in cases {
            let mut request = case.request;
            materialize(&mut request, Some(&case.params));
            resolve(&mut request, &case.scope).unwrap();
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

    fn auth(kind: &str) -> AuthConfig {
        AuthConfig {
            auth_type: kind.into(),
            bearer_token: Some("{{token}}".into()),
            ..AuthConfig::default()
        }
    }

    fn request(id: &str) -> TreeNode {
        TreeNode::Request(Box::new(RequestNode {
            id: id.into(),
            name: "r".into(),
            protocol: "http".into(),
            request: serde_json::from_value(
                serde_json::json!({"method": "GET", "url": "", "body": null}),
            )
            .unwrap(),
            params: None,
            grpc: None,
            spec: None,
        }))
    }

    fn folder(id: &str, auth: Option<AuthConfig>, children: Vec<TreeNode>) -> TreeNode {
        TreeNode::Folder(FolderNode {
            id: id.into(),
            name: id.into(),
            expanded: true,
            auth: auth.map(Box::new),
            source: None,
            children,
        })
    }

    /// Same tree as authInherit.test.ts.
    #[test]
    fn effective_auth_takes_the_nearest_folder() {
        let tree = vec![
            folder(
                "fs:a",
                Some(auth("bearer")),
                vec![
                    request("fs:a/r"),
                    folder("fs:a/b", None, vec![request("fs:a/b/r")]),
                    folder("fs:a/c", Some(auth("none")), vec![request("fs:a/c/r")]),
                ],
            ),
            request("fs:root"),
        ];
        assert_eq!(effective_auth(&tree, "fs:a/r", None), auth("bearer"));
        assert_eq!(
            effective_auth(&tree, "fs:a/b/r", Some(&auth("inherit"))),
            auth("bearer")
        );
        assert_eq!(effective_auth(&tree, "fs:a/c/r", None), auth("none"));
        assert_eq!(
            effective_auth(&tree, "fs:a/r", Some(&auth("basic"))),
            auth("basic")
        );
        assert_eq!(effective_auth(&tree, "fs:root", None).auth_type, "none");
    }

    #[test]
    fn grpc_prepare_resolves_and_lets_explicit_metadata_win() {
        let scope = Scope::from([("token".into(), "T".into())]);
        let bearer = auth("bearer");
        let explicit = BTreeMap::from([
            ("authorization".into(), "Custom {{token}}".into()),
            ("x".into(), "{{token}}".into()),
        ]);
        let out = grpc_prepare(Some(&bearer), "  ", &explicit, &scope, false);
        assert_eq!(out.message, "{}");
        assert_eq!(
            out.metadata,
            BTreeMap::from([
                ("authorization".into(), "Custom T".into()),
                ("x".into(), "T".into()),
            ])
        );
        let none = BTreeMap::new();
        let out = grpc_prepare(Some(&bearer), r#"{"a":"{{token}}"}"#, &none, &scope, false);
        assert_eq!(out.message, r#"{"a":"T"}"#);
        assert_eq!(out.metadata.get("authorization").unwrap(), "Bearer T");
        let plaintext = grpc_prepare(Some(&bearer), "{}", &explicit, &scope, true);
        assert_eq!(
            plaintext.metadata,
            BTreeMap::from([("x".into(), "T".into())])
        );
    }

    #[test]
    fn grpc_auth_kinds_map_to_metadata() {
        let none = BTreeMap::new();
        let md = |auth: AuthConfig| {
            grpc_prepare(Some(&auth), "{}", &none, &Scope::new(), false).metadata
        };
        let basic = AuthConfig {
            basic_username: Some("a".into()),
            basic_password: Some("b".into()),
            ..auth("basic")
        };
        assert_eq!(md(basic).get("authorization").unwrap(), "Basic YTpi");
        let key = AuthConfig {
            api_key_name: Some("X-Key".into()),
            api_key_value: Some("1".into()),
            ..auth("apiKey")
        };
        assert_eq!(md(key), BTreeMap::from([("x-key".into(), "1".into())]));
        assert!(md(auth("none")).is_empty());
    }

    #[test]
    fn form_data_rows_resolve() {
        let mut request: HttpRequest = serde_json::from_value(serde_json::json!({
            "method": "POST", "url": "http://x", "body": null, "bodyMode": "form-data",
            "bodyParams": [{"key": "{{k}}", "value": "{{v}}", "description": "", "enabled": true}],
        }))
        .unwrap();
        let scope = Scope::from([("k".into(), "name".into()), ("v".into(), "bonk".into())]);
        materialize(&mut request, None);
        resolve(&mut request, &scope).unwrap();
        let row = &request.body_params.unwrap()[0];
        assert_eq!((row.key.as_str(), row.value.as_str()), ("name", "bonk"));
    }

    #[test]
    fn query_encoding_is_encode_uri_component() {
        assert_eq!(encode_query("a b~!{{ x }}/"), "a%20b~!{{ x }}%2F");
        assert_eq!(encode_form("a b~{{x}}"), "a+b%7E{{x}}");
    }
}
