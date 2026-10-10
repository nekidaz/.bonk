use std::time::Duration;

use bonk_core::domain::{
    http::RequestSettings,
    workspace::{RequestNode, TreeNode},
};
use bonk_core::infra::cookie_jar::JarProvider;

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

/// `jar`: the app's cookie jar, read-only (see `BonkRuntime::read_only_jar`).
pub(crate) fn build_http_client(
    settings: &RequestSettings,
    target_hosts: &[String],
    jar: Option<JarProvider>,
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
    if let Some(jar) = jar {
        builder = builder.cookie_provider(std::sync::Arc::new(jar));
    }
    builder
        .build()
        .map_err(|error| format!("failed to build HTTP client: {error}"))
}
