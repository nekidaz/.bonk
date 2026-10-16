//! Shared HTTP client configuration for desktop and headless frontends.
use crate::domain::http::{
    pick_client_cert, ClientCert, ProxyMode, ProxySettings, RequestSettings,
};

/// Configure a caller's builder; the caller supplies its headers, cookie jar and
/// the identity selected for the request host. Like configuring Go's http.Transport.
pub fn configure(
    mut builder: reqwest::ClientBuilder,
    settings: &RequestSettings,
    identity: Option<&ClientCert>,
) -> Result<reqwest::ClientBuilder, String> {
    builder = builder.danger_accept_invalid_certs(!settings.validate_tls);
    if !settings.follow_redirects {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    } else if let Some(identity) = identity.filter(|cert| !cert.host.trim().is_empty()) {
        let identity = identity.clone();
        builder = builder.redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 10 {
                return attempt.error("too many redirects");
            }
            let matches = attempt.url().host_str().is_some_and(|host| {
                pick_client_cert(std::slice::from_ref(&identity), host).is_some()
            });
            // A reqwest client holds one identity for every TLS handshake. Stop
            // here instead of sending that identity outside its configured hosts.
            if matches {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }));
    }
    builder = apply_proxy(builder, &settings.proxy)?;
    apply_tls_files(
        builder,
        &settings.ca_paths,
        settings.trust_system_cas,
        identity,
    )
}

fn apply_proxy(
    builder: reqwest::ClientBuilder,
    proxy: &ProxySettings,
) -> Result<reqwest::ClientBuilder, String> {
    match proxy.mode {
        ProxyMode::System => Ok(builder),
        ProxyMode::None => Ok(builder.no_proxy()),
        ProxyMode::Manual => {
            let url = proxy.url.trim();
            if url.is_empty() {
                return Err("proxy: URL is empty".to_string());
            }
            // Bare `host:port` (what the settings field suggests) means http://.
            let url = if url.contains("://") {
                url.to_string()
            } else {
                format!("http://{url}")
            };
            let parsed = reqwest::Url::parse(&url).map_err(|_| "proxy: invalid URL")?;
            if !matches!(parsed.scheme(), "http" | "https" | "socks5" | "socks5h")
                || parsed.host_str().is_none()
            {
                return Err("proxy: expected an HTTP, HTTPS or SOCKS5 URL".into());
            }
            let mut p = reqwest::Proxy::all(&url).map_err(|_| "proxy: invalid URL".to_string())?;
            if !proxy.username.is_empty() {
                p = p.basic_auth(&proxy.username, &proxy.password);
            }
            Ok(builder.proxy(p.no_proxy(reqwest::NoProxy::from_string(proxy.bypass.trim()))))
        }
    }
}

fn read_pem(path: &str, what: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{what} «{path}»: {e}"))
}

fn apply_tls_files(
    mut builder: reqwest::ClientBuilder,
    ca_paths: &[String],
    trust_system_cas: bool,
    client_cert: Option<&ClientCert>,
) -> Result<reqwest::ClientBuilder, String> {
    let mut roots = Vec::new();
    for path in ca_paths {
        let pem = read_pem(path, "CA certificate")?;
        let certificates = reqwest::Certificate::from_pem_bundle(&pem)
            .map_err(|e| format!("CA certificate «{path}»: {e}"))?;
        if certificates.is_empty() {
            return Err(format!("CA certificate «{path}»: no PEM certificates"));
        }
        roots.extend(certificates);
    }
    // `merge` adds to the system roots, `only` replaces them.
    if trust_system_cas {
        if !roots.is_empty() {
            builder = builder.tls_certs_merge(roots);
        }
    } else {
        builder = builder.tls_certs_only(roots);
    }
    if let Some(c) = client_cert {
        let (pem, what) = match c.p12_path.as_deref().filter(|p| !p.is_empty()) {
            Some(p12) => {
                let (cert, key) = crate::infra::pkcs12::p12_to_pem(
                    p12,
                    c.p12_password.as_deref().unwrap_or_default(),
                )?;
                ([cert, b"\n".to_vec(), key].concat(), p12)
            }
            None => {
                let mut pem = read_pem(&c.cert_path, "client certificate")?;
                pem.push(b'\n');
                pem.extend(read_pem(&c.key_path, "client key")?);
                (pem, c.cert_path.as_str())
            }
        };
        let id = reqwest::Identity::from_pem(&pem)
            .map_err(|e| format!("client certificate «{what}»: {e}"))?;
        builder = builder.identity(id);
    }
    Ok(builder)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_ca_bundle_is_a_configuration_error() {
        let path = std::env::temp_dir().join(format!("bonk-empty-ca-{}.pem", fastrand::u64(..)));
        std::fs::write(&path, b"").unwrap();
        let settings = RequestSettings {
            ca_paths: vec![path.to_string_lossy().into_owned()],
            ..Default::default()
        };
        let result = configure(reqwest::Client::builder(), &settings, None);
        std::fs::remove_file(path).unwrap();
        assert!(matches!(result, Err(error) if error.contains("no PEM certificates")));
    }
}
