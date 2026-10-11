use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcMethod {
    pub name: String,
    pub symbol: String,
    /// True if the client side of this RPC is a stream (client/bidi streaming).
    #[serde(default)]
    pub client_streaming: bool,
    /// True if the server side of this RPC is a stream (server/bidi streaming).
    #[serde(default)]
    pub server_streaming: bool,
    /// Full name of the request message type (e.g. `helloworld.HelloRequest`).
    #[serde(default)]
    pub input_type: String,
    /// Field count of the request message, for the editor's validation hint.
    #[serde(default)]
    pub input_fields: usize,
    /// Full name of the response message type (e.g. `helloworld.HelloReply`).
    #[serde(default)]
    pub output_type: String,
    /// Top-level request fields, for the editor's completions and checks (G4).
    #[serde(default)]
    pub input_schema: Vec<GrpcField>,
}

/// One request-message field as the message editor sees it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcField {
    /// JSON name (`lowerCamelCase`); `proto_name` is accepted too.
    pub name: String,
    pub proto_name: String,
    /// Display type: `string`, `enum Greeting`, `repeated string`, `map<string, int32>`.
    pub type_label: String,
    /// Expected JSON shape: string | number | boolean | object | array | enum | any.
    pub json: String,
    /// First line of the field's .proto comment (empty under reflection without source info).
    #[serde(default)]
    pub doc: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enum_values: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GrpcService {
    pub name: String,
    pub methods: Vec<GrpcMethod>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServiceTree {
    pub services: Vec<GrpcService>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GrpcResult {
    pub ok: bool,
    pub status: String,
    pub body: String,
    pub elapsed_ms: u64,
    pub size_bytes: usize,
    /// Response metadata (headers and trailers, as tonic merges them for unary calls).
    #[serde(default)]
    pub metadata: std::collections::BTreeMap<String, String>,
    /// Trailing metadata, kept apart from the headers (S19 «Trailers»).
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub trailers: std::collections::BTreeMap<String, String>,
    /// Decoded `grpc-status-details-bin` entries of a failed call (S24).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub details: Vec<GrpcErrorDetail>,
}

/// One `google.rpc.Status.details` entry. Only `google.rpc.BadRequest` is
/// decoded into field violations; other types keep just their name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcErrorDetail {
    pub type_name: String,
    #[serde(default)]
    pub field_violations: Vec<GrpcFieldViolation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GrpcFieldViolation {
    pub field: String,
    pub description: String,
}

/// TLS options for a gRPC connection (S29). Empty = system roots, verified.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcTls {
    /// Skip server certificate verification (self-signed dev servers).
    #[serde(default)]
    pub insecure: bool,
    /// PEM file with extra trusted CA certificates.
    #[serde(default)]
    pub ca_cert: Option<String>,
    /// Additional PEM bundles supplied by headless network settings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ca_paths: Vec<String>,
    /// Trust only explicitly configured CA certificates.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub disable_system_cas: bool,
    /// PEM client certificate + key for mTLS.
    #[serde(default)]
    pub client_cert: Option<String>,
    #[serde(default)]
    pub client_key: Option<String>,
    /// PKCS#12 client identity (replaces `client_cert` + `client_key`).
    #[serde(default)]
    pub client_p12: Option<String>,
    #[serde(default)]
    pub client_p12_password: Option<String>,
}

/// An mTLS identity: `(certificate chain PEM, private key PEM)`.
pub type PemIdentity = (Vec<u8>, Vec<u8>);

impl GrpcTls {
    /// The mTLS identity as `(certificate chain PEM, private key PEM)`, from the
    /// PKCS#12 bundle or the PEM file pair; `None` when no client identity is set.
    pub fn client_identity_pem(&self) -> Result<Option<PemIdentity>, String> {
        if let Some(p12) = self.client_p12.as_deref().filter(|p| !p.is_empty()) {
            let password = self.client_p12_password.as_deref().unwrap_or_default();
            return crate::infra::pkcs12::p12_to_pem(p12, password).map(Some);
        }
        match (&self.client_cert, &self.client_key) {
            (Some(cert), Some(key)) => {
                let cert =
                    std::fs::read(cert).map_err(|e| format!("client certificate {cert}: {e}"))?;
                let key = std::fs::read(key).map_err(|e| format!("client key {key}: {e}"))?;
                Ok(Some((cert, key)))
            }
            _ => Ok(None),
        }
    }
}

/// Global gRPC limits and rendering options from Settings → gRPC.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GrpcPrefs {
    /// Max inbound/outbound message size, MB.
    pub max_message_mb: u32,
    /// HTTP/2 keepalive ping interval, seconds; 0 = off.
    pub keepalive_secs: u32,
    /// Render zero/empty response fields too.
    pub emit_defaults: bool,
    /// Render int64/uint64 as JSON numbers instead of strings.
    pub int64_as_number: bool,
}

