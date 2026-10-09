//! PKCS#12 (`.p12` / `.pfx`) client identities. Both TLS stacks here (reqwest and
//! tonic) are rustls, which only takes PEM, so a bundle is unpacked into a PEM
//! certificate chain (leaf first) plus a PEM PKCS#8 private key.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use p12_keystore::{KeyStore, Pkcs12ImportPolicy};

fn pem(label: &str, der: &[u8]) -> String {
    let b64 = STANDARD.encode(der);
    let mut out = format!("-----BEGIN {label}-----\n");
    for line in b64.as_bytes().chunks(64) {
        out.push_str(std::str::from_utf8(line).unwrap_or_default());
        out.push('\n');
    }
    out.push_str(&format!("-----END {label}-----\n"));
    out
}

/// Parse `.p12` bytes; returns `(certificate chain PEM, private key PEM)`.
pub fn p12_bytes_to_pem(data: &[u8], password: &str) -> Result<(Vec<u8>, Vec<u8>), String> {
    let store = KeyStore::from_pkcs12(data, password, Pkcs12ImportPolicy::Strict)
        .map_err(|e| format!("{e} (wrong password or unsupported encryption?)"))?;
    let (_, chain) = store
        .private_key_chain()
        .ok_or("the bundle has no private key with a certificate")?;
    if chain.certs().is_empty() {
        return Err("the bundle has no certificate for the private key".into());
    }
    let certs: String = chain
        .certs()
        .iter()
        .map(|c| pem("CERTIFICATE", c.as_der()))
        .collect();
    Ok((
        certs.into_bytes(),
        pem("PRIVATE KEY", chain.key().as_der()).into_bytes(),
    ))
}

/// Read a `.p12` file; see [`p12_bytes_to_pem`].
pub fn p12_to_pem(path: &str, password: &str) -> Result<(Vec<u8>, Vec<u8>), String> {
    let data = std::fs::read(path).map_err(|e| format!("client certificate «{path}»: {e}"))?;
    p12_bytes_to_pem(&data, password).map_err(|e| format!("client certificate «{path}»: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Self-signed EC cert + key, packed with `openssl pkcs12 -export -password pass:secret`.
    const P12: &[u8] = include_bytes!("../../tests/fixtures/client.p12");

    #[test]
    fn unpacks_to_pem() {
        let (cert, key) = p12_bytes_to_pem(P12, "secret").unwrap();
        let (cert, key) = (
            String::from_utf8(cert).unwrap(),
            String::from_utf8(key).unwrap(),
        );
        assert!(cert.starts_with("-----BEGIN CERTIFICATE-----\n"));
        assert!(key.starts_with("-----BEGIN PRIVATE KEY-----\n"));
        // reqwest accepts the combined PEM as an identity.
        reqwest::Identity::from_pem(format!("{cert}\n{key}").as_bytes()).unwrap();
    }

    #[test]
    fn wrong_password_is_an_error() {
        assert!(p12_bytes_to_pem(P12, "nope").is_err());
        assert!(p12_bytes_to_pem(b"not a p12", "secret").is_err());
    }
}
