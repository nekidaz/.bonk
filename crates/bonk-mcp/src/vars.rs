use std::collections::{BTreeMap, BTreeSet};

use bonk_core::domain::{http::HttpRequest, request_prep::VAR_RE};

pub(crate) use bonk_core::application::app_vars::{
    app_scopes, keychain_secret, load_app_vars, state_field, Scopes, VariableMap,
};

pub(crate) fn merged_scope(
    globals: &BTreeMap<String, String>,
    environment: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut scope = globals.clone();
    scope.extend(environment.clone());
    scope
}

pub(crate) fn unresolved_in_request(request: &HttpRequest) -> Vec<String> {
    let mut names = BTreeSet::new();
    collect_unresolved(&request.url, &mut names);
    if let Some(body) = &request.body {
        collect_unresolved(body, &mut names);
    }
    if let Some(path) = &request.binary_file_path {
        collect_unresolved(path, &mut names);
    }
    for (key, value) in &request.headers {
        collect_unresolved(key, &mut names);
        collect_unresolved(value, &mut names);
    }
    if let Some(rows) = &request.body_params {
        for row in rows {
            collect_unresolved(&row.key, &mut names);
            collect_unresolved(&row.value, &mut names);
            if let Some(path) = &row.file_path {
                collect_unresolved(path, &mut names);
            }
        }
    }
    names.into_iter().collect()
}

pub(crate) fn collect_unresolved(value: &str, out: &mut BTreeSet<String>) {
    for captures in VAR_RE.captures_iter(value) {
        if let Some(name) = captures.get(1) {
            out.insert(name.as_str().trim().to_string());
        }
    }
}

pub(crate) fn reject_unresolved(values: &[&str]) -> Result<(), String> {
    let mut names = BTreeSet::new();
    for value in values {
        collect_unresolved(value, &mut names);
    }
    if names.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "unresolved variables: {}",
            names.into_iter().collect::<Vec<_>>().join(", ")
        ))
    }
}

pub(crate) fn reject_unresolved_grpc<'a>(
    endpoint: &str,
    method: &str,
    message: &str,
    metadata: impl Iterator<Item = (&'a String, &'a String)>,
) -> Result<(), String> {
    let mut names = BTreeSet::new();
    for value in [endpoint, method, message] {
        collect_unresolved(value, &mut names);
    }
    for (name, value) in metadata {
        collect_unresolved(name, &mut names);
        collect_unresolved(value, &mut names);
    }
    if names.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "unresolved variables: {}",
            names.into_iter().collect::<Vec<_>>().join(", ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unresolved_grpc_metadata() {
        let metadata = BTreeMap::from([("authorization".into(), "Bearer {{TOKEN}}".into())]);
        let error = reject_unresolved_grpc(
            "api.example.com:443",
            "/demo.Echo/Say",
            "{}",
            metadata.iter(),
        )
        .expect_err("metadata variable must be resolved");
        assert!(error.contains("TOKEN"));
    }
}
