#!/usr/bin/env bash
set -euo pipefail
test "${DEMO_CONTAINER_ACCEPTANCE:-}" = SYNTHETIC_ONLY
test "$#" -eq 2
secret_file=$(realpath "$1")
evidence_dir=$(realpath "$2")/backup-restore
script_dir=$(dirname "$(realpath "$0")")
d=(/home/admin/demo-commercial-runtime/docker/docker --config /home/admin/demo-commercial-runtime -H unix:///home/admin/demo-commercial-runtime/docker.sock)
suffix=${DEMO_BACKUP_DRILL_SUFFIX:-20260922}
[[ "$suffix" =~ ^[a-z0-9]+$ ]]
source_db=demo_test_backup_release_$suffix
restore_db=demo_test_restore_release_$suffix
source_volume=demo-acceptance-backup-source-$suffix
restore_volume=demo-acceptance-backup-restored-$suffix
backup_volume=demo-acceptance-backup-snapshot-$suffix
for volume in "$source_volume" "$restore_volume" "$backup_volume"; do
  if "${d[@]}" volume inspect "$volume" >/dev/null 2>&1; then echo "Refuse existing acceptance volume: $volume" >&2; exit 2; fi
done
while IFS='=' read -r key value; do
  value=${value%$'\r'}
  case "$key" in DEMO_DB_PASSWORD|DEMO_ADMIN_EMAIL|DEMO_ADMIN_PASSWORD) export "$key=$value" ;; esac
done < "$secret_file"
test -n "${DEMO_DB_PASSWORD:-}"
mkdir -p "$evidence_dir"
"${d[@]}" exec demo-commercial-release-db-1 createdb -U demo "$source_db"
"${d[@]}" exec demo-commercial-release-db-1 createdb -U demo "$restore_db"
common=(--rm --network demo-commercial-release_private --user 1000:1000 --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,noexec,nosuid,size=512m,uid=1000,gid=1000 -e DATABASE_URL -e DEMO_ADMIN_EMAIL -e DEMO_ADMIN_PASSWORD -e DEMO_ARTIFACT_ROOT=/data/artifacts -e DEMO_PYTHON=python3 -e DEMO_SOFFICE=/opt/libreoffice26.2/program/soffice -e DEMO_PRODUCT_ID=demo-product --mount "type=bind,source=$evidence_dir,target=/evidence/backup-restore")
export DATABASE_URL="postgresql://demo:${DEMO_DB_PASSWORD}@db:5432/$source_db?schema=public"
"${d[@]}" run "${common[@]}" --mount "type=volume,source=$source_volume,target=/data" demo-api:commercial-release pnpm db:deploy
"${d[@]}" run "${common[@]}" --mount "type=volume,source=$source_volume,target=/data" --mount "type=bind,source=$script_dir/backup-fixture.ts,target=/app/scripts/verification/backup-fixture.ts,readonly" demo-api:commercial-release pnpm exec tsx --tsconfig tsconfig.base.json scripts/verification/backup-fixture.ts /evidence/backup-restore/fixture.json
# Fixture process exited. This database and store have no API or worker writers.
backup_started=$(date +%s%N)
"${d[@]}" run "${common[@]}" --mount "type=volume,source=$source_volume,target=/data" --mount "type=volume,source=$backup_volume,target=/backups" -e DEMO_MAINTENANCE=1 demo-api:commercial-release node deployment/backup.mjs backup /backups/snapshot
backup_ms=$(( ($(date +%s%N) - backup_started) / 1000000 ))
export DATABASE_URL="postgresql://demo:${DEMO_DB_PASSWORD}@db:5432/$restore_db?schema=public"
restore_started=$(date +%s%N)
"${d[@]}" run "${common[@]}" --mount "type=volume,source=$restore_volume,target=/data" --mount "type=volume,source=$backup_volume,target=/backups,readonly" demo-api:commercial-release node deployment/backup.mjs restore /backups/snapshot
restore_ms=$(( ($(date +%s%N) - restore_started) / 1000000 ))
"${d[@]}" run "${common[@]}" --mount "type=volume,source=$restore_volume,target=/data" --mount "type=volume,source=$backup_volume,target=/backups,readonly" demo-api:commercial-release node deployment/backup.mjs verify /backups/snapshot
# Re-open the restored application and download the ORIGINAL retained bytes via HTTP.
"${d[@]}" run "${common[@]}" --mount "type=volume,source=$restore_volume,target=/data" --mount "type=bind,source=$script_dir/verify-restored-http.ts,target=/app/scripts/verification/verify-restored-http.ts,readonly" -e DEMO_CONTAINER_ACCEPTANCE=SYNTHETIC_ONLY demo-api:commercial-release pnpm exec tsx --tsconfig tsconfig.base.json scripts/verification/verify-restored-http.ts /evidence/backup-restore/fixture.json /evidence/backup-restore/http-readback.json
"${d[@]}" run "${common[@]}" --mount "type=volume,source=$backup_volume,target=/backups,readonly" demo-api:commercial-release node -e 'const fs=require("fs");fs.copyFileSync("/backups/snapshot/manifest.json","/evidence/backup-restore/backup-manifest.json")'
printf '{"status":"PASS","backupMs":%s,"restoreAndReconcileMs":%s,"sourceDatabase":"%s","restoreDatabase":"%s","sourceVolume":"%s","restoreVolume":"%s","snapshotVolume":"%s","snapshotPath":"/backups/snapshot"}\n' "$backup_ms" "$restore_ms" "$source_db" "$restore_db" "$source_volume" "$restore_volume" "$backup_volume" > "$evidence_dir/timing.json"
