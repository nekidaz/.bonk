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
}