impl Default for GrpcPrefs {
    fn default() -> Self {
        Self {
            max_message_mb: 250,
            keepalive_secs: 30,
            emit_defaults: false,
            int64_as_number: false,
        }
    }
}

impl GrpcPrefs {
    pub fn max_message_bytes(&self) -> usize {
        self.max_message_mb.clamp(1, 250) as usize * 1024 * 1024
    }

    fn options(&self) -> prost_reflect::SerializeOptions {
        prost_reflect::SerializeOptions::new()
            .skip_default_fields(!self.emit_defaults)
            .stringify_64_bit_integers(!self.int64_as_number)
    }

    /// JSON of a response message under these rendering options.
    pub fn render(
        &self,
        msg: &prost_reflect::DynamicMessage,
        pretty: bool,
    ) -> Result<String, String> {
        let opts = self.options();
        let mut out = Vec::new();
        let res = if pretty {
            msg.serialize_with_options(&mut serde_json::Serializer::pretty(&mut out), &opts)
        } else {
            msg.serialize_with_options(&mut serde_json::Serializer::new(&mut out), &opts)
        };
        res.map_err(|e| format!("response json failed: {e}"))?;
        String::from_utf8(out).map_err(|e| format!("response json failed: {e}"))
    }

    /// Pretty JSON array of response messages (server streams).
    pub fn render_all(&self, msgs: &[prost_reflect::DynamicMessage]) -> Result<String, String> {
        use serde::ser::{Serialize, SerializeSeq, Serializer};
        struct Item<'a>(
            &'a prost_reflect::DynamicMessage,
            &'a prost_reflect::SerializeOptions,
        );
        impl Serialize for Item<'_> {
            fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                self.0.serialize_with_options(s, self.1)
            }
        }
        struct All<'a>(
            &'a [prost_reflect::DynamicMessage],
            prost_reflect::SerializeOptions,
        );
        impl Serialize for All<'_> {
            fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                let mut seq = s.serialize_seq(Some(self.0.len()))?;
                for m in self.0 {
                    seq.serialize_element(&Item(m, &self.1))?;
                }
                seq.end()
            }
        }
        serde_json::to_string_pretty(&All(msgs, self.options()))
            .map_err(|e| format!("response json failed: {e}"))
    }
}

/// What the server presented during the TLS handshake (S29 popover).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcCertInfo {
    pub verified: bool,
    /// Verification failure reason when `verified` is false.
    pub error: Option<String>,
    pub subject: String,
    pub issuer: String,
    /// Expiry as unix seconds.
    pub not_after: i64,
}

/// What went wrong in a gRPC connect/reflect/call, as a gRPC status code, so the UI
/// branches on `code` instead of matching words in `message`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GrpcErrorCode {
    /// Anything not classified below.
    Unknown,
    Cancelled,
    /// Bad endpoint, request JSON or metadata: fixable in the editor.
    InvalidArgument,
    DeadlineExceeded,
    /// The server could not be reached (dial, TCP, TLS handshake).
    Unavailable,
}

/// Error of the gRPC commands; serialises as `{ "code": "UNAVAILABLE", "message": "…" }`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GrpcError {
    pub code: GrpcErrorCode,
    pub message: String,
}

impl GrpcError {
    pub fn new(code: GrpcErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Untyped `String` errors (`?` on the many helpers that return one) stay `Unknown`.
impl From<String> for GrpcError {
    fn from(message: String) -> Self {
        Self::new(GrpcErrorCode::Unknown, message)
    }
}

impl From<&str> for GrpcError {
    fn from(message: &str) -> Self {
        Self::new(GrpcErrorCode::Unknown, message)
    }
}

/// Lets `String`-error callers (bonk-mcp, tests) keep using `?`.
impl From<GrpcError> for String {
    fn from(e: GrpcError) -> Self {
        e.message
    }
}

impl std::fmt::Display for GrpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grpc_error_serialises_as_code_and_message() {
        // The webview reads exactly this shape (`grpcInvoke` in src/shared/ipc/api.ts).
        let e = GrpcError::new(GrpcErrorCode::DeadlineExceeded, "timed out");
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            serde_json::json!({ "code": "DEADLINE_EXCEEDED", "message": "timed out" })
        );
    }
}
