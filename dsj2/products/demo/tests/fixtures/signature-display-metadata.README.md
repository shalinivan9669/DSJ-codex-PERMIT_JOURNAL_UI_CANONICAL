The adjacent `.p7s.base64` file is a synthetic detached CMS fixture generated with
Python cryptography 50.0.2 (OpenSSL backend). Its two self-signed test certificates
have synthetic names; only one is a CMS signer. RSA keys were generated in memory
and were not saved. The signed content is the UTF-8 text:

`Synthetic metadata fixture, no user data.`

The fixture's cryptographic integrity was independently checked with OpenSSL
`cms -verify -noverify -binary -inform DER` and that exact detached content.
This is test data, not a trusted identity or an NCA certificate.
