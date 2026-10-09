//! Unary gRPC calls via the `grpcurl` CLI: a fresh connection per call instead
//! of a long-lived tonic channel. The descriptor cache (reflection or .proto)
//! is handed over as a `-protoset`, so grpcurl never re-reflects.

use crate::conn::GrpcDescriptorCache;
use crate::domain::grpc::{GrpcErrorDetail, GrpcFieldViolation, GrpcPrefs, GrpcResult, GrpcTls};
use prost::Message;
use serde::de::DeserializeSeed;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Instant;
use tokio::io::AsyncWriteExt;

/// Private temp directory for secret files (decrypted client identity): created
/// owner-only, files exclusive-created 0600, the whole tree removed on drop.
struct SecretDir(PathBuf);

impl SecretDir {
    fn create() -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("bonk-{:016x}", fastrand::u64(..)));
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
        builder
            .create(&path)
            .map_err(|e| format!("create temp dir failed: {e}"))?;
        Ok(Self(path))
    }

    fn write(&self, name: &str, data: &[u8]) -> Result<PathBuf, String> {
        use std::io::Write;
        let path = self.0.join(name);
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        options
            .open(&path)
            .and_then(|mut f| f.write_all(data))
            .map_err(|e| format!("write {name} failed: {e}"))?;
        Ok(path)
    }
}

impl Drop for SecretDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Locate grpcurl. A Finder-launched app gets a bare PATH, so also probe the
/// usual Homebrew / Go install dirs.
pub fn find_grpcurl() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .chain(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from))
        .chain(home.map(|h| h.join("go/bin")))
        .map(|dir| dir.join("grpcurl"))
        .find(|p| p.is_file())
}

/// `pkg.Service.Method` → `pkg.Service/Method`.
fn method_path(symbol: &str) -> String {
    match symbol.rsplit_once('.') {
        Some((svc, m)) => format!("{svc}/{m}"),
        None => symbol.to_string(),
    }
}

/// Endpoint → (`host:port`, plaintext). An explicit scheme wins over the flag,
/// matching `grpc_native::connect`.
fn target(endpoint: &str, plaintext: bool) -> (&str, bool) {
    if let Some(rest) = endpoint.strip_prefix("http://") {
        (rest, true)
    } else if let Some(rest) = endpoint.strip_prefix("https://") {
        (rest, false)
    } else {
        (endpoint, plaintext)
    }
}

/// grpcurl's `ERROR:\n  Code: X\n  Message: Y\n  Details: ...` as a failed
/// result with the canonical code name; any other stderr (dial / TLS failure)
/// stays an `Err` with its text.
/// A `-v` section such as `Response headers received:` up to the next blank
/// line (or the closing `Sent N request…` line).
fn section<'a>(stdout: &'a str, title: &str) -> Option<&'a str> {
    let rest = &stdout[stdout.find(title)? + title.len()..];
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    let end = [rest.find("\n\n"), rest.find("\nSent ")]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(rest.len());
    Some(&rest[..end])
}

/// `key: value` lines of a `-v` metadata section; repeated keys are joined.
fn metadata_section(stdout: &str, title: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::<String, String>::new();
    for line in section(stdout, title).unwrap_or_default().lines() {
        if let Some((k, v)) = line.split_once(": ") {
            out.entry(k.to_string())
                .and_modify(|e| {
                    e.push_str(", ");
                    e.push_str(v);
                })
                .or_insert_with(|| v.to_string());
        }
    }
    out
}

fn status_error(stderr: &str, stdout: &str, elapsed_ms: u64) -> Result<GrpcResult, String> {
    let field = |name: &str| {
        stderr
            .lines()
            .find_map(|l| l.trim().strip_prefix(name).map(str::trim))
    };
    let (Some(code), Some(msg)) = (field("Code:"), field("Message:")) else {
        return Err(stderr.trim().to_string());
    };
    let mut status = String::new();
    for (i, c) in code.chars().enumerate() {
        if i > 0 && c.is_ascii_uppercase() {
            status.push('_');
        }
        status.push(c.to_ascii_uppercase());
    }
    Ok(GrpcResult {
        ok: false,
        status,
        body: msg.to_string(),
        elapsed_ms,
        size_bytes: 0,
        metadata: metadata_section(stdout, "Response headers received:"),
        trailers: metadata_section(stdout, "Response trailers received:"),
        details: stderr
            .split_once("Details:")
            .map(|(_, d)| details(d))
            .unwrap_or_default(),
    })
}

