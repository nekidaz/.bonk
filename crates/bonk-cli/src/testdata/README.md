Local-only TLS fixtures, valid 2020–2055. The CA private key is not retained.
The server accepts only identities signed by this CA. `client.p12` holds the same
client certificate/key as the PEM pair; its password is `test-bundle-password`.
The keys are public test data, never production identities. Tests use explicit
CA-only trust, avoiding OS-specific lifetime limits for public TLS certificates.
