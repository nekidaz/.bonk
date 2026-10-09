use crate::conn::GrpcDescriptorCache;
use crate::domain::grpc::{
    GrpcErrorDetail, GrpcField, GrpcFieldViolation, GrpcMethod, GrpcPrefs, GrpcResult, GrpcService, GrpcTls,
    ServiceTree,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use bytes::Buf;
use http::uri::PathAndQuery;
use prost::bytes::Bytes;
use prost::Message;
use prost_reflect::{
    DescriptorPool, DynamicMessage, FieldDescriptor, Kind, MapKey, MessageDescriptor, Value,
};
use serde::de::DeserializeSeed;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio_stream::StreamExt;
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::metadata::{
    AsciiMetadataKey, AsciiMetadataValue, BinaryMetadataKey, BinaryMetadataValue, MetadataMap,
};
use tonic::transport::{Certificate, Channel, ClientTlsConfig, Endpoint, Identity};
use tonic::{Code, Request, Status};

/// Extract the TLS SNI host from an endpoint: drop any scheme and `:port`, and
/// unwrap `[..]` IPv6 literals so `[::1]:8080` yields `::1` (not `[`).
fn tls_domain(endpoint: &str) -> &str {
    let host = endpoint
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    if let Some(rest) = host.strip_prefix('[') {
        rest.split(']').next().unwrap_or(host)
    } else {
        host.split(':').next().unwrap_or(host)
    }
}

pub async fn connect(endpoint: &str, plaintext: bool) -> Result<Channel, String> {
    connect_with(
        endpoint,
        plaintext,
        &GrpcTls::default(),
        &GrpcPrefs::default(),
    )
    .await
}

/// Like [`connect`], with custom TLS (extra CA, mTLS identity, or no verification).
pub async fn connect_with(
    endpoint: &str,
    plaintext: bool,
    tls: &GrpcTls,
    prefs: &GrpcPrefs,
) -> Result<Channel, String> {
    let secure = !plaintext && !endpoint.starts_with("http://");
    if secure && tls.insecure {
        return super::grpc_tls::connect_insecure(endpoint, tls, prefs).await;
    }
    let uri = if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
        endpoint.to_string()
    } else if plaintext {
        format!("http://{endpoint}")
    } else {
        format!("https://{endpoint}")
    };
    let mut builder = Endpoint::from_shared(uri.clone())
        .map_err(|e| format!("invalid endpoint {uri}: {e}"))?
        // Bound the TCP/TLS handshake so an unreachable endpoint fails fast
        // instead of leaving the UI stuck "connecting" forever.
        .connect_timeout(std::time::Duration::from_secs(8));
    if prefs.keepalive_secs > 0 {
        builder = builder
            .http2_keep_alive_interval(std::time::Duration::from_secs(prefs.keepalive_secs.into()))
            .keep_alive_while_idle(true);
    }
    if !plaintext {
        let mut config = ClientTlsConfig::new()
            .domain_name(tls_domain(endpoint))
            .with_enabled_roots();
        if let Some(ca) = &tls.ca_cert {
            let pem = std::fs::read(ca).map_err(|e| format!("CA {ca}: {e}"))?;
            config = config.ca_certificate(Certificate::from_pem(pem));
        }
        if let Some((cert, key)) = tls.client_identity_pem()? {
            config = config.identity(Identity::from_pem(cert, key));
        }
        builder = builder
            .tls_config(config)
            .map_err(|e| format!("tls config failed: {e}"))?;
    }
    builder
        .connect()
        .await
        .map_err(|e| format!("connect failed: {e}"))
}

pub async fn reflect(endpoint: &str, plaintext: bool) -> Result<GrpcDescriptorCache, String> {
    reflect_with(
        endpoint,
        plaintext,
        &GrpcTls::default(),
        &GrpcPrefs::default(),
    )
    .await
}

pub async fn reflect_with(
    endpoint: &str,
    plaintext: bool,
    tls: &GrpcTls,
    prefs: &GrpcPrefs,
) -> Result<GrpcDescriptorCache, String> {
    // Use a FRESH connection per reflection attempt. A server that only speaks
    // v1alpha resets the connection when asked for the unknown v1 reflection
    // service; reusing one channel would carry that reset into the v1alpha
    // fallback (ConnectionReset). grpcurl works precisely because it tries a
    // single version per connection. Each attempt is also time-bounded so a
    // server that accepts the connection but never answers can't hang us.
    let dur = std::time::Duration::from_secs(10);
    if let Ok(channel) = connect_with(endpoint, plaintext, tls, prefs).await {
        if let Ok(Ok(cache)) = tokio::time::timeout(dur, reflect_v1(channel)).await {
            return Ok(cache);
        }
    }
    let channel = connect_with(endpoint, plaintext, tls, prefs).await?;
    match tokio::time::timeout(dur, reflect_v1alpha(channel)).await {
        Ok(result) => result,
        Err(_) => Err("reflection timed out".to_string()),
    }
}

/// Build an example request body for `method` as pretty JSON.
///
/// Every field is populated with a RANDOM, type-appropriate value (see
/// [`example_message`]), so re-invoking "Use Example Message" yields fresh
/// sample data each time — the result is intentionally not cached.
pub fn template(cache: &mut GrpcDescriptorCache, method: &str) -> Result<String, String> {
    let method = cache
        .methods
        .get(method)
        .ok_or_else(|| format!("unknown method: {method}"))?;
    let msg = example_message(&method.input(), 0);
    let mut ser = serde_json::Serializer::pretty(Vec::new());
    msg.serialize_with_options(
        &mut ser,
        &prost_reflect::SerializeOptions::new().skip_default_fields(false),
    )
    .map_err(|e| format!("template serialization failed: {e}"))?;
    String::from_utf8(ser.into_inner()).map_err(|e| format!("template utf8 failed: {e}"))
}

/// Maximum message-nesting depth before we stop recursing and emit an empty
/// sub-message. Bounds recursion for self-referential / mutually-recursive
/// message types so generation always terminates.
const MAX_EXAMPLE_DEPTH: u8 = 5;

/// Build a [`DynamicMessage`] for `desc` with every field set to a random,
/// type-correct sample value.
fn example_message(desc: &MessageDescriptor, depth: u8) -> DynamicMessage {
    let mut msg = DynamicMessage::new(desc.clone());
    for field in desc.fields() {
        msg.set_field(&field, example_field_value(&field, depth));
    }
    msg
}

/// Produce a sample [`Value`] for a single field, honouring list/map cardinality.
fn example_field_value(field: &FieldDescriptor, depth: u8) -> Value {
    if field.is_map() {
        // A map field's kind is a synthetic "map entry" message with `key` and
        // `value` fields; emit a single entry sampled from those kinds.
        if let Kind::Message(entry) = field.kind() {
            let key_field = entry.map_entry_key_field();
            let value_field = entry.map_entry_value_field();
            let key = match scalar_or_message_value(&key_field, depth) {
                Value::Bool(b) => MapKey::Bool(b),
                Value::I32(n) => MapKey::I32(n),
                Value::I64(n) => MapKey::I64(n),
                Value::U32(n) => MapKey::U32(n),
                Value::U64(n) => MapKey::U64(n),
                Value::String(s) => MapKey::String(s),
                // Map keys can only be integral/bool/string in protobuf; fall
                // back to a string key for anything unexpected.
                _ => MapKey::String("key".to_string()),
            };
            let value = scalar_or_message_value(&value_field, depth);
            let mut map = HashMap::new();
            map.insert(key, value);
            return Value::Map(map);
        }
        return Value::Map(HashMap::new());
    }
    if field.is_list() {
        return Value::List(vec![scalar_or_message_value(field, depth)]);
    }
    scalar_or_message_value(field, depth)
}