/// The JSON objects grpcurl prints under `Details:` (`1)\t{...}`).
fn details(text: &str) -> Vec<GrpcErrorDetail> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find('{') {
        let mut it =
            serde_json::Deserializer::from_str(&rest[i..]).into_iter::<serde_json::Value>();
        let Some(Ok(v)) = it.next() else { break };
        rest = &rest[i + it.byte_offset()..];
        let type_name = v["@type"].as_str().unwrap_or_default();
        let type_name = type_name.rsplit('/').next().unwrap_or_default().to_string();
        let field_violations = v["fieldViolations"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|f| GrpcFieldViolation {
                field: f["field"].as_str().unwrap_or_default().to_string(),
                description: f["description"].as_str().unwrap_or_default().to_string(),
            })
            .collect();
        out.push(GrpcErrorDetail {
            type_name,
            field_violations,
        });
    }
    out
}

#[allow(clippy::too_many_arguments)]
pub async fn call(
    bin: &std::path::Path,
    endpoint: &str,
    plaintext: bool,
    tls: &GrpcTls,
    cache: GrpcDescriptorCache,
    method_symbol: &str,
    json_body: &str,
    metadata: &HashMap<String, String>,
    prefs: &GrpcPrefs,
) -> Result<GrpcResult, String> {
    let method = cache
        .methods
        .get(method_symbol)
        .ok_or_else(|| format!("unknown method: {method_symbol}"))?;
    if method.is_client_streaming() || method.is_server_streaming() {
        return Err(format!(
            "{method_symbol} is a streaming RPC; bonk currently supports unary calls only."
        ));
    }

    let protoset = std::env::temp_dir().join(format!("bonk-{}.protoset", fastrand::u64(..)));
    std::fs::write(&protoset, method.parent_pool().encode_to_vec())
        .map_err(|e| format!("write protoset failed: {e}"))?;

    let (host, plaintext) = target(endpoint, plaintext);
    let mut cmd = tokio::process::Command::new(bin);
    let mut secret_dir: Option<SecretDir> = None;
    if plaintext {
        cmd.arg("-plaintext");
    } else {
        if tls.insecure {
            cmd.arg("-insecure");
        }
        if let Some(ca) = &tls.ca_cert {
            cmd.arg("-cacert").arg(ca);
        }
        if tls.client_p12.as_deref().is_some_and(|p| !p.is_empty()) {
            // grpcurl takes PEM files: unpack the bundle into a private temp dir
            // (0700, files 0600), removed by the guard on every exit path.
            let (cert, key) = tls
                .client_identity_pem()?
                .ok_or("client identity missing")?;
            let dir = secret_dir.insert(SecretDir::create()?);
            cmd.arg("-cert").arg(dir.write("cert.pem", &cert)?);
            cmd.arg("-key").arg(dir.write("key.pem", &key)?);
        } else if let (Some(cert), Some(key)) = (&tls.client_cert, &tls.client_key) {
            cmd.arg("-cert").arg(cert).arg("-key").arg(key);
        }
    }
    cmd.arg("-protoset")
        .arg(&protoset)
        .args([
            "-v",
            "-format",
            "json",
            "-connect-timeout",
            "8",
            "-max-msg-sz",
        ])
        .arg(prefs.max_message_bytes().to_string())
        .args(["-d", "@"]);
    for (key, value) in metadata {
        cmd.arg("-H").arg(format!("{key}: {value}"));
    }
    cmd.arg(host)
        .arg(method_path(method_symbol))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Cancel / timeout drops the future → kill grpcurl with it.
        .kill_on_drop(true);

    let start = Instant::now();
    let run = async {
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("grpcurl spawn failed: {e}"))?;
        let mut stdin = child.stdin.take().expect("piped stdin");
        stdin
            .write_all(json_body.as_bytes())
            .await
            .map_err(|e| format!("grpcurl stdin failed: {e}"))?;
        drop(stdin);
        child
            .wait_with_output()
            .await
            .map_err(|e| format!("grpcurl failed: {e}"))
    };
    let output = run.await;
    let _ = std::fs::remove_file(&protoset);
    drop(secret_dir);
    let output = output?;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() {
        return status_error(
            &String::from_utf8_lossy(&output.stderr),
            &stdout,
            elapsed_ms,
        );
    }
    // Re-decode through the descriptor so body formatting and wire size match
    // the native path exactly.
    let contents = stdout
        .split_once("Response contents:\n")
        .map(|(_, c)| c)
        .unwrap_or(&stdout);
    let mut de = serde_json::Deserializer::from_str(contents);
    let msg = method
        .output()
        .deserialize(&mut de)
        .map_err(|e| format!("grpcurl response parse failed: {e}\n{stdout}"))?;
    let body = prefs.render(&msg, true)?;

    Ok(GrpcResult {
        ok: true,
        status: "OK".into(),
        size_bytes: msg.encoded_len(),
        body,
        elapsed_ms,
        metadata: metadata_section(&stdout, "Response headers received:"),
        trailers: metadata_section(&stdout, "Response trailers received:"),
        details: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers() {
        assert_eq!(
            method_path("grpcbin.GRPCBin.Empty"),
            "grpcbin.GRPCBin/Empty"
        );
        assert_eq!(target("http://h:1", false), ("h:1", true));
        assert_eq!(target("https://h:1", true), ("h:1", false));
        assert_eq!(target("h:1", true), ("h:1", true));
        let out = "\nResponse headers received:\ncontent-type: application/grpc\ntrailer: Grpc-Status\ntrailer: Grpc-Message\n\nResponse contents:\n{\n  \"a\": 1\n}\n\nResponse trailers received:\nx-trace: 7\nSent 1 request and received 1 response\n";
        let h = metadata_section(out, "Response headers received:");
        assert_eq!(h["trailer"], "Grpc-Status, Grpc-Message");
        assert_eq!(
            metadata_section(out, "Response trailers received:")["x-trace"],
            "7"
        );
        assert!(metadata_section(
            "\nResponse trailers received:\n(empty)\nSent 1",
            "Response trailers received:"
        )
        .is_empty());
        let r = status_error(
            "ERROR:\n  Code: InvalidArgument\n  Message: name must not be empty\n  Details:\n  1)\t{\n      \"@type\": \"type.googleapis.com/google.rpc.BadRequest\",\n      \"fieldViolations\": [{\"field\": \"name\", \"description\": \"must not be empty\"}]\n    }\n",
            "",
            8,
        )
        .unwrap();
        assert_eq!(
            (r.ok, r.status.as_str(), r.body.as_str()),
            (false, "INVALID_ARGUMENT", "name must not be empty")
        );
        assert_eq!(r.details[0].type_name, "google.rpc.BadRequest");
        assert_eq!(r.details[0].field_violations[0].field, "name");
        assert_eq!(
            status_error("Failed to dial target host \"x\": refused\n", "", 0).unwrap_err(),
            "Failed to dial target host \"x\": refused"
        );
    }

    #[test]
    #[ignore = "network smoke test against public grpcb.in, needs grpcurl"]
    fn grpcb_grpcurl_smoke() {
        let bin = find_grpcurl().expect("grpcurl installed");
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let cache = crate::application::grpc_native::reflect("grpcb.in:9000", true)
                .await
                .unwrap();
            let result = call(
                &bin,
                "grpcb.in:9000",
                true,
                &GrpcTls::default(),
                cache,
                "grpcbin.GRPCBin.DummyUnary",
                r#"{"fString":"hi","fInt32":7}"#,
                &HashMap::new(),
                &GrpcPrefs::default(),
            )
            .await
            .unwrap();
            assert!(result.ok);
            assert!(result.body.contains("hi"), "{}", result.body);
        });
    }
}
