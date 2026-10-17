use bonk_core::application::http_client::RedirectGuard;
use bonk_core::domain::workspace::{RequestNode, TreeNode};

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

/// Redirects may only reach http(s) targets allowed by `--target-host`.
pub(crate) fn redirect_guard(target_hosts: &[String]) -> RedirectGuard {
    let target_hosts = target_hosts.to_vec();
    Box::new(move |target| {
        if !matches!(target.scheme(), "http" | "https") {
            return Err("redirect target must use http or https".into());
        }
        let host = target.host_str().ok_or("redirect target has no host")?;
        if target_host_allowed(&target_hosts, host, target.port()) {
            Ok(())
        } else {
            Err(format!("redirect target host `{host}` is not allowed"))
        }
    })
}
