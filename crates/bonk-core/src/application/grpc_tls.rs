//! TLS for gRPC beyond tonic's defaults (S29): an unverified connector for
//! self-signed dev servers, and a handshake probe that reports what
//! certificate the server presented and whether it verifies.

use crate::application::grpc_native::{invalid, unavailable};
use crate::domain::grpc::{GrpcCertInfo, GrpcError, GrpcPrefs, GrpcTls};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::WebPkiServerVerifier;
use rustls::crypto::{aws_lc_rs, CryptoProvider};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use std::sync::{Arc, Mutex};
use tonic::transport::{Channel, Endpoint};

fn provider() -> Arc<CryptoProvider> {
    Arc::new(aws_lc_rs::default_provider())
}

/// `host:port` of an endpoint (scheme dropped, IPv6 brackets kept off the host).
pub(crate) fn host_port(endpoint: &str) -> (String, u16) {
    let rest = super::grpc_native::split_endpoint(endpoint)
        .0
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let (host, port) = if let Some(v6) = rest.strip_prefix('[') {
        let (h, tail) = v6.split_once(']').unwrap_or((v6, ""));
        (h, tail.strip_prefix(':'))
    } else {
        match rest.rsplit_once(':') {
            Some((h, p)) => (h, Some(p)),
            None => (rest, None),
        }
    };
    (
        host.to_string(),
        port.and_then(|p| p.parse().ok()).unwrap_or(443),
    )
}

fn roots(tls: &GrpcTls) -> Result<RootCertStore, String> {
    let mut store = RootCertStore::empty();
    if !tls.disable_system_cas {
        store.add_parsable_certificates(rustls_native_certs::load_native_certs().certs);
    }
    for ca in tls.ca_cert.iter().chain(tls.ca_paths.iter()) {
        for cert in CertificateDer::pem_file_iter(ca).map_err(|e| format!("CA {ca}: {e}"))? {
            store
                .add(cert.map_err(|e| format!("CA {ca}: {e}"))?)
                .map_err(|e| format!("CA {ca}: {e}"))?;
        }
    }
    Ok(store)
}

fn client_config(
    tls: &GrpcTls,
    verifier: Arc<dyn ServerCertVerifier>,
) -> Result<ClientConfig, String> {
    let builder = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(verifier);
    let mut config = match tls.client_identity_pem()? {
        Some((cert, key)) => {
            let certs = CertificateDer::pem_slice_iter(&cert)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("client certificate: {e}"))?;
            let key =
                PrivateKeyDer::from_pem_slice(&key).map_err(|e| format!("client key: {e}"))?;
            builder
                .with_client_auth_cert(certs, key)
                .map_err(|e| format!("client certificate: {e}"))?
        }
        _ => builder.with_no_client_auth(),
    };
    config.alpn_protocols = vec![b"h2".to_vec()];
    Ok(config)
}

/// Accepts any certificate. Signatures are still checked so the handshake is
/// a real one; only the chain/name check is skipped.
#[derive(Debug)]
struct NoVerify(Arc<CryptoProvider>);