/// Produce a sample scalar / enum / message [`Value`] based on the field's kind,
/// ignoring list/map cardinality (callers handle that).
fn scalar_or_message_value(field: &FieldDescriptor, depth: u8) -> Value {
    match field.kind() {
        Kind::Bool => Value::Bool(fastrand::bool()),
        Kind::Int32 | Kind::Sint32 | Kind::Sfixed32 => Value::I32(fastrand::i32(1..1000)),
        Kind::Int64 | Kind::Sint64 | Kind::Sfixed64 => Value::I64(fastrand::i64(1..1_000_000)),
        Kind::Uint32 | Kind::Fixed32 => Value::U32(fastrand::u32(1..1000)),
        Kind::Uint64 | Kind::Fixed64 => Value::U64(fastrand::u64(1..1_000_000)),
        Kind::Float => {
            // Random value in [1.00, 1000.00) rounded to 2 decimals.
            let v = ((fastrand::f32() * 999.0 + 1.0) * 100.0).round() / 100.0;
            Value::F32(v)
        }
        Kind::Double => {
            let v = ((fastrand::f64() * 999.0 + 1.0) * 100.0).round() / 100.0;
            Value::F64(v)
        }
        Kind::String => random_string(field.name()),
        Kind::Bytes => {
            let len = fastrand::usize(3..8);
            let bytes: Vec<u8> = (0..len).map(|_| fastrand::u8(..)).collect();
            Value::Bytes(Bytes::from(bytes))
        }
        Kind::Enum(e) => {
            // Prefer a non-zero ("real") variant when the enum has more than the
            // default value, so the example isn't always the proto3 default.
            let values: Vec<_> = e.values().collect();
            let chosen = if values.len() > 1 {
                let non_zero: Vec<_> = values.iter().filter(|v| v.number() != 0).collect();
                if non_zero.is_empty() {
                    values[fastrand::usize(..values.len())].number()
                } else {
                    non_zero[fastrand::usize(..non_zero.len())].number()
                }
            } else if let Some(v) = values.first() {
                v.number()
            } else {
                0
            };
            Value::EnumNumber(chosen)
        }
        Kind::Message(m) => {
            if depth < MAX_EXAMPLE_DEPTH && !is_well_known(&m) {
                Value::Message(example_message(&m, depth + 1))
            } else {
                // Bound recursion (self-referential types) and avoid building
                // bogus values for well-known types like Timestamp/wrappers,
                // which prost-reflect serializes specially.
                Value::Message(DynamicMessage::new(m))
            }
        }
    }
}

/// Whether `desc` is a protobuf well-known type (`google.protobuf.*`). These
/// have special JSON representations (Timestamp, Duration, wrappers, Any, …);
/// emitting an empty instance keeps the example valid without hand-crafting
/// each special form.
fn is_well_known(desc: &MessageDescriptor) -> bool {
    desc.full_name().starts_with("google.protobuf.")
}

/// A short random alphanumeric token of `len` lowercase chars/digits.
fn random_alnum(len: usize) -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    (0..len)
        .map(|_| CHARS[fastrand::usize(..CHARS.len())] as char)
        .collect()
}

/// A random lowercase-hex token of `len` chars.
fn random_hex(len: usize) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    (0..len)
        .map(|_| HEX[fastrand::usize(..HEX.len())] as char)
        .collect()
}

/// A random numeric string of exactly `len` digits (first digit non-zero).
fn random_digits(len: usize) -> String {
    let mut s = String::with_capacity(len);
    s.push(char::from(b'1' + fastrand::u8(0..9)));
    for _ in 1..len {
        s.push(char::from(b'0' + fastrand::u8(0..10)));
    }
    s
}

/// Generate a realistic random string for a `string` field, using light
/// field-name heuristics so the example looks plausible (emails, phones, ids…).
fn random_string(field_name: &str) -> Value {
    const NAMES: &[&str] = &[
        "Alice", "Bob", "Carol", "David", "Eve", "Frank", "Grace", "Heidi", "Ivan", "Judy",
    ];
    let lower = field_name.to_ascii_lowercase();
    let s = if lower.contains("mail") {
        format!("user{}@example.com", fastrand::u32(1..9999))
    } else if lower.contains("phone") {
        random_digits(if fastrand::bool() { 10 } else { 11 })
    } else if lower.contains("iin") || lower.contains("bin") {
        random_digits(12)
    } else if lower.contains("uuid") || lower.contains("id") {
        random_hex(16)
    } else if lower.contains("name") {
        NAMES[fastrand::usize(..NAMES.len())].to_string()
    } else if lower.contains("url") {
        format!("https://example.com/{}", random_hex(8))
    } else {
        format!("sample-{}", random_alnum(6))
    };
    Value::String(s)
}

/// Decode one JSON request message for `method`.
fn parse_message(
    method: &prost_reflect::MethodDescriptor,
    json_body: &str,
) -> Result<DynamicMessage, String> {
    let mut de = serde_json::Deserializer::from_str(json_body);
    let req_msg = method.input().deserialize(&mut de).map_err(|e| {
        format!(
            "request json does not match {}: {e}",
            method.input().full_name()
        )
    })?;
    de.end()
        .map_err(|e| format!("invalid trailing json: {e}"))?;
    Ok(req_msg)
}

/// Request messages for a streaming call: a client stream takes a JSON array
/// (one element per message) or a single object; anything else sends one message.
fn parse_messages(
    method: &prost_reflect::MethodDescriptor,
    json_body: &str,
) -> Result<Vec<DynamicMessage>, String> {
    if !method.is_client_streaming() {
        return Ok(vec![parse_message(method, json_body)?]);
    }
    match serde_json::from_str::<serde_json::Value>(json_body) {
        Ok(serde_json::Value::Array(items)) => items
            .iter()
            .enumerate()
            .map(|(i, item)| {
                method.input().deserialize(item).map_err(|e| {
                    format!(
                        "request message #{} does not match {}: {e}",
                        i + 1,
                        method.input().full_name()
                    )
                })
            })
            .collect(),
        _ => Ok(vec![parse_message(method, json_body)?]),
    }
}

/// Build the outgoing request (body + metadata) and its path.
fn prepare_request<T>(
    method: &prost_reflect::MethodDescriptor,
    body: T,
    metadata: &HashMap<String, String>,
) -> Result<(Request<T>, PathAndQuery), String> {
    let path = PathAndQuery::from_maybe_shared(format!(
        "/{}/{}",
        method.parent_service().full_name(),
        method.name()
    ))
    .map_err(|e| format!("invalid grpc path: {e}"))?;

    let mut req = Request::new(body);
    for (key, value) in metadata {
        insert_metadata(req.metadata_mut(), key, value)?;
    }
    Ok((req, path))
}

