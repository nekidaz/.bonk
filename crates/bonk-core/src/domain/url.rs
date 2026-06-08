/// Normalize a user-entered URL. If it has no scheme, prepend one:
/// `http://` for local hosts (localhost / loopback), `https://` otherwise.
/// Already-schemed and empty inputs are returned unchanged (trimmed).
pub fn normalize_url(url: &str) -> String {
    let u = url.trim();
    if u.is_empty() || u.contains("://") {
        return u.to_string();
    }
    let host = u.split(['/', ':', '?', '#']).next().unwrap_or(u);
    let is_local = matches!(host, "localhost" | "127.0.0.1" | "0.0.0.0") || host == "[::1]";
    let scheme = if is_local { "http" } else { "https" };
    format!("{scheme}://{u}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepends_https_when_scheme_missing() {
        assert_eq!(normalize_url("google.com"), "https://google.com");
        assert_eq!(normalize_url("api.example.com/v1/users"), "https://api.example.com/v1/users");
    }

    #[test]
    fn keeps_existing_scheme() {
        assert_eq!(normalize_url("http://x.com"), "http://x.com");
        assert_eq!(normalize_url("https://x.com/a"), "https://x.com/a");
    }

    #[test]
    fn local_hosts_use_http() {
        assert_eq!(normalize_url("localhost:8080"), "http://localhost:8080");
        assert_eq!(normalize_url("127.0.0.1:3000/health"), "http://127.0.0.1:3000/health");
    }

    #[test]
    fn trims_and_handles_empty() {
        assert_eq!(normalize_url("  https://x.com  "), "https://x.com");
        assert_eq!(normalize_url(""), "");
        assert_eq!(normalize_url("   "), "");
    }
}
