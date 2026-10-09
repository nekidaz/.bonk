use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    pub body: Option<String>,
    /// JSON object text from the GraphQL Variables editor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graphql_variables: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary_file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_body_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_params: Option<Vec<BodyParam>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthConfig>,
    /// Postman-style pre-request script (JS), run before `{{var}}` resolution.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_request_script: Option<String>,
    /// Postman-style test script (JS), run against the response.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_script: Option<String>,
    /// Free-text description per header key (shown in the Headers table).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_notes: Option<BTreeMap<String, String>>,
    /// Header keys kept in the request but switched off: never sent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled_headers: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyParam {
    pub key: String,
    pub value: String,
    pub description: String,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthConfig {
    #[serde(rename = "type")]
    pub auth_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bearer_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basic_username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basic_password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_in: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
    pub final_url: String,
    pub elapsed_ms: u64,
    pub size_bytes: usize,
    #[serde(default)]
    pub body_truncated: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyMode {
    /// Honour the OS proxy settings (reqwest `system-proxy`).
    #[default]
    System,
    None,
    Manual,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySettings {
    #[serde(default)]
    pub mode: ProxyMode,
    /// `http://host:port` / `socks5://host:port`; used when `mode` is manual.
    #[serde(default)]
    pub url: String,
    /// Comma-separated hosts that skip the proxy.
    #[serde(default)]
    pub bypass: String,
    /// Basic proxy auth (manual mode); empty username = none.
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

/// mTLS identity: PEM certificate chain + PEM private key, by file path,
/// used for requests to `host` (exact or `*.wildcard`; empty = any host).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCert {
    #[serde(default)]
    pub host: String,
    pub cert_path: String,
    pub key_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestSettings {
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_follow_redirects")]
    pub follow_redirects: bool,
    #[serde(default = "default_validate_tls")]
    pub validate_tls: bool,
    #[serde(default = "default_max_response_body_bytes")]
    pub max_response_body_bytes: usize,
    #[serde(default)]
    pub proxy: ProxySettings,
    /// Extra trusted root CAs (PEM file paths).
    #[serde(default)]
    pub ca_paths: Vec<String>,
    /// Trust the OS/built-in root CAs besides `ca_paths`.
    #[serde(default = "default_validate_tls")]
    pub trust_system_cas: bool,
    #[serde(default)]
    pub client_certs: Vec<ClientCert>,
}

/// First client identity whose `host` matches the request host.
pub fn pick_client_cert<'a>(certs: &'a [ClientCert], host: &str) -> Option<&'a ClientCert> {
    let host = host.to_ascii_lowercase();
    certs.iter().find(|c| {
        let pat = c.host.trim().to_ascii_lowercase();
        match pat.strip_prefix("*.") {
            _ if pat.is_empty() => true,
            Some(suffix) => host.len() > suffix.len() && host.ends_with(&format!(".{suffix}")),
            None => pat == host,
        }
    })
}

impl Default for RequestSettings {
    fn default() -> Self {
        Self {
            timeout_ms: default_timeout_ms(),
            follow_redirects: default_follow_redirects(),
            validate_tls: default_validate_tls(),
            max_response_body_bytes: default_max_response_body_bytes(),
            proxy: ProxySettings::default(),
            ca_paths: Vec::new(),
            trust_system_cas: true,
            client_certs: Vec::new(),
        }
    }
}

impl RequestSettings {
    pub fn normalized(self) -> Self {
        Self {
            timeout_ms: self.timeout_ms.min(600_000),
            follow_redirects: self.follow_redirects,
            validate_tls: self.validate_tls,
            max_response_body_bytes: self
                .max_response_body_bytes
                .clamp(1_024 * 1024, 250 * 1024 * 1024),
            proxy: self.proxy,
            ca_paths: self.ca_paths,
            trust_system_cas: self.trust_system_cas,
            client_certs: self.client_certs,
        }
    }
}

fn default_timeout_ms() -> u64 {
    30_000
}

fn default_follow_redirects() -> bool {
    true
}

fn default_validate_tls() -> bool {
    true
}

fn default_max_response_body_bytes() -> usize {
    25 * 1024 * 1024
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_cert_host_matching() {
        let c = |host: &str| ClientCert {
            host: host.into(),
            cert_path: host.into(),
            key_path: String::new(),
        };
        let certs = [c("api.a.kz"), c("*.b.kz"), c("")];
        let pick = |h: &str| pick_client_cert(&certs, h).map(|c| c.host.as_str());
        assert_eq!(pick("API.a.kz"), Some("api.a.kz"));
        assert_eq!(pick("x.b.kz"), Some("*.b.kz"));
        assert_eq!(pick("b.kz"), Some(""));
        assert_eq!(pick("other.com"), Some(""));
        assert_eq!(pick_client_cert(&certs[..2], "other.com"), None);
    }

    #[test]
    fn http_request_serde_roundtrip() {
        let mut headers = BTreeMap::new();
        headers.insert("accept".into(), "application/json".into());
        let req = HttpRequest {
            method: "GET".into(),
            url: "https://example.com".into(),
            headers,
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
        let json = serde_json::to_string(&req).unwrap();
        let back: HttpRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(req, back);
    }

    #[test]
    fn graphql_variables_survive_a_save_round_trip() {
        // Workspace saves go through this struct; an unknown field is silently dropped.
        let req: HttpRequest = serde_json::from_str(
            r#"{"method":"POST","url":"https://x","body":"query { a }","bodyMode":"graphql","graphqlVariables":"{\"id\":1}"}"#,
        )
        .unwrap();
        let saved = serde_json::to_value(&req).unwrap();
        assert_eq!(saved["graphqlVariables"], r#"{"id":1}"#);
    }

    #[test]
    fn request_settings_defaults_from_empty_json() {
        let settings: RequestSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings, RequestSettings::default());
    }
}
