use crate::domain::http::HttpRequest;
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderNode {
    pub id: String,
    pub name: String,
    pub expanded: bool,
    pub children: Vec<TreeNode>,
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
        }
    }
    pub fn from_node(n: &RequestNode) -> RequestFile {
        RequestFile {
            name: n.name.clone(),
            protocol: n.protocol.clone(),
            request: n.request.clone(),
            params: n.params.clone(),
            grpc: n.grpc.clone(),
        }
    }
}
