#!/usr/bin/env bash
set -euo pipefail
test "${DEMO_CONTAINER_ACCEPTANCE:-}" = SYNTHETIC_ONLY
test "$#" -eq 2
secret_file=$(realpath "$1")
evidence_dir=$(realpath "$2")
d=(/home/admin/demo-commercial-runtime/docker/docker --config /home/admin/demo-commercial-runtime -H unix:///home/admin/demo-commercial-runtime/docker.sock)
database=${DEMO_STORAGE_DRILL_DATABASE:-demo_test_storage_20260922}
[[ "$database" =~ ^demo_test_storage_[a-z0-9_]+$ ]]
while IFS='=' read -r key value; do
  value=${value%$'\r'}
  case "$key" in DEMO_DB_PASSWORD) export "$key=$value" ;; esac
done < "$secret_file"
test -n "${DEMO_DB_PASSWORD:-}"
export DATABASE_URL="postgresql://demo:${DEMO_DB_PASSWORD}@db:5432/${database}?schema=public"
"${d[@]}" exec demo-commercial-release-db-1 createdb -U demo "$database"
"${d[@]}" run --rm --name demo-storage-migration --network demo-commercial-release_private -e DATABASE_URL demo-api:commercial-release pnpm db:deploy
mkdir -p "$evidence_dir/storage-faults"
"${d[@]}" run --rm --name demo-storage-fault-drill --network demo-commercial-release_private \
  --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,size=512m,uid=1000,gid=1000 \
  --tmpfs /fault-storage:rw,noexec,nosuid,size=32m,uid=1000,gid=1000 \
  --mount "type=bind,source=$(dirname "$(realpath "$0")")/storage-fault-drill.ts,target=/app/scripts/verification/storage-fault-drill.ts,readonly" \
  --mount "type=bind,source=$evidence_dir/storage-faults,target=/evidence/storage-faults" \
  -e DATABASE_URL -e DEMO_STORAGE_FAULT_DRILL=SYNTHETIC_TMPFS_ONLY -e DEMO_PRODUCT_ID=demo-product \
  -e DEMO_ARTIFACT_ROOT=/fault-storage -e DEMO_PYTHON=python3 -e DEMO_SOFFICE=/opt/libreoffice26.2/program/soffice \
  demo-api:commercial-release pnpm exec tsx --tsconfig tsconfig.base.json scripts/verification/storage-fault-drill.ts /evidence/storage-faults
