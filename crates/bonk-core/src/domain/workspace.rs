use crate::domain::http::{AuthConfig, HttpRequest};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Param {
    pub key: String,
    pub value: String,
    pub description: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcTabState {
    pub endpoint: String,
    pub plaintext: bool,
    pub connection_id: Option<String>,
    pub method: Option<String>,
    pub message: String,
    pub metadata: BTreeMap<String, String>,
    /// Schema source used to encode/decode the call. Defaults to reflection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Workspace-relative or absolute `.proto` paths used when `source=proto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proto_paths: Option<Vec<String>>,
    /// Additional compiler import roots used when `source=proto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import_paths: Option<Vec<String>>,
    /// Postman-style pre-request script (JS), run before `{{var}}` resolution.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_request_script: Option<String>,
    /// Postman-style test script (JS), run against the gRPC result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_script: Option<String>,
    /// TLS options (S29): skip verification, extra CA, mTLS identity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls: Option<crate::domain::grpc::GrpcTls>,
    /// Auth tab (S19); unset / `inherit` takes the collection's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthConfig>,
    /// Plaintext only: send `authorization` anyway (S30).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_auth_on_plaintext: Option<bool>,
}

/// On-disk shape of a request file (no id, no kind — path is the identity).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestFile {
    pub name: String,
    pub protocol: String,
    pub request: HttpRequest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Vec<Param>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grpc: Option<GrpcTabState>,
    /// Link to the spec operation this request was imported from (re-import, IM8).
    /// Opaque to Rust: the frontend owns its shape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<serde_json::Value>,
}

/// A request node in the in-memory / IPC tree (id = `fs:<relpath>`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestNode {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub request: HttpRequest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Vec<Param>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grpc: Option<GrpcTabState>,
    /// Link to the spec operation this request was imported from (re-import, IM8).
    /// Opaque to Rust: the frontend owns its shape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderNode {
    pub id: String,
    pub name: String,
    pub expanded: bool,
    /// Collection-level auth from `.folder.bonk.json`; requests set to `inherit` use it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<Box<AuthConfig>>,
    /// Where the collection was imported from (`.folder.bonk.json` `source`); opaque to Rust.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<serde_json::Value>,
    pub children: Vec<TreeNode>,
}

/// On-disk shape of a folder's settings file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FolderFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthConfig>,
    /// Manual sort order of this folder's entries (file/dir names); unlisted ones follow alphabetically.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub order: Vec<String>,
    /// Where the collection was imported from, for re-import (IM8). Opaque to Rust.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TreeNode {
    Folder(FolderNode),
    Request(Box<RequestNode>),
}

impl RequestFile {
    pub fn into_node(self, id: String) -> RequestNode {
        RequestNode {
            id,
            name: self.name,
            protocol: self.protocol,
            request: self.request,
            params: self.params,
            grpc: self.grpc,
            spec: self.spec,
        }
    }
    pub fn from_node(n: &RequestNode) -> RequestFile {
        RequestFile {
            name: n.name.clone(),
            protocol: n.protocol.clone(),
            request: n.request.clone(),
            params: n.params.clone(),
            grpc: n.grpc.clone(),
            spec: n.spec.clone(),
        }
    }
}
