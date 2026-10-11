//! Explicit desktop network settings for headless clients. Portable scenarios
//! never load these implicitly: paths and credentials belong to this machine.
use std::path::Path;

use crate::domain::http::{ClientCert, ProxySettings, RequestSettings};

pub fn from_app_state(path: &Path) -> Result<RequestSettings, String> {
    let state = super::app_state::load_map(path)?;
    let get = |key: &str, fallback: serde_json::Value| state.get(key).cloned().unwrap_or(fallback);
    let mut settings: RequestSettings = serde_json::from_value(serde_json::json!({
        "timeoutMs": get("requestTimeoutMs", 30_000.into()),
        "followRedirects": get("requestFollowRedirects", true.into()),
        "validateTls": get("requestValidateTls", true.into()),
        "maxResponseBodyBytes": get("responseBodyLimitMb", 25.into()).as_u64().unwrap_or(25).saturating_mul(1024 * 1024),
        "proxy": ProxySettings {
            mode: serde_json::from_value(get("proxyMode", "system".into())).map_err(|e| format!("proxyMode: {e}"))?,
            url: get("proxyUrl", "".into()).as_str().unwrap_or_default().into(),
            bypass: get("proxyBypass", "".into()).as_str().unwrap_or_default().into(),
            username: if state["proxyAuth"] == true { get("proxyUser", "".into()).as_str().unwrap_or_default().into() } else { String::new() },
            password: String::new(),
        },
        "caPaths": get("trustedCaPaths", serde_json::json!([])),
        "trustSystemCas": get("trustSystemCas", true.into()),
        "clientCerts": get("clientCerts", serde_json::json!([])),
    })).map_err(|e| format!("network settings: {e}"))?;
    // Compatibility with the old single-identity desktop settings.
    if settings.client_certs.is_empty() {
        if let (Some(cert), Some(key)) = (
            state["clientCertPath"].as_str(),
            state["clientKeyPath"].as_str(),
        ) {
            if !cert.is_empty() && !key.is_empty() {
                settings.client_certs.push(ClientCert {
                    host: String::new(),
                    cert_path: cert.into(),
                    key_path: key.into(),
                    p12_path: None,
                    p12_password: None,
                });
            }
        }
    }
    // Settings UI can contain an unfinished identity row; desktop only sends
    // complete identities to the backend.
    settings.client_certs.retain(|cert| {
        cert.p12_path.as_deref().is_some_and(|p| !p.is_empty())
            || (!cert.cert_path.is_empty() && !cert.key_path.is_empty())
    });
    if !settings.proxy.username.is_empty() {
        settings.proxy.password =
            super::app_vars::keychain_secret("net:proxy-password").unwrap_or_default();
    }
    for cert in &mut settings.client_certs {
        if let Some(path) = &cert.p12_path {
            cert.p12_password = super::app_vars::keychain_secret(&format!("net:p12:{path}"));
        }
    }
    Ok(settings.normalized())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_state_preserves_network_defaults_and_legacy_identity() {
        let path =
            std::env::temp_dir().join(format!("bonk-network-state-{}.json", fastrand::u64(..)));
        std::fs::write(&path, r#"{"clientCertPath":"client.pem","clientKeyPath":"client.key","trustedCaPaths":["ca.pem"],"requestTimeoutMs":0,"trustSystemCas":false}"#).unwrap();
        let settings = from_app_state(&path).unwrap();
        assert_eq!(settings.timeout_ms, 0);
        assert!(!settings.trust_system_cas);
        assert!(settings.follow_redirects && settings.validate_tls);
        assert_eq!(settings.ca_paths, ["ca.pem"]);
        let identity =
            crate::domain::http::pick_client_cert(&settings.client_certs, "api.test").unwrap();
        assert_eq!(
            (&*identity.cert_path, &*identity.key_path),
            ("client.pem", "client.key")
        );
        std::fs::write(
            &path,
            r#"{"clientCerts":[{"host":"","certPath":"","keyPath":""}]}"#,
        )
        .unwrap();
        assert!(from_app_state(&path).unwrap().client_certs.is_empty());
        std::fs::remove_file(path).unwrap();
    }
}
