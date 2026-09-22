#!/usr/bin/env bash
set -euo pipefail
test "${DEMO_CONTAINER_ACCEPTANCE:-}" = SYNTHETIC_ONLY
test "$#" -eq 2
source_env=$(realpath "$1")
evidence_dir=$(realpath "$2")
tls_dir=/home/admin/demo-commercial-runtime/tls-acceptance-20260922
tls_env=/home/admin/demo-commercial-runtime/acceptance-tls.env
test ! -e "$tls_dir"
test ! -e "$tls_env"
umask 077
mkdir "$tls_dir"
openssl req -x509 -newkey rsa:3072 -nodes -keyout "$tls_dir/ca.key" -out "$tls_dir/ca.crt" -days 1 -subj '/CN=DEMO isolated acceptance CA'
openssl req -newkey rsa:2048 -nodes -keyout "$tls_dir/tls.key" -out "$tls_dir/server.csr" -subj '/CN=localhost'
cat > "$tls_dir/server.ext" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
EOF
openssl x509 -req -in "$tls_dir/server.csr" -CA "$tls_dir/ca.crt" -CAkey "$tls_dir/ca.key" -CAcreateserial -out "$tls_dir/tls.crt" -days 1 -sha256 -extfile "$tls_dir/server.ext"
chmod 755 "$tls_dir"
chmod 644 "$tls_dir/ca.crt" "$tls_dir/tls.crt"
chgrp 101 "$tls_dir/tls.key"
chmod 640 "$tls_dir/tls.key"
while IFS='=' read -r key value; do
  value=${value%$'\r'}
  case "$key" in
    DEMO_ORIGIN) printf 'DEMO_ORIGIN=https://localhost:8443\n' ;;
    DEMO_DB_PASSWORD|DEMO_ADMIN_EMAIL|DEMO_ADMIN_PASSWORD|DEMO_TENANT_NAME) printf '%s=%s\n' "$key" "$value" ;;
  esac
done < "$source_env" > "$tls_env"
printf 'DEMO_TLS_CERT_DIR=%s\nDEMO_TLS_PORT=8443\n' "$tls_dir" >> "$tls_env"
chmod 600 "$tls_env"
cp "$tls_dir/ca.crt" "$evidence_dir/local-tls-ca.crt"
openssl x509 -in "$tls_dir/tls.crt" -noout -subject -issuer -dates -fingerprint -sha256 > "$evidence_dir/local-tls-certificate.txt"
openssl verify -CAfile "$tls_dir/ca.crt" -verify_hostname localhost "$tls_dir/tls.crt"
# The private CA is deliberately not installed into the host/browser trust store.