impl ServerCertVerifier for NoVerify {
    fn verify_server_cert(
        &self,
        _: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

/// Runs the real WebPKI check but only records its verdict, so the probe can
/// still show an expired or self-signed certificate.
#[derive(Debug)]
struct Recording {
    inner: Arc<WebPkiServerVerifier>,
    verdict: Mutex<Option<String>>,
}

impl ServerCertVerifier for Recording {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let result =
            self.inner
                .verify_server_cert(end_entity, intermediates, server_name, ocsp, now);
        *self.verdict.lock().unwrap() = result.err().map(|e| e.to_string());
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

async fn handshake(
    endpoint: &str,
    config: ClientConfig,
) -> Result<tokio_rustls::client::TlsStream<tokio::net::TcpStream>, std::io::Error> {
    let (host, port) = host_port(endpoint);
    let name = ServerName::try_from(host.clone()).map_err(std::io::Error::other)?;
    let tcp = tokio::net::TcpStream::connect((host.as_str(), port)).await?;
    tokio_rustls::TlsConnector::from(Arc::new(config))
        .connect(name, tcp)
        .await
}

/// Channel that skips certificate verification (`tls.insecure`).
pub async fn connect_insecure(
    endpoint: &str,
    tls: &GrpcTls,
    prefs: &GrpcPrefs,
) -> Result<Channel, GrpcError> {
    let config = client_config(tls, Arc::new(NoVerify(provider())))?;
    let target = endpoint.to_string();
    let connector = tower::service_fn(move |_: http::Uri| {
        let (config, target) = (config.clone(), target.clone());
        async move {
            handshake(&target, config)
                .await
                .map(hyper_util::rt::TokioIo::new)
        }
    });
    let (host, port) = host_port(endpoint);
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host
    };
    // ponytail: the connector does TLS itself, so tonic gets an http:// URI
    // (it refuses https:// without its own TLS config); :scheme goes out as
    // "http". Fine for gRPC servers; switch if a proxy ever rejects it.
    let mut builder = Endpoint::from_shared(format!("http://{host}:{port}"))
        .map_err(|e| invalid(format!("invalid endpoint {endpoint}: {e}")))?
        .connect_timeout(std::time::Duration::from_secs(8));
    if prefs.keepalive_secs > 0 {
        builder = builder
            .http2_keep_alive_interval(std::time::Duration::from_secs(prefs.keepalive_secs.into()))
            .keep_alive_while_idle(true);
    }
    builder
        .connect_with_connector(connector)
        .await
        .map_err(|e| unavailable(format!("connect failed: {e}")))
}

/// Handshake with the server and describe its leaf certificate.
pub async fn inspect(endpoint: &str, tls: &GrpcTls) -> Result<GrpcCertInfo, String> {
    let inner = WebPkiServerVerifier::builder_with_provider(Arc::new(roots(tls)?), provider())
        .build()
        .map_err(|e| e.to_string())?;
    let recorder = Arc::new(Recording {
        inner,
        verdict: Mutex::new(None),
    });
    let config = client_config(tls, recorder.clone())?;
    let stream = tokio::time::timeout(
        std::time::Duration::from_secs(8),
        handshake(endpoint, config),
    )
    .await
    .map_err(|_| "TLS handshake timed out".to_string())?
    .map_err(|e| format!("TLS handshake failed: {e}"))?;
    let leaf = stream
        .get_ref()
        .1
        .peer_certificates()
        .and_then(|c| c.first())
        .ok_or("server sent no certificate")?;
    let (subject, issuer, not_after) = cert_fields(leaf).ok_or("unreadable certificate")?;
    let error = recorder.verdict.lock().unwrap().clone();
    Ok(GrpcCertInfo {
        verified: error.is_none(),
        error,
        subject,
        issuer,
        not_after,
    })
}

/// Minimal DER reader: `(tag, content, rest)`.
fn der(input: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let (&tag, rest) = input.split_first()?;
    let (&len0, rest) = rest.split_first()?;
    let (len, rest) = if len0 < 0x80 {
        (len0 as usize, rest)
    } else {
        let n = (len0 & 0x7f) as usize;
        if n == 0 || n > 4 || rest.len() < n {
            return None;
        }
        (
            rest[..n].iter().fold(0usize, |a, &b| a << 8 | b as usize),
            &rest[n..],
        )
    };
    (rest.len() >= len).then(|| (tag, &rest[..len], &rest[len..]))
}

/// Common name of an X.501 Name, falling back to the organization.
fn name_attr(mut name: &[u8]) -> String {
    let (mut cn, mut org) = (None, None);
    while let Some((_, set, rest)) = der(name) {
        name = rest;
        let Some((_, atv, _)) = der(set) else {
            continue;
        };
        let Some((_, oid, value)) = der(atv) else {
            continue;
        };
        let Some((_, v, _)) = der(value) else {
            continue;
        };
        let v = String::from_utf8_lossy(v).into_owned();
        match oid {
            [0x55, 4, 3] => cn = Some(v),
            [0x55, 4, 10] => org = Some(v),
            _ => {}
        }
    }
    cn.or(org).unwrap_or_default()
}

/// UTCTime (0x17) / GeneralizedTime (0x18) → unix seconds.
fn der_time(tag: u8, v: &[u8]) -> Option<i64> {
    let s = std::str::from_utf8(v).ok()?;
    let (y, rest) = if tag == 0x17 {
        let y: i64 = s.get(0..2)?.parse().ok()?;
        (if y < 50 { 2000 + y } else { 1900 + y }, s.get(2..)?)
    } else {
        (s.get(0..4)?.parse().ok()?, s.get(4..)?)
    };
    let n = |i: usize| rest.get(i..i + 2)?.parse::<i64>().ok();
    let (m, d, hh, mm, ss) = (n(0)?, n(2)?, n(4)?, n(6)?, n(8).unwrap_or(0));
    // Days from civil date (H. Hinnant).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((m + 9) % 12) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some((era * 146_097 + doe - 719_468) * 86_400 + hh * 3600 + mm * 60 + ss)
}

/// (subject, issuer, notAfter) of a DER certificate.
fn cert_fields(cert: &[u8]) -> Option<(String, String, i64)> {
    let (_, cert, _) = der(cert)?;
    let (_, mut tbs, _) = der(cert)?;
    let mut items = Vec::new();
    while let Some((tag, content, rest)) = der(tbs) {
        items.push((tag, content));
        tbs = rest;
    }
    // [0] version is optional; then serial, signature, issuer, validity, subject.
    let off = usize::from(items.first()?.0 == 0xA0);
    let issuer = name_attr(items.get(off + 2)?.1);
    let (_, _, after) = der(items.get(off + 3)?.1)?;
    let (tag, value, _) = der(after)?;
    let subject = name_attr(items.get(off + 4)?.1);
    Some((subject, issuer, der_time(tag, value)?))
}

/// (subject CN, notAfter unix seconds) of the first certificate in a PEM/CRT file.
pub fn cert_file_info(path: &str) -> Result<(String, i64), String> {
    let der = CertificateDer::pem_file_iter(path)
        .map_err(|e| e.to_string())?
        .next()
        .ok_or("no certificate in file")?
        .map_err(|e| e.to_string())?;
    let (subject, _, not_after) = cert_fields(&der).ok_or("unreadable certificate")?;
    Ok((subject, not_after))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_port_defaults_and_ipv6() {
        assert_eq!(
            host_port("api.example.com"),
            ("api.example.com".into(), 443)
        );
        assert_eq!(host_port("https://h:8443/"), ("h".into(), 8443));
        assert_eq!(host_port("h:8443/api/v1"), ("h".into(), 8443));
        assert_eq!(host_port("[::1]:50051"), ("::1".into(), 50051));
    }

    #[test]
    fn der_time_parses_both_forms() {
        assert_eq!(der_time(0x17, b"700101000000Z"), Some(0));
        assert_eq!(der_time(0x18, b"20270112000000Z"), Some(1_799_712_000));
    }

    #[test]
    fn reads_self_signed_certificate() {
        // openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes
        //   -subj "/O=Bonk/CN=*.bonk.test" -days 3650
        let pem = include_str!("testdata/self_signed.pem");
        let cert = CertificateDer::from_pem_slice(pem.as_bytes()).unwrap();
        let (subject, issuer, not_after) = cert_fields(&cert).unwrap();
        assert_eq!(subject, "*.bonk.test");
        assert_eq!(issuer, "*.bonk.test");
        assert!(not_after > 1_800_000_000);
    }

    #[test]
    #[ignore = "network smoke test against public TLS endpoints"]
    fn inspect_and_insecure_smoke() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let ok = inspect("google.com:443", &GrpcTls::default())
                .await
                .unwrap();
            assert!(ok.verified, "{ok:?}");
            let bad = inspect("self-signed.badssl.com:443", &GrpcTls::default())
                .await
                .unwrap();
            assert!(!bad.verified && bad.error.is_some(), "{bad:?}");
            let insecure = GrpcTls {
                insecure: true,
                ..Default::default()
            };
            let cache = crate::application::grpc_native::reflect_with(
                "grpcb.in:9001",
                false,
                &insecure,
                &GrpcPrefs::default(),
            )
            .await
            .unwrap();
            assert!(!cache.tree.services.is_empty());
        });
    }
}