/// Response metadata as plain strings (binary values shown as their debug form).
fn metadata_strings(map: &MetadataMap) -> std::collections::BTreeMap<String, String> {
    map.iter()
        .map(|kv| match kv {
            tonic::metadata::KeyAndValueRef::Ascii(k, v) => {
                (k.to_string(), v.to_str().unwrap_or_default().to_string())
            }
            tonic::metadata::KeyAndValueRef::Binary(k, v) => (k.to_string(), format!("{v:?}")),
        })
        .collect()
}

pub async fn call(
    channel: Channel,
    cache: GrpcDescriptorCache,
    method_symbol: &str,
    json_body: &str,
    metadata: &HashMap<String, String>,
) -> Result<GrpcResult, String> {
    call_with(
        channel,
        cache,
        method_symbol,
        json_body,
        metadata,
        &GrpcPrefs::default(),
    )
    .await
}

pub async fn call_with(
    channel: Channel,
    cache: GrpcDescriptorCache,
    method_symbol: &str,
    json_body: &str,
    metadata: &HashMap<String, String>,
    prefs: &GrpcPrefs,
) -> Result<GrpcResult, String> {
    let method = cache
        .methods
        .get(method_symbol)
        .ok_or_else(|| format!("unknown method: {method_symbol}"))?
        .clone();
    // Unary only here; streams go through `call_stream`. Invoking a
    // streaming RPC as unary returns a wrong/partial result or hangs until timeout.
    if method.is_client_streaming() || method.is_server_streaming() {
        return Err(format!("{method_symbol} is a streaming RPC; use a stream call."));
    }
    let (req, path) = prepare_request(&method, parse_message(&method, json_body)?, metadata)?;

    let start = Instant::now();
    // Shared counter the decoder writes the raw protobuf byte count into, so we
    // can report the real wire size (not the JSON-encoded length) below.
    let wire_size = Arc::new(AtomicUsize::new(0));
    let codec = DynamicCodec {
        output: method.output(),
        wire_size: wire_size.clone(),
    };
    // Cap the inbound message size so a peer can't make us buffer an unbounded
    // response. tonic's default ceiling is only 4MB, which bonk routinely needs
    // to exceed, so raise it to the HTTP body cap rather than removing it.
    let mut grpc = tonic::client::Grpc::new(channel)
        .max_decoding_message_size(prefs.max_message_bytes())
        .max_encoding_message_size(prefs.max_message_bytes());
    grpc.ready()
        .await
        .map_err(|e| format!("grpc client not ready: {e}"))?;
    // A unary RPC is one message each way on the wire, so drive it as a
    // server stream: unlike `unary`, that keeps headers and trailers apart.
    let response = match grpc.server_streaming(req, path, codec).await {
        Ok(response) => response,
        Err(status) => {
            let elapsed = start.elapsed().as_millis() as u64;
            return Ok(status_result(&status, elapsed, 0, Default::default()));
        }
    };
    let metadata = metadata_strings(response.metadata());
    let mut stream = response.into_inner();
    let response_msg = match stream.message().await {
        Ok(Some(msg)) => msg,
        Ok(None) => return Err("server closed the call without a response message".into()),
        Err(status) => {
            let elapsed = start.elapsed().as_millis() as u64;
            return Ok(status_result(&status, elapsed, 0, metadata));
        }
    };
    let trailers = match stream.trailers().await {
        Ok(t) => t.map(|t| metadata_strings(&t)).unwrap_or_default(),
        Err(status) => {
            let elapsed = start.elapsed().as_millis() as u64;
            return Ok(status_result(&status, elapsed, 0, metadata));
        }
    };
    let elapsed_ms = start.elapsed().as_millis() as u64;
    let body = prefs.render(&response_msg, true)?;

    Ok(GrpcResult {
        ok: true,
        status: "OK".into(),
        // Report the raw protobuf wire byte count captured by the decoder.
        size_bytes: wire_size.load(Ordering::Relaxed),
        body,
        elapsed_ms,
        metadata,
        trailers,
        details: Vec::new(),
    })
}

/// `InvalidArgument` → `INVALID_ARGUMENT`, the canonical gRPC code name.
pub(crate) fn code_name(code: Code) -> String {
    let mut out = String::new();
    for (i, c) in format!("{code:?}").chars().enumerate() {
        if i > 0 && c.is_ascii_uppercase() {
            out.push('_');
        }
        out.push(c.to_ascii_uppercase());
    }
    out
}

/// A non-OK status as a failed result (not `Err`), so the UI keeps the real
/// code, message, trailers and decoded details.
fn status_result(
    status: &Status,
    elapsed_ms: u64,
    size_bytes: usize,
    metadata: std::collections::BTreeMap<String, String>,
) -> GrpcResult {
    // A failed call's status metadata is what the server sent as trailers.
    let mut trailers = metadata_strings(status.metadata());
    trailers.remove("grpc-status-details-bin");
    GrpcResult {
        ok: false,
        status: code_name(status.code()),
        body: status.message().to_string(),
        elapsed_ms,
        size_bytes,
        metadata,
        trailers,
        details: decode_details(status.details()),
    }
}

