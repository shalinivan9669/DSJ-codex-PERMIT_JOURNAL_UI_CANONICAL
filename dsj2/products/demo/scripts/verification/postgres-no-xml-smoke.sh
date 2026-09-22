#!/usr/bin/env bash
set -euo pipefail
# Owns only these explicitly named disposable synthetic resources.
test "${DEMO_CONTAINER_ACCEPTANCE:-}" = "SYNTHETIC_ONLY"
d=(/home/admin/demo-commercial-runtime/docker/docker --config /home/admin/demo-commercial-runtime -H unix:///home/admin/demo-commercial-runtime/docker.sock)
suffix=${DEMO_SMOKE_SUFFIX:-}
[[ "$suffix" =~ ^[a-z0-9-]*$ ]]
container="demo-security-pg186-no-xml${suffix}"
volume="$container"
network="$container"
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
image=demo-postgres:18.6-no-xml
for resource in container volume network; do
  if "${d[@]}" "$resource" inspect "$container" >/dev/null 2>&1; then
    echo "Refusing to overwrite existing $resource $container" >&2
    exit 1
  fi
done
export POSTGRES_PASSWORD DATABASE_URL
POSTGRES_PASSWORD=$(openssl rand -hex 24)
DATABASE_URL="postgresql://demo:${POSTGRES_PASSWORD}@${container}:5432/demo_test_pg186_no_xml?schema=public"
"${d[@]}" volume create "$volume"
"${d[@]}" network create --internal "$network"
"${d[@]}" run -d --name "$container" --network "$network" --read-only --user postgres \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m,uid=70,gid=70 \
  --tmpfs /var/run/postgresql:rw,noexec,nosuid,size=16m,uid=70,gid=70 \
  --shm-size 256m --memory 2g --cpus 2 --pids-limit 256 \
  --mount "type=volume,source=$volume,target=/var/lib/postgresql" \
  -e POSTGRES_PASSWORD -e POSTGRES_USER=demo -e POSTGRES_DB=demo_test_pg186_no_xml \
  -e 'POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale-provider=icu --icu-locale=ru-KZ' "$image"
trap 'unset POSTGRES_PASSWORD DATABASE_URL; "${d[@]}" stop -t 15 "$container" >/dev/null 2>&1 || true' EXIT
ready() {
  for attempt in $(seq 1 60); do
    if "${d[@]}" exec "$container" pg_isready -U demo -d demo_test_pg186_no_xml >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  "${d[@]}" logs "$container"
  return 1
}
ready
"${d[@]}" exec "$container" sh -ceu 'test "$(id -u)" = 70; test ! -e /usr/local/bin/gosu; postgres --version; pg_config --configure; grep -E "^(NoNewPrivs|CapEff):" /proc/1/status; ! apk info --installed libxml2; ! apk info --installed libxslt; ! ldd /usr/local/bin/postgres | grep -E "libxml|libxslt"; ldd /usr/local/bin/postgres'
# The real Prisma migration engine deploys the complete product schema.
"${d[@]}" run --rm --network "$network" --read-only --tmpfs /tmp:rw,nosuid,size=64m \
  --cap-drop ALL --security-opt no-new-privileges:true -e DATABASE_URL \
  "${DEMO_MIGRATION_IMAGE:-demo-api:commercial-final}" pnpm db:deploy
"${d[@]}" image inspect --format 'application_image={{.Id}}' "${DEMO_MIGRATION_IMAGE:-demo-api:commercial-final}"
"${d[@]}" run --rm --network "$network" --read-only \
  --tmpfs /tmp:rw,nosuid,size=128m,uid=1000,gid=1000 \
  --tmpfs /data:rw,noexec,nosuid,size=64m,uid=1000,gid=1000 \
  --mount "type=bind,source=$repo/tests,target=/app/tests,readonly" \
  --cap-drop ALL --security-opt no-new-privileges:true -e DATABASE_URL -e NODE_ENV=test \
  "${DEMO_MIGRATION_IMAGE:-demo-api:commercial-final}" \
  pnpm exec tsx --tsconfig tsconfig.base.json --test tests/integration/http.test.ts
"${d[@]}" exec -i "$container" sh -ceu 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U demo -d demo_test_pg186_no_xml' <<'SQL'
SELECT current_setting('server_version') AS version, current_setting('server_encoding') AS encoding;
SELECT datlocprovider, datlocale FROM pg_database WHERE datname=current_database();
SELECT count(*) AS applied_product_migrations FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;
CREATE TABLE synthetic_retention(id integer PRIMARY KEY, value text NOT NULL, metadata jsonb NOT NULL);
INSERT INTO synthetic_retention VALUES(1, 'Қауіпсіздік: Ә Ғ Қ Ң Ө Ұ Ү Һ І; Проверка знаний', '{"казахский":"Ә Ғ Қ Ң Ө Ұ Ү Һ І","русский":"Проверка знаний","nested":{"date":"2026-09-22"}}');
DO $$ BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN RAISE EXCEPTION 'UTF8 missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datlocprovider='i') THEN RAISE EXCEPTION 'ICU missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM synthetic_retention WHERE metadata->>'казахский'='Ә Ғ Қ Ң Ө Ұ Ү Һ І') THEN RAISE EXCEPTION 'JSONB Unicode mismatch'; END IF;
  IF (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL) < 1 THEN RAISE EXCEPTION 'No product migrations'; END IF;
  BEGIN
    PERFORM XMLPARSE(DOCUMENT '<synthetic/>');
    RAISE EXCEPTION 'Unexpected SQL/XML support';
  EXCEPTION WHEN feature_not_supported THEN
    RAISE NOTICE 'Expected: optional SQL/XML is absent';
  END;
END $$;
SQL
"${d[@]}" kill --signal KILL "$container"
"${d[@]}" start "$container"
ready
"${d[@]}" exec -i "$container" sh -ceu 'test "$(psql -X -At -U demo -d demo_test_pg186_no_xml -c "SELECT count(*) FROM synthetic_retention")" = 1; pg_dump -U demo -d demo_test_pg186_no_xml -Fc -f /tmp/synthetic.dump; createdb -U demo demo_test_pg186_no_xml_restore; pg_restore -U demo -d demo_test_pg186_no_xml_restore --exit-on-error /tmp/synthetic.dump; psql -X -v ON_ERROR_STOP=1 -U demo -d demo_test_pg186_no_xml_restore' <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM synthetic_retention WHERE value='Қауіпсіздік: Ә Ғ Қ Ң Ө Ұ Ү Һ І; Проверка знаний' AND metadata->>'казахский'='Ә Ғ Қ Ң Ө Ұ Ү Һ І') THEN RAISE EXCEPTION 'Restored Unicode data mismatch'; END IF;
  IF (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL) < 1 THEN RAISE EXCEPTION 'Restored migration history missing'; END IF;
END $$;
SELECT count(*) AS restored_product_tables FROM information_schema.tables WHERE table_schema='public';
SQL
"${d[@]}" inspect --format 'image={{.Image}} user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} capdrop={{json .HostConfig.CapDrop}} security={{json .HostConfig.SecurityOpt}} network={{.HostConfig.NetworkMode}}' "$container"
"${d[@]}" exec "$container" apk --no-network info -vv
echo 'PASS: fresh UID70 init, UTF8+ICU, Unicode/JSONB, real Prisma migrations and Nest HTTP security regression, SCRAM TCP, expected SQL/XML absence, durable SIGKILL recovery, full schema+data dump/restore. Synthetic resources retained.'
