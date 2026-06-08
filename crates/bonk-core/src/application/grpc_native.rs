use crate::conn::GrpcDescriptorCache;
use crate::domain::grpc::{GrpcMethod, GrpcResult, GrpcService, ServiceTree};
use bytes::Buf;
use http::uri::PathAndQuery;
use prost::Message;
use prost::bytes::Bytes;
use prost_reflect::{
    DescriptorPool, DynamicMessage, FieldDescriptor, Kind, MapKey, MessageDescriptor, Value,
};
use serde::de::DeserializeSeed;
use std::collections::{HashMap, HashSet};
use std::time::Instant;
use tokio_stream::StreamExt;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::metadata::{
    AsciiMetadataKey, AsciiMetadataValue, BinaryMetadataKey, BinaryMetadataValue, MetadataMap,
};
use tonic::transport::{Channel, ClientTlsConfig, Endpoint};
use tonic::{Code, Request, Status};

pub async fn connect(endpoint: &str, plaintext: bool) -> Result<Channel, String> {
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
    if !plaintext {
        let domain = endpoint
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split(':')
            .next()
            .unwrap_or(endpoint);
        builder = builder
            .tls_config(ClientTlsConfig::new().domain_name(domain))
            .map_err(|e| format!("tls config failed: {e}"))?;
    }
    builder
        .connect()
        .await
        .map_err(|e| format!("connect failed: {e}"))
}

pub async fn reflect(endpoint: &str, plaintext: bool) -> Result<GrpcDescriptorCache, String> {
    // Use a FRESH connection per reflection attempt. A server that only speaks
    // v1alpha resets the connection when asked for the unknown v1 reflection
    // service; reusing one channel would carry that reset into the v1alpha
    // fallback (ConnectionReset). grpcurl works precisely because it tries a
    // single version per connection. Each attempt is also time-bounded so a
    // server that accepts the connection but never answers can't hang us.
    let dur = std::time::Duration::from_secs(10);
    if let Ok(channel) = connect(endpoint, plaintext).await {
        if let Ok(Ok(cache)) = tokio::time::timeout(dur, reflect_v1(channel)).await {
            return Ok(cache);
        }
    }
    let channel = connect(endpoint, plaintext).await?;
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

pub async fn call(
    channel: Channel,
    cache: GrpcDescriptorCache,
    method_symbol: &str,
    json_body: &str,
    metadata: &HashMap<String, String>,
) -> Result<GrpcResult, String> {
    let method = cache
        .methods
        .get(method_symbol)
        .ok_or_else(|| format!("unknown method: {method_symbol}"))?
        .clone();
    // bonk only speaks unary today. Invoking a streaming RPC as unary returns a
    // wrong/partial result or hangs until timeout, so refuse it up front with a
    // clear message rather than silently misbehaving.
    if method.is_client_streaming() || method.is_server_streaming() {
        return Err(format!(
            "{method_symbol} is a streaming RPC; bonk currently supports unary calls only."
        ));
    }
    let mut de = serde_json::Deserializer::from_str(json_body);
    let req_msg = method.input().deserialize(&mut de).map_err(|e| {
        format!(
            "request json does not match {}: {e}",
            method.input().full_name()
        )
    })?;
    de.end()
        .map_err(|e| format!("invalid trailing json: {e}"))?;

    let path = PathAndQuery::from_maybe_shared(format!(
        "/{}/{}",
        method.parent_service().full_name(),
        method.name()
    ))
    .map_err(|e| format!("invalid grpc path: {e}"))?;

    let mut req = Request::new(req_msg);
    for (key, value) in metadata {
        insert_metadata(req.metadata_mut(), key, value)?;
    }

    let start = Instant::now();
    let codec = DynamicCodec {
        output: method.output(),
    };
    let mut grpc = tonic::client::Grpc::new(channel);
    grpc.ready()
        .await
        .map_err(|e| format!("grpc client not ready: {e}"))?;
    let response = grpc
        .unary(req, path, codec)
        .await
        .map_err(|e| format!("grpc status {}: {}", e.code(), e.message()))?;
    let elapsed_ms = start.elapsed().as_millis() as u64;
    let response_msg = response.into_inner();
    let body = serde_json::to_string_pretty(&response_msg)
        .map_err(|e| format!("response json failed: {e}"))?;

    Ok(GrpcResult {
        ok: true,
        status: "OK".into(),
        size_bytes: body.len(),
        body,
        elapsed_ms,
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
                            !s.starts_with("grpc.reflection.") && !s.starts_with("grpc.health.")
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
pub fn compile_protos(files: &[String], includes: &[String]) -> Result<GrpcDescriptorCache, String> {
    use protox::Compiler;
    // protox requires every opened file to live under an include dir.  Callers
    // pass absolute paths and may give an empty `includes` (e.g. the user picks
    // a .proto file without choosing an explicit import root), so we
    // automatically add each file's parent directory to the include set.
    let mut all_includes: Vec<String> = includes.to_vec();
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
        .include_source_info(false)
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
}

#[derive(Clone)]
struct DynamicEncoder;

#[derive(Clone)]
struct DynamicDecoder {
    output: MessageDescriptor,
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
        assert!(email.contains('@'), "email should look like an email: {email}");

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
        assert!((1..1000).contains(&count), "inner.count out of range: {count}");

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
        assert_eq!(cache.tree.services.len(), 1, "only api.Lookup should surface");
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

        let names: Vec<&str> = cache.tree.services.iter().map(|s| s.name.as_str()).collect();
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
            assert!(cache.tree.services.iter().any(|s| s.name == "grpcbin.GRPCBin"));
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