/// `google.rpc.Status` as carried in `grpc-status-details-bin`.
#[derive(Clone, PartialEq, prost::Message)]
struct RpcStatus {
    #[prost(int32, tag = "1")]
    code: i32,
    #[prost(string, tag = "2")]
    message: String,
    #[prost(message, repeated, tag = "3")]
    details: Vec<prost_types::Any>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct BadRequest {
    #[prost(message, repeated, tag = "1")]
    field_violations: Vec<FieldViolation>,
}

#[derive(Clone, PartialEq, prost::Message)]
struct FieldViolation {
    #[prost(string, tag = "1")]
    field: String,
    #[prost(string, tag = "2")]
    description: String,
}

fn decode_details(bytes: &[u8]) -> Vec<GrpcErrorDetail> {
    let Ok(status) = RpcStatus::decode(bytes) else {
        return Vec::new();
    };
    status
        .details
        .into_iter()
        .map(|any| {
            let type_name = any
                .type_url
                .rsplit('/')
                .next()
                .unwrap_or_default()
                .to_string();
            let field_violations = if type_name == "google.rpc.BadRequest" {
                BadRequest::decode(any.value.as_slice())
                    .map(|b| {
                        b.field_violations
                            .into_iter()
                            .map(|v| GrpcFieldViolation {
                                field: v.field,
                                description: v.description,
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            } else {
                Vec::new()
            };
            GrpcErrorDetail {
                type_name,
                field_violations,
            }
        })
        .collect()
}

/// One message of a server stream, as it arrives.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcStreamMessage {
    pub index: usize,
    /// Unix time in milliseconds when the message was received.
    pub at_ms: u64,
    /// The message as compact JSON.
    pub body: String,
    pub size_bytes: usize,
    /// Set only on the first event (index 0): the response headers, which
    /// arrive before any message (S20 «Metadata» while streaming).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<std::collections::BTreeMap<String, String>>,
}

/// Feeds more request messages into an open client/bidi stream. Dropping it half-closes
/// the client side (the server then sees end-of-stream).
pub struct StreamSender {
    method: prost_reflect::MethodDescriptor,
    tx: tokio::sync::mpsc::UnboundedSender<DynamicMessage>,
}

impl StreamSender {
    /// Sends `json_body` (an object, or an array of objects) and returns how many went out.
    pub fn send(&self, json_body: &str) -> Result<usize, String> {
        let messages = parse_messages(&self.method, json_body)?;
        let n = messages.len();
        for msg in messages {
            self.tx
                .send(msg)
                .map_err(|_| "the stream is already closed".to_string())?;
        }
        Ok(n)
    }
}

/// A sender for `method_symbol` plus the receiver to hand to `call_stream`.
pub fn stream_sender(
    cache: &GrpcDescriptorCache,
    method_symbol: &str,
) -> Result<(StreamSender, StreamReceiver), String> {
    let method = cache
        .methods
        .get(method_symbol)
        .ok_or_else(|| format!("unknown method: {method_symbol}"))?
        .clone();
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    Ok((StreamSender { method, tx }, rx))
}

pub type StreamReceiver = tokio::sync::mpsc::UnboundedReceiver<DynamicMessage>;

/// Streaming call (server, client or bidi): the messages in `json_body` go out first, then
/// whatever arrives on `more` until its sender drops (`None` half-closes right away).
/// `on_message` sees every response as it arrives; the returned result summarises the
/// stream (all messages as a JSON array, total size, headers + trailers).
#[allow(clippy::too_many_arguments)]
pub async fn call_stream<F: FnMut(GrpcStreamMessage) + Send>(
    channel: Channel,
    cache: GrpcDescriptorCache,
    method_symbol: &str,
    json_body: &str,
    metadata: &HashMap<String, String>,
    prefs: &GrpcPrefs,
    more: Option<StreamReceiver>,
    mut on_message: F,
) -> Result<GrpcResult, String> {
    let method = cache
        .methods
        .get(method_symbol)
        .ok_or_else(|| format!("unknown method: {method_symbol}"))?
        .clone();
    if !method.is_client_streaming() && !method.is_server_streaming() {
        return Err(format!("{method_symbol} is not a streaming RPC."));
    }
    let messages = parse_messages(&method, json_body)?;
    // A closed channel yields nothing, so `None` ends the request stream after `messages`.
    let more = more.unwrap_or_else(|| tokio::sync::mpsc::unbounded_channel().1);
    let outgoing = tokio_stream::iter(messages)
        .chain(tokio_stream::wrappers::UnboundedReceiverStream::new(more));
    let (req, path) = prepare_request(&method, outgoing, metadata)?;
    let start = Instant::now();
    let wire_size = Arc::new(AtomicUsize::new(0));
    let codec = DynamicCodec {
        output: method.output(),
        wire_size: wire_size.clone(),
    };
    let mut grpc = tonic::client::Grpc::new(channel)
        .max_decoding_message_size(prefs.max_message_bytes())
        .max_encoding_message_size(prefs.max_message_bytes());
    grpc.ready()
        .await
        .map_err(|e| format!("grpc client not ready: {e}"))?;
    let response = match grpc.streaming(req, path, codec).await {
        Ok(response) => response,
        Err(status) => {
            let elapsed = start.elapsed().as_millis() as u64;
            return Ok(status_result(&status, elapsed, 0, Default::default()));
        }
    };
    let metadata = metadata_strings(response.metadata());
    on_message(GrpcStreamMessage {
        index: 0,
        at_ms: 0,
        body: String::new(),
        size_bytes: 0,
        headers: Some(metadata.clone()),
    });
    let mut stream = response.into_inner();
    let mut bodies = Vec::new();
    // The decoder stores each message's own wire size; the stream total is their sum.
    let mut total = 0usize;
    loop {
        let msg = match stream.message().await {
            Ok(Some(msg)) => msg,
            Ok(None) => break,
            // S26: a mid-stream error keeps what already arrived (the UI has it).
            Err(status) => {
                let elapsed = start.elapsed().as_millis() as u64;
                return Ok(status_result(&status, elapsed, total, metadata));
            }
        };
        let size = wire_size.load(Ordering::Relaxed);
        total += size;
        let body = prefs.render(&msg, false)?;
        on_message(GrpcStreamMessage {
            index: bodies.len() + 1,
            at_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or_default(),
            body,
            size_bytes: size,
            headers: None,
        });
        bodies.push(msg);
    }
    let trailers = match stream.trailers().await {
        Ok(t) => t.map(|t| metadata_strings(&t)).unwrap_or_default(),
        Err(_) => Default::default(),
    };
    let body = prefs.render_all(&bodies)?;
    Ok(GrpcResult {
        ok: true,
        status: "OK".into(),
        size_bytes: total,
        body,
        elapsed_ms: start.elapsed().as_millis() as u64,
        metadata,
        trailers,
        details: Vec::new(),
    })
}

/// Insert one request-metadata header into `md`.
///
/// Per the gRPC spec a key ending in `-bin` carries an opaque *binary* value:
/// the UI stores it base64-encoded, so we decode it and insert it via the
/// binary key path (tonic re-encodes it on the wire). Every other key is an
/// ASCII value. ASCII metadata values may not contain control characters, so a
/// value that can't be header-encoded (or a malformed `-bin` value / key) is a
/// user error — surface it as a clear `Err` rather than panicking on `unwrap`.
fn insert_metadata(md: &mut MetadataMap, key: &str, value: &str) -> Result<(), String> {
    // gRPC metadata keys are case-insensitive and must be lowercase ASCII on the
    // wire (tonic rejects uppercase). Lowercase here so users can type natural
    // header casing like `Authorization` without a cryptic "invalid key" error.
    let lowered = key.to_ascii_lowercase();
    let key = lowered.as_str();
    if key.ends_with("-bin") {
        let name = BinaryMetadataKey::from_bytes(key.as_bytes())
            .map_err(|e| format!("invalid metadata key {key}: {e}"))?;
        let raw = BASE64
            .decode(value.as_bytes())
            .map_err(|e| format!("metadata {key} must be base64 (-bin value): {e}"))?;
        let val = BinaryMetadataValue::from_bytes(&raw);
        md.insert_bin(name, val);
    } else {
        let name = AsciiMetadataKey::from_bytes(key.as_bytes())
            .map_err(|e| format!("invalid metadata key {key}: {e}"))?;
        let val = AsciiMetadataValue::try_from(value)
            .map_err(|e| format!("invalid metadata value for {key}: {e}"))?;
        md.insert(name, val);
    }
    Ok(())
}

// The `v1` and `v1alpha` reflection paths are byte-for-byte identical apart from
// the generated proto module they import and the version string baked into error
// messages. The two modules expose parallel-but-distinct generated types with no
// shared trait, so a generic abstraction would be convoluted; this macro generates
// both async fns from one body instead. `$module` is the `tonic_reflection::pb`
// submodule and `$label` is the version prefix used in every error message.
macro_rules! reflect_impl {
    ($name:ident, $module:ident, $label:literal) => {
        async fn $name(channel: Channel) -> Result<GrpcDescriptorCache, String> {
            use tonic_reflection::pb::$module::{
                server_reflection_client::ServerReflectionClient, server_reflection_request,
                server_reflection_response, ServerReflectionRequest,
            };

            let mut client = ServerReflectionClient::new(channel.clone());
            let response = client
                .server_reflection_info(tokio_stream::iter(vec![ServerReflectionRequest {
                    host: String::new(),
                    message_request: Some(
                        server_reflection_request::MessageRequest::ListServices(String::new()),
                    ),
                }]))
                .await
                .map_err(|e| format!("{} reflection list failed: {e}", $label))?;
            let mut stream = response.into_inner();
            let response = stream
                .next()
                .await
                .ok_or_else(|| format!("{} reflection list returned no response", $label))?
                .map_err(|e| format!("{} reflection list stream failed: {e}", $label))?;
            let services = match response.message_response {
                Some(server_reflection_response::MessageResponse::ListServicesResponse(list)) => {
                    list.service
                        .into_iter()
                        .map(|s| s.name)
                        .filter(|s| {
                            !s.starts_with("grpc.reflection.")
                        })
                        .collect::<Vec<_>>()
                }
                Some(server_reflection_response::MessageResponse::ErrorResponse(err)) => {
                    return Err(format!(
                        "{} reflection list error {}: {}",
                        $label, err.error_code, err.error_message
                    ));
                }
                _ => {
                    return Err(format!(
                        "{} reflection list returned unexpected response",
                        $label
                    ))
                }
            };

            // Fetch each service's file descriptors concurrently (one reflection stream
            // per service, all in flight at once) so this is ~1 round-trip, not N.
            let mut handles = Vec::new();
            for service in &services {
                let mut client = ServerReflectionClient::new(channel.clone());
                let service = service.clone();
                handles.push(tokio::spawn(async move {
                    let response = client
                        .server_reflection_info(tokio_stream::iter(vec![ServerReflectionRequest {
                            host: String::new(),
                            message_request: Some(
                                server_reflection_request::MessageRequest::FileContainingSymbol(
                                    service.clone(),
                                ),
                            ),
                        }]))
                        .await
                        .map_err(|e| {
                            format!("{} reflection file for {service} failed: {e}", $label)
                        })?;
                    let mut stream = response.into_inner();
                    let response = stream
                        .next()
                        .await
                        .ok_or_else(|| {
                            format!("{} reflection file for {service} returned no response", $label)
                        })?
                        .map_err(|e| {
                            format!(
                                "{} reflection file stream for {service} failed: {e}",
                                $label
                            )
                        })?;
                    match response.message_response {
                        Some(
                            server_reflection_response::MessageResponse::FileDescriptorResponse(fd),
                        ) => {
                            let mut protos = Vec::new();
                            for bytes in fd.file_descriptor_proto {
                                protos.push(
                                    prost_types::FileDescriptorProto::decode(bytes.as_slice())
                                        .map_err(|e| {
                                            format!("decode descriptor for {service} failed: {e}")
                                        })?,
                                );
                            }
                            Ok::<Vec<prost_types::FileDescriptorProto>, String>(protos)
                        }
                        Some(server_reflection_response::MessageResponse::ErrorResponse(err)) => {
                            Err(format!(
                                "{} reflection file for {service} error {}: {}",
                                $label, err.error_code, err.error_message
                            ))
                        }
                        _ => Err(format!(
                            "{} reflection file for {service} returned unexpected response",
                            $label
                        )),
                    }
                }));
            }

            let mut files = Vec::new();
            let mut seen = HashSet::new();
            for handle in handles {
                let protos = handle
                    .await
                    .map_err(|e| format!("{} reflection task failed: {e}", $label))??;
                for proto in protos {
                    if seen.insert(proto.name.clone().unwrap_or_default()) {
                        files.push(proto);
                    }
                }
            }
            cache_from_files(services, files)
        }
    };
}

reflect_impl!(reflect_v1, v1, "v1");
reflect_impl!(reflect_v1alpha, v1alpha, "v1alpha");

/// A field's scalar/enum/message type as (display label, expected JSON shape).
fn kind_info(kind: &Kind) -> (String, &'static str) {
    match kind {
        Kind::Bool => ("bool".into(), "boolean"),
        Kind::String | Kind::Bytes => (if matches!(kind, Kind::Bytes) { "bytes" } else { "string" }.into(), "string"),
        Kind::Float | Kind::Double | Kind::Int32 | Kind::Sint32 | Kind::Sfixed32 | Kind::Uint32 | Kind::Fixed32
        | Kind::Int64 | Kind::Sint64 | Kind::Sfixed64 | Kind::Uint64 | Kind::Fixed64 => {
            (format!("{kind:?}").to_lowercase(), "number")
        }
        Kind::Enum(e) => (format!("enum {}", e.name()), "enum"),
        // Well-known types have their own JSON forms (RFC 3339 strings, bare values…).
        Kind::Message(m) => {
            let json = match m.full_name() {
                "google.protobuf.Timestamp" | "google.protobuf.Duration" | "google.protobuf.FieldMask" => "string",
                "google.protobuf.StringValue" | "google.protobuf.BytesValue" => "string",
                "google.protobuf.BoolValue" => "boolean",
                "google.protobuf.Value" => "any",
                "google.protobuf.ListValue" => "array",
                n if n.starts_with("google.protobuf.") && n.ends_with("Value") => "number",
                _ => "object",
            };
            (m.name().to_string(), json)
        }
    }
}

/// First line of the field's leading (or trailing) .proto comment, when the
/// descriptor carries source info (compiled .proto; reflection usually doesn't).
fn field_doc(field: &FieldDescriptor) -> String {
    let file = field.parent_file();
    let Some(info) = &file.file_descriptor_proto().source_code_info else {
        return String::new();
    };
    info.location
        .iter()
        .find(|l| l.path == field.path())
        .and_then(|l| l.leading_comments.as_deref().or(l.trailing_comments.as_deref()))
        .and_then(|c| c.lines().map(str::trim).find(|l| !l.is_empty()))
        .unwrap_or_default()
        .to_string()
}

fn field_info(field: &FieldDescriptor) -> GrpcField {
    let kind = field.kind();
    let (label, json) = kind_info(&kind);
    let (type_label, json) = if field.is_map() {
        let entry = kind.as_message().expect("map entry is a message");
        let (k, _) = kind_info(&entry.map_entry_key_field().kind());
        let (v, _) = kind_info(&entry.map_entry_value_field().kind());
        (format!("map<{k}, {}>", v.trim_start_matches("enum ")), "object")
    } else if field.is_list() {
        (format!("repeated {}", label.trim_start_matches("enum ")), "array")
    } else {
        (label, json)
    };
    GrpcField {
        name: field.json_name().to_string(),
        proto_name: field.name().to_string(),
        type_label,
        json: json.to_string(),
        doc: field_doc(field),
        enum_values: kind
            .as_enum()
            .filter(|_| !field.is_map())
            .map(|e| e.values().map(|v| v.name().to_string()).collect())
            .unwrap_or_default(),
    }
}

fn cache_from_files(
    services: Vec<String>,
    files: Vec<prost_types::FileDescriptorProto>,
) -> Result<GrpcDescriptorCache, String> {
    let mut pool = DescriptorPool::new();
    pool.add_file_descriptor_protos(files)
        .map_err(|e| format!("descriptor pool build failed: {e}"))?;

    let mut methods = HashMap::new();
    let mut tree_services = Vec::new();
    for service_name in services {
        let Some(service) = pool.get_service_by_name(&service_name) else {
            continue;
        };
        let service_methods = service
            .methods()
            .map(|method| {
                let symbol = method.full_name().to_string();
                let client_streaming = method.is_client_streaming();
                let server_streaming = method.is_server_streaming();
                methods.insert(symbol.clone(), method.clone());
                GrpcMethod {
                    name: method.name().to_string(),
                    symbol,
                    client_streaming,
                    server_streaming,
                    input_type: method.input().full_name().to_string(),
                    input_fields: method.input().fields().len(),
                    output_type: method.output().full_name().to_string(),
                    input_schema: method.input().fields().map(|f| field_info(&f)).collect(),
                }
            })
            .collect::<Vec<_>>();
        tree_services.push(GrpcService {
            name: service_name,
            methods: service_methods,
        });
    }

    Ok(GrpcDescriptorCache {
        tree: ServiceTree {
            services: tree_services,
        },
        methods,
    })
}

/// Compile `.proto` files into the same descriptor cache that reflection
/// produces. `includes` are the compiler import roots (the parent directory of
/// each file in `files`, plus any user-chosen import root); each file in `files`
/// must live under one of them. Only services defined in the explicitly-requested
/// files are surfaced (mirroring how reflection lists only the server's own
/// services); imported files are still added to the descriptor pool so type
/// resolution succeeds.
pub fn compile_protos(
    files: &[String],
    includes: &[String],
) -> Result<GrpcDescriptorCache, String> {
    use protox::Compiler;
    // protox requires every opened file to live under an include dir.  Callers
    // pass absolute paths and may give an empty `includes` (e.g. the user picks
    // a .proto file without choosing an explicit import root), so we
    // automatically add each file's parent directory to the include set.
    // Settings → gRPC import paths may be written as `~/…`.
    let home = std::env::var("HOME").unwrap_or_default();
    let mut all_includes: Vec<String> = includes
        .iter()
        .map(|p| match p.strip_prefix("~/") {
            Some(rest) if !home.is_empty() => format!("{home}/{rest}"),
            _ => p.clone(),
        })
        .collect();
    for f in files {
        if let Some(parent) = std::path::Path::new(f).parent() {
            let p = parent.to_string_lossy().into_owned();
            if !all_includes.contains(&p) {
                all_includes.push(p);
            }
        }
    }
    let mut compiler =
        Compiler::new(&all_includes).map_err(|e| format!("proto compile failed: {e}"))?;
    compiler
        .include_source_info(true)
        .open_files(files)
        .map_err(|e| format!("proto compile failed: {e}"))?;

    // Root files only — so we surface services the user asked for, not their
    // transitive dependencies.
    let root_names: HashSet<String> = compiler
        .file_descriptor_set()
        .file
        .iter()
        .filter_map(|f| f.name.clone())
        .collect();

    // Full set (roots + imports) feeds the descriptor pool for type resolution.
    compiler.include_imports(true);
    let full = compiler.file_descriptor_set();

    let mut services = Vec::new();
    for file in &full.file {
        if !root_names.contains(file.name()) {
            continue;
        }
        let package = file.package();
        for service in &file.service {
            let name = service.name();
            let full_name = if package.is_empty() {
                name.to_string()
            } else {
                format!("{package}.{name}")
            };
            services.push(full_name);
        }
    }
    cache_from_files(services, full.file)
}

#[derive(Clone)]
struct DynamicCodec {
    output: MessageDescriptor,
    /// Receives the raw protobuf byte count of the decoded response so the caller
    /// can report the true wire size.
    wire_size: Arc<AtomicUsize>,
}

#[derive(Clone)]
struct DynamicEncoder;

#[derive(Clone)]
struct DynamicDecoder {
    output: MessageDescriptor,
    wire_size: Arc<AtomicUsize>,
}

impl Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        DynamicEncoder
    }

    fn decoder(&mut self) -> Self::Decoder {
        DynamicDecoder {
            output: self.output.clone(),
            wire_size: self.wire_size.clone(),
        }
    }
}

impl Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        item.encode(dst)
            .map_err(|e| Status::new(Code::Internal, format!("encode failed: {e}")))
    }
}

