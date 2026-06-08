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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_body_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_params: Option<Vec<BodyParam>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthConfig>,
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
}

impl Default for RequestSettings {
    fn default() -> Self {
        Self {
            timeout_ms: default_timeout_ms(),
            follow_redirects: default_follow_redirects(),
            validate_tls: default_validate_tls(),
            max_response_body_bytes: default_max_response_body_bytes(),
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
    fn http_request_serde_roundtrip() {
        let mut headers = BTreeMap::new();
        headers.insert("accept".into(), "application/json".into());
        let req = HttpRequest {
            method: "GET".into(),
            url: "https://example.com".into(),
            headers,
            body: None,
            body_mode: None,
            raw_body_format: None,
            body_params: None,
            auth: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        let back: HttpRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(req, back);
    }

    #[test]
    fn request_settings_defaults_from_empty_json() {
        let settings: RequestSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings, RequestSettings::default());
    }
}
