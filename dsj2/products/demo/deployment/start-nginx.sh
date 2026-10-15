#!/bin/sh
set -eu
case "${DEMO_PROXY_KEY:-}" in
  ''|*[!A-Za-z0-9_-]*) echo 'DEMO_PROXY_KEY must be URL-safe' >&2; exit 1 ;;
esac
[ "${#DEMO_PROXY_KEY}" -ge 32 ] || { echo 'DEMO_PROXY_KEY must have at least 32 characters' >&2; exit 1; }
# Substitute only the secret; preserve nginx's own $host/$remote_addr variables.
envsubst '${DEMO_PROXY_KEY}' < /etc/nginx/nginx.conf > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
