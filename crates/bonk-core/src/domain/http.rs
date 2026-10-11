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

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
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
    /// Settings for `type: "oauth2"`. The token itself is never saved here: it lives in
    /// the keychain and is put into `bearer_token` of the outgoing copy only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth: Option<OAuthConfig>,
}

/// OAuth 2.0 client settings (`{{vars}}` allowed everywhere). Empty strings mean "unset".
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OAuthConfig {
    /// `authorization_code` (default), `client_credentials` or `password`.
    pub grant: String,
    pub auth_url: String,
    pub token_url: String,
    pub revoke_url: String,
    pub client_id: String,
    pub client_secret: String,
    /// `basic` (default): client id/secret in an `Authorization: Basic` header; `body`: in the form.
    pub client_auth: String,
    /// Space-separated, as on the wire.
    pub scope: String,
    pub audience: String,
    /// Empty: `http://127.0.0.1:<free port>/callback`.
    pub redirect_uri: String,
    /// PKCE S256 for the code grant; on unless set to `false`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pkce: Option<bool>,
    pub username: String,
    pub password: String,
    /// Get a new token by itself when the old one expired; on unless set to `false`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_refresh: Option<bool>,
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
    /// The response's `Set-Cookie`s, parsed, with what each did to the jar.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cookies: Vec<ResponseCookie>,
    /// How many jar cookies the next request to `final_url` will carry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jar_sends: Option<usize>,
}

/// A `Set-Cookie` of a response and its effect on the jar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseCookie {
    #[serde(flatten)]
    pub cookie: CookieInfo,
    /// `None` when saving to the jar is switched off.
    pub change: Option<CookieChange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CookieChange {
    New,
    Updated,
    /// Expired on arrival (`Max-Age=0`, a past `Expires`): the jar drops it.
    Deleted,
    /// Not valid for this URL (foreign `Domain`, `Secure` over http…): not stored.
    Rejected,
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

/// mTLS identity, used for requests to `host` (exact or `*.wildcard`; empty =
/// any host): PEM certificate chain + PEM private key by file path, or one
/// PKCS#12 bundle (`p12_path`) opened with `p12_password`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCert {
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub cert_path: String,
    #[serde(default)]
    pub key_path: String,
    #[serde(default)]
    pub p12_path: Option<String>,
    #[serde(default)]
    pub p12_password: Option<String>,
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
    /// Workspace root whose cookie jar this request uses; empty = the app-wide jar.
    #[serde(default)]
    pub cookie_jar: String,
    /// Store `Set-Cookie` from responses into the jar.
    #[serde(default = "default_true")]
    pub cookies_save: bool,
    /// Send matching jar cookies in the `Cookie` header (a hand-written one wins).
    #[serde(default = "default_true")]
    pub cookies_send: bool,
    /// Also save session cookies, so they survive a restart like persistent ones.
    #[serde(default)]
    pub cookies_keep_session: bool,
    /// Domains whose cookies are neither stored nor sent (`sentry.io`, `*.doubleclick.net`).
    #[serde(default)]
    pub cookies_exclude: Vec<String>,
}

/// Whether `host` falls under one of the excluded domains: `x.com`, `*.x.com` and `.x.com`
/// all mean x.com and every subdomain of it.
pub fn cookie_host_excluded(host: &str, exclude: &[String]) -> bool {
    let host = host.to_ascii_lowercase();
    exclude.iter().any(|p| {
        let d = p
            .trim()
            .trim_start_matches("*.")
            .trim_start_matches('.')
            .to_ascii_lowercase();
        !d.is_empty() && (host == d || host.ends_with(&format!(".{d}")))
    })
}

/// One cookie of a jar, as the Cookies window lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieInfo {
    pub name: String,
    pub value: String,
    /// Host (host-only cookie) or the `Domain` attribute without a leading dot.
    pub domain: String,
    /// No `Domain` attribute: sent to exactly this host, not its subdomains.
    pub host_only: bool,
    pub path: String,
    /// Unix ms; `None` = session cookie, gone when bonk closes.
    pub expires_ms: Option<i64>,
    pub expired: bool,
    pub http_only: bool,
    pub secure: bool,
    /// `Strict` / `Lax` / `None`, as sent; `None` when the attribute is absent.
    pub same_site: Option<String>,
    /// The cookie as a `Set-Cookie` value (for the raw view and editing).
    pub raw: String,
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
            cookie_jar: String::new(),
            cookies_save: true,
            cookies_send: true,
            cookies_keep_session: false,
            cookies_exclude: Vec::new(),
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
            cookie_jar: self.cookie_jar,
            cookies_save: self.cookies_save,
            cookies_send: self.cookies_send,
            cookies_keep_session: self.cookies_keep_session,
            cookies_exclude: self.cookies_exclude,
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

fn default_true() -> bool {
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
            p12_path: None,
            p12_password: None,
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
    fn cookie_exclusions_cover_subdomains() {
        let ex = [
            "sentry.io".to_string(),
            "*.doubleclick.net".to_string(),
            " ".to_string(),
        ];
        assert!(cookie_host_excluded("sentry.io", &ex));
        assert!(cookie_host_excluded("o1.ingest.Sentry.io", &ex));
        assert!(cookie_host_excluded("doubleclick.net", &ex));
        assert!(cookie_host_excluded("ad.doubleclick.net", &ex));
        assert!(!cookie_host_excluded("notsentry.io", &ex));
        assert!(!cookie_host_excluded("api.a.kz", &ex));
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
