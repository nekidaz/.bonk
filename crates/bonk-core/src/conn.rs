use std::collections::HashMap;
use tonic::transport::Channel;

#[derive(Clone)]
pub struct GrpcConn {
    pub channel: Option<Channel>,
    pub cache: Option<GrpcDescriptorCache>,
    pub endpoint: String,
    pub plaintext: bool,
    pub tls: crate::domain::grpc::GrpcTls,
    pub prefs: crate::domain::grpc::GrpcPrefs,
}

#[derive(Clone, Debug)]
pub struct GrpcDescriptorCache {
    pub tree: crate::domain::grpc::ServiceTree,
    pub methods: HashMap<String, prost_reflect::MethodDescriptor>,
}