impl Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        // Capture the raw protobuf length before consuming the buffer so the
        // reported size reflects wire bytes, not the JSON-encoded length.
        self.wire_size.store(src.remaining(), Ordering::Relaxed);
        let bytes = src.copy_to_bytes(src.remaining());
        DynamicMessage::decode(self.output.clone(), bytes)
            .map(Some)
            .map_err(|e| Status::new(Code::Internal, format!("decode failed: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost_types::field_descriptor_proto::{Label, Type};
    use prost_types::{DescriptorProto, FieldDescriptorProto, FileDescriptorProto};

    #[test]
    fn tls_domain_strips_scheme_port_and_ipv6_brackets() {
        assert_eq!(tls_domain("api.example.com"), "api.example.com");
        assert_eq!(tls_domain("api.example.com:443"), "api.example.com");
        assert_eq!(tls_domain("https://api.example.com:443"), "api.example.com");
        assert_eq!(tls_domain("[::1]:8080"), "::1");
        assert_eq!(tls_domain("[2001:db8::1]:443"), "2001:db8::1");
    }

    #[test]
    fn metadata_keys_are_lowercased() {
        let mut md = MetadataMap::new();
        insert_metadata(&mut md, "Authorization", "Bearer x").unwrap();
        assert_eq!(
            md.get("authorization").unwrap().to_str().unwrap(),
            "Bearer x"
        );
    }

    fn field(name: &str, number: i32, ty: Type, label: Label) -> FieldDescriptorProto {
        FieldDescriptorProto {
            name: Some(name.to_string()),
            number: Some(number),
            label: Some(label as i32),
            r#type: Some(ty as i32),
            ..Default::default()
        }
    }

    /// Offline test: hand-build a descriptor pool with a field-rich message and
    /// assert `example_message` populates every field with a plausible value.
    #[test]
    fn example_message_populates_fields_by_type() {
        // Nested message: message Inner { string note = 1; int32 count = 2; }
        let inner = DescriptorProto {
            name: Some("Inner".to_string()),
            field: vec![
                field("note", 1, Type::String, Label::Optional),
                field("count", 2, Type::Int32, Label::Optional),
            ],
            ..Default::default()
        };
        // message Sample {
        //   string email = 1; string iin = 2; int32 age = 3; bool active = 4;
        //   Inner inner = 5; repeated string tags = 6;
        // }
        let mut inner_field = field("inner", 5, Type::Message, Label::Optional);
        inner_field.type_name = Some(".test.Inner".to_string());
        let sample = DescriptorProto {
            name: Some("Sample".to_string()),
            field: vec![
                field("email", 1, Type::String, Label::Optional),
                field("iin", 2, Type::String, Label::Optional),
                field("age", 3, Type::Int32, Label::Optional),
                field("active", 4, Type::Bool, Label::Optional),
                inner_field,
                field("tags", 6, Type::String, Label::Repeated),
            ],
            ..Default::default()
        };
        let file = FileDescriptorProto {
            name: Some("test.proto".to_string()),
            package: Some("test".to_string()),
            syntax: Some("proto3".to_string()),
            message_type: vec![inner, sample],
            ..Default::default()
        };

        let mut pool = DescriptorPool::new();
        pool.add_file_descriptor_proto(file)
            .expect("descriptor pool build");
        let desc = pool
            .get_message_by_name("test.Sample")
            .expect("Sample message");

        let msg = example_message(&desc, 0);

        // String fields are non-empty and honour name heuristics.
        let email = msg
            .get_field_by_name("email")
            .unwrap()
            .as_str()
            .unwrap()
            .to_string();
        assert!(
            email.contains('@'),
            "email should look like an email: {email}"
        );

        let iin = msg
            .get_field_by_name("iin")
            .unwrap()
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(iin.len(), 12, "iin should be 12 chars: {iin}");
        assert!(
            iin.chars().all(|c| c.is_ascii_digit()),
            "iin should be all digits: {iin}"
        );

        // int32 in 1..1000.
        let age = msg.get_field_by_name("age").unwrap().as_i32().unwrap();
        assert!((1..1000).contains(&age), "age out of range: {age}");

        // bool is set (either value is fine; just assert the field exists/typed).
        assert!(msg.get_field_by_name("active").unwrap().as_bool().is_some());

        // repeated string has >= 1 element, each non-empty.
        let tags = msg.get_field_by_name("tags").unwrap();
        let list = tags.as_list().unwrap();
        assert!(!list.is_empty(), "tags should have >=1 element");
        assert!(!list[0].as_str().unwrap().is_empty());

        // nested message is populated (note non-empty, count in range).
        let inner_val = msg.get_field_by_name("inner").unwrap();
        let inner_msg = inner_val.as_message().unwrap();
        assert!(!inner_msg
            .get_field_by_name("note")
            .unwrap()
            .as_str()
            .unwrap()
            .is_empty());
        let count = inner_msg
            .get_field_by_name("count")
            .unwrap()
            .as_i32()
            .unwrap();
        assert!(
            (1..1000).contains(&count),
            "inner.count out of range: {count}"
        );

        // The whole thing must round-trip to JSON.
        let mut ser = serde_json::Serializer::new(Vec::new());
        msg.serialize_with_options(
            &mut ser,
            &prost_reflect::SerializeOptions::new().skip_default_fields(false),
        )
        .unwrap();
        let json = String::from_utf8(ser.into_inner()).unwrap();
        assert!(json.contains("\"email\""));
    }

    fn proto_temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("bonk-proto-{}", fastrand::u64(..)));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn compile_protos_builds_tree_from_single_file() {
        let dir = proto_temp_dir();
        let proto = dir.join("greet.proto");
        std::fs::write(
            &proto,
            r#"
syntax = "proto3";
package greet;
message HelloRequest { string name = 1; }
message HelloReply { string message = 1; }
service Greeter { rpc SayHello (HelloRequest) returns (HelloReply); }
"#,
        )
        .unwrap();

        let files = vec![proto.to_string_lossy().into_owned()];
        let includes = vec![dir.to_string_lossy().into_owned()];
        let cache = compile_protos(&files, &includes).expect("compile");

        assert_eq!(cache.tree.services.len(), 1);
        assert_eq!(cache.tree.services[0].name, "greet.Greeter");
        assert_eq!(cache.tree.services[0].methods[0].name, "SayHello");
        assert!(cache.methods.contains_key("greet.Greeter.SayHello"));
    }

    #[test]
    fn compile_protos_describes_request_fields() {
        let dir = proto_temp_dir();
        let proto = dir.join("hello.proto");
        std::fs::write(
            &proto,
            r#"
syntax = "proto3";
package hello;
enum Greeting { FORMAL = 0; CASUAL = 1; }
message HelloRequest {
  string name = 1;
  // Язык ответа, напр. "ru"
  string locale = 2;
  Greeting greeting_type = 3;
  repeated string tags = 4;
  map<string, int32> counts = 5;
}
message HelloReply { string message = 1; }
service Greeter { rpc SayHello (HelloRequest) returns (HelloReply); }
"#,
        )
        .unwrap();

        let cache = compile_protos(&[proto.to_string_lossy().into_owned()], &[]).expect("compile");
        let fields = &cache.tree.services[0].methods[0].input_schema;
        assert_eq!(
            fields
                .iter()
                .map(|f| (f.name.as_str(), f.type_label.as_str(), f.json.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("name", "string", "string"),
                ("locale", "string", "string"),
                ("greetingType", "enum Greeting", "enum"),
                ("tags", "repeated string", "array"),
                ("counts", "map<string, int32>", "object"),
            ]
        );
        assert_eq!(fields[1].doc, "Язык ответа, напр. \"ru\"");
        assert_eq!(fields[2].proto_name, "greeting_type");
        assert_eq!(fields[2].enum_values, vec!["FORMAL", "CASUAL"]);
    }

    #[test]
    fn compile_protos_resolves_imports_via_include_root() {
        let dir = proto_temp_dir();
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(
            dir.join("sub/types.proto"),
            "syntax = \"proto3\";\npackage common;\nmessage Id { string value = 1; }\n",
        )
        .unwrap();
        let main = dir.join("api.proto");
        std::fs::write(
            &main,
            r#"
syntax = "proto3";
package api;
import "sub/types.proto";
message Empty {}
service Lookup { rpc Get (common.Id) returns (Empty); }
"#,
        )
        .unwrap();

        let files = vec![main.to_string_lossy().into_owned()];
        let includes = vec![dir.to_string_lossy().into_owned()];
        let cache = compile_protos(&files, &includes).expect("compile with import");

        assert!(cache.methods.contains_key("api.Lookup.Get"));
        assert_eq!(
            cache.tree.services.len(),
            1,
            "only api.Lookup should surface"
        );
        assert_eq!(cache.tree.services[0].name, "api.Lookup");
    }

    #[test]
    fn compile_protos_excludes_services_from_imported_files() {
        let dir = proto_temp_dir();
        std::fs::create_dir_all(dir.join("dep")).unwrap();
        std::fs::write(
            dir.join("dep/dep.proto"),
            r#"
syntax = "proto3";
package dep;
message Ping {}
service DepService { rpc DepCall (Ping) returns (Ping); }
"#,
        )
        .unwrap();
        let main = dir.join("root.proto");
        std::fs::write(
            &main,
            r#"
syntax = "proto3";
package root;
import "dep/dep.proto";
service RootService { rpc RootCall (dep.Ping) returns (dep.Ping); }
"#,
        )
        .unwrap();

        let files = vec![main.to_string_lossy().into_owned()];
        let includes = vec![dir.to_string_lossy().into_owned()];
        let cache = compile_protos(&files, &includes).expect("compile");

        let names: Vec<&str> = cache
            .tree
            .services
            .iter()
            .map(|s| s.name.as_str())
            .collect();
        assert_eq!(names, vec!["root.RootService"]);
        assert!(cache.methods.contains_key("root.RootService.RootCall"));
        assert!(!cache.methods.contains_key("dep.DepService.DepCall"));
    }

    #[test]
    fn compile_protos_reports_syntax_errors() {
        let dir = proto_temp_dir();
        let proto = dir.join("broken.proto");
        std::fs::write(&proto, "syntax = \"proto3\";\nmessage { oops").unwrap();

        let files = vec![proto.to_string_lossy().into_owned()];
        let includes = vec![dir.to_string_lossy().into_owned()];
        let err = compile_protos(&files, &includes).unwrap_err();
        assert!(err.contains("proto compile failed"));
    }

    #[test]
    fn compile_protos_succeeds_without_explicit_include_root() {
        let dir = proto_temp_dir();
        let proto = dir.join("solo.proto");
        std::fs::write(
            &proto,
            "syntax = \"proto3\";\npackage solo;\nmessage M {}\nservice S { rpc C (M) returns (M); }\n",
        )
        .unwrap();
        let files = vec![proto.to_string_lossy().into_owned()];
        // Empty includes — the parent dir must be derived automatically.
        let cache = compile_protos(&files, &[]).expect("compile with no explicit includes");
        assert_eq!(cache.tree.services[0].name, "solo.S");
        assert!(cache.methods.contains_key("solo.S.C"));
    }

    /// Offline: build a descriptor set with one service exposing a unary, a
    /// server-streaming, a client-streaming and a bidi method, then assert the
    /// reflection tree-build records the streaming flags correctly.
    #[test]
    fn cache_from_files_marks_streaming_methods() {
        use prost_types::{MethodDescriptorProto, ServiceDescriptorProto};

        fn method(
            name: &str,
            client_streaming: bool,
            server_streaming: bool,
        ) -> MethodDescriptorProto {
            MethodDescriptorProto {
                name: Some(name.to_string()),
                input_type: Some(".strm.Msg".to_string()),
                output_type: Some(".strm.Msg".to_string()),
                client_streaming: Some(client_streaming),
                server_streaming: Some(server_streaming),
                ..Default::default()
            }
        }

        let msg = DescriptorProto {
            name: Some("Msg".to_string()),
            field: vec![field("v", 1, Type::String, Label::Optional)],
            ..Default::default()
        };
        let service = ServiceDescriptorProto {
            name: Some("Streamer".to_string()),
            method: vec![
                method("Unary", false, false),
                method("ServerStream", false, true),
                method("ClientStream", true, false),
                method("Bidi", true, true),
            ],
            ..Default::default()
        };
        let file = FileDescriptorProto {
            name: Some("strm.proto".to_string()),
            package: Some("strm".to_string()),
            syntax: Some("proto3".to_string()),
            message_type: vec![msg],
            service: vec![service],
            ..Default::default()
        };

        let cache = cache_from_files(vec!["strm.Streamer".to_string()], vec![file]).unwrap();
        let methods = &cache.tree.services[0].methods;
        let by_name = |n: &str| methods.iter().find(|m| m.name == n).unwrap();

        let unary = by_name("Unary");
        assert!(!unary.client_streaming && !unary.server_streaming);
        let ss = by_name("ServerStream");
        assert!(!ss.client_streaming && ss.server_streaming);
        let cs = by_name("ClientStream");
        assert!(cs.client_streaming && !cs.server_streaming);
        let bidi = by_name("Bidi");
        assert!(bidi.client_streaming && bidi.server_streaming);

        // A client stream takes a JSON array (one message per element) or a single object.
        let cs = &cache.methods["strm.Streamer.ClientStream"];
        assert_eq!(parse_messages(cs, r#"[{"v":"a"},{"v":"b"}]"#).unwrap().len(), 2);
        assert_eq!(parse_messages(cs, r#"{"v":"a"}"#).unwrap().len(), 1);
        assert!(parse_messages(cs, r#"[{"v":"a"},{"nope":1}]"#).unwrap_err().contains("#2"));
        // A server stream sends exactly the one message it was given.
        let ss = &cache.methods["strm.Streamer.ServerStream"];
        assert!(parse_messages(ss, r#"[{"v":"a"}]"#).is_err());
    }

    /// Offline: a `-bin` metadata key must base64-decode into a binary value and
    /// insert without panicking; a non-ASCII ASCII-key value is rejected with a
    /// clear `Err` (not a panic); a valid ASCII value goes through.
    #[test]
    fn insert_metadata_handles_bin_and_non_ascii() {
        // -bin key: value is base64 of the bytes 0xDE 0xAD 0xBE 0xEF.
        let mut md = MetadataMap::new();
        let b64 = BASE64.encode([0xDE, 0xAD, 0xBE, 0xEF]);
        insert_metadata(&mut md, "trace-bin", &b64).expect("bin metadata should insert");
        let got = md
            .get_bin("trace-bin")
            .expect("trace-bin present")
            .to_bytes()
            .expect("decode bin value");
        assert_eq!(got.as_ref(), [0xDE, 0xAD, 0xBE, 0xEF]);

        // -bin key with invalid base64 → clear Err, no panic.
        let mut md = MetadataMap::new();
        let err = insert_metadata(&mut md, "x-bin", "not*base64").unwrap_err();
        assert!(err.contains("base64"), "expected base64 error, got: {err}");

        // Plain ASCII value inserts fine.
        let mut md = MetadataMap::new();
        insert_metadata(&mut md, "authorization", "Bearer abc").unwrap();
        assert_eq!(md.get("authorization").unwrap(), "Bearer abc");

        // An ASCII metadata value with a control char (here a newline) is
        // rejected by the header-value rules → clear Err, NOT a panic. (This is
        // the case the old `try_from(...).unwrap()`-style path would have blown
        // up on for a value `bonk` couldn't encode.)
        let mut md = MetadataMap::new();
        let err = insert_metadata(&mut md, "x-note", "line1\nline2").unwrap_err();
        assert!(
            err.contains("invalid metadata value"),
            "expected value error, got: {err}"
        );
    }

    #[test]
    #[ignore = "network smoke test against public grpcb.in"]
    fn grpcb_native_smoke() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let channel = connect("grpcb.in:9000", true).await.unwrap();
            let mut cache = reflect("grpcb.in:9000", true).await.unwrap();
            assert!(cache
                .tree
                .services
                .iter()
                .any(|s| s.name == "grpcbin.GRPCBin"));
            let tpl = template(&mut cache, "grpcbin.GRPCBin.Empty").unwrap();
            assert!(tpl.trim().starts_with('{'));
            let result = call(
                channel,
                cache,
                "grpcbin.GRPCBin.Empty",
                "{}",
                &HashMap::new(),
            )
            .await
            .unwrap();
            assert!(result.ok);
        });
    }
}
