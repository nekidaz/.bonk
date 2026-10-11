use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use bonk_core::{
    application::network_settings,
    domain::http::{ClientCert, ProxyMode, RequestSettings},
};
use clap::Args;

#[derive(Args, Default)]
pub struct NetworkArgs {
    /// JSON RequestSettings; relative certificate paths resolve beside this file.
    #[arg(long, value_name = "FILE")]
    pub network_settings: Option<PathBuf>,
    /// HTTP/SOCKS proxy URL (bare host:port means HTTP).
    #[arg(long, env = "BONK_PROXY_URL", hide_env_values = true)]
    pub proxy: Option<String>,
    /// Disable system and manual HTTP proxies.
    #[arg(long)]
    pub no_proxy: bool,
    /// Comma-separated hosts that bypass a manual HTTP proxy.
    #[arg(long)]
    pub proxy_bypass: Option<String>,
    /// Basic proxy authentication username.
    #[arg(long, env = "BONK_PROXY_USER", hide_env_values = true)]
    pub proxy_user: Option<String>,
    /// Basic proxy password; prefer BONK_PROXY_PASSWORD in CI.
    #[arg(long, env = "BONK_PROXY_PASSWORD", hide_env_values = true)]
    pub proxy_password: Option<String>,
    /// Additional root CA bundle (PEM). Repeatable; replaces configured CA paths.
    #[arg(long, value_name = "PEM")]
    pub cacert: Vec<PathBuf>,
    /// Trust only --cacert / configured CAs for HTTP and gRPC.
    #[arg(long)]
    pub no_system_ca: bool,
    /// Client certificate chain (PEM); use together with --key.
    #[arg(long, value_name = "PEM", requires = "key", conflicts_with = "p12")]
    pub cert: Option<PathBuf>,
    /// Client private key (PEM); use together with --cert.
    #[arg(long, value_name = "PEM", requires = "cert")]
    pub key: Option<PathBuf>,
    /// PKCS#12 client identity, instead of --cert / --key.
    #[arg(long, value_name = "FILE", conflicts_with_all = ["cert", "key"])]
    pub p12: Option<PathBuf>,
    /// PKCS#12 password; prefer BONK_P12_PASSWORD in CI.
    #[arg(long, env = "BONK_P12_PASSWORD", hide_env_values = true)]
    pub p12_password: Option<String>,
    /// Restrict the CLI identity to this host or *.domain; default: all hosts.
    #[arg(long, default_value = "")]
    pub cert_host: String,
}

impl NetworkArgs {
    pub fn settings(&self, app_state: Option<&Path>) -> Result<RequestSettings, String> {
        let mut settings = match app_state {
            Some(path) => network_settings::from_app_state(path)?,
            None => RequestSettings::default(),
        };
        if let Some(path) = &self.network_settings {
            let path = path
                .canonicalize()
                .map_err(|e| format!("network settings: {e}"))?;
            let raw =
                std::fs::read_to_string(&path).map_err(|e| format!("network settings: {e}"))?;
            // Avoid serde's offending-value messages: this file may contain passwords.
            settings = serde_json::from_str(&raw).map_err(|_| "invalid network settings JSON")?;
            let base = path.parent().ok_or("network settings file has no parent")?;
            for ca in &mut settings.ca_paths {
                resolve_path(base, ca);
            }
            for cert in &mut settings.client_certs {
                resolve_path(base, &mut cert.cert_path);
                resolve_path(base, &mut cert.key_path);
                if let Some(p12) = &mut cert.p12_path {
                    resolve_path(base, p12);
                }
            }
        }
        if self.no_proxy {
            settings.proxy.mode = ProxyMode::None;
        } else if let Some(url) = &self.proxy {
            settings.proxy.mode = ProxyMode::Manual;
            settings.proxy.url = url.clone();
        }
        if let Some(bypass) = &self.proxy_bypass {
            settings.proxy.bypass = bypass.clone();
        }
        if let Some(user) = &self.proxy_user {
            settings.proxy.username = user.clone();
        }
        if let Some(password) = &self.proxy_password {
            settings.proxy.password = password.clone();
        }
        if !self.cacert.is_empty() {
            settings.ca_paths = self
                .cacert
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
        }
        if self.no_system_ca {
            settings.trust_system_cas = false;
        }
        if self.cert.is_some() || self.p12.is_some() {
            // Explicit flags win over matching desktop/file identities.
            settings.client_certs.insert(
                0,
                ClientCert {
                    host: self.cert_host.clone(),
                    cert_path: self
                        .cert
                        .as_ref()
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    key_path: self
                        .key
                        .as_ref()
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    p12_path: self.p12.as_ref().map(|p| p.to_string_lossy().into_owned()),
                    p12_password: self.p12_password.clone(),
                },
            );
        } else if let Some(password) = &self.p12_password {
            for cert in &mut settings.client_certs {
                if cert.p12_path.is_some() {
                    cert.p12_password = Some(password.clone());
                }
            }
        }
        Ok(settings.normalized())
    }
}

fn resolve_path(base: &Path, path: &mut String) {
    if !path.is_empty() && Path::new(path).is_relative() {
        *path = base.join(&*path).to_string_lossy().into_owned();
    }
}

/// Network credentials join variable secrets in console/JSON/JUnit redaction.
pub fn secrets(settings: &RequestSettings) -> Vec<String> {
    let mut secrets = vec![settings.proxy.password.clone()];
    let raw = settings.proxy.url.trim();
    let url = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("http://{raw}")
    };
    if let Ok(url) = reqwest::Url::parse(&url) {
        if let Some(password) = url.password() {
            secrets.push(password.into());
            let password = percent_encoding::percent_decode_str(password).decode_utf8_lossy();
            secrets.push(password.to_string());
            let user = percent_encoding::percent_decode_str(url.username()).decode_utf8_lossy();
            secrets.push(STANDARD.encode(format!("{user}:{password}")));
        }
    }
    if !settings.proxy.username.is_empty() && !settings.proxy.password.is_empty() {
        secrets.push(STANDARD.encode(format!(
            "{}:{}",
            settings.proxy.username, settings.proxy.password
        )));
    }
    secrets.extend(
        settings
            .client_certs
            .iter()
            .filter_map(|c| c.p12_password.clone()),
    );
    secrets
}
