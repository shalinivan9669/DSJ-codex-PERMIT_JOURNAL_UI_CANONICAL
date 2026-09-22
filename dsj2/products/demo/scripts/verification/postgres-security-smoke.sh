#!/usr/bin/env bash
set -euo pipefail
# This script owns only this explicitly named disposable synthetic container/volume.
test "${DEMO_CONTAINER_ACCEPTANCE:-}" = "SYNTHETIC_ONLY"
docker_cli=/home/admin/demo-commercial-runtime/docker/docker
docker_config=/home/admin/demo-commercial-runtime
docker_socket=unix:///home/admin/demo-commercial-runtime/docker.sock
d=("$docker_cli" --config "$docker_config" -H "$docker_socket")
container=demo-security-pg186
volume=demo-security-pg186
image=demo-postgres:18.6
if "${d[@]}" container inspect "$container" >/dev/null 2>&1 || "${d[@]}" volume inspect "$volume" >/dev/null 2>&1; then
  echo "Refusing to overwrite an existing smoke container or volume" >&2
  exit 1
fi
export POSTGRES_PASSWORD
POSTGRES_PASSWORD=$(openssl rand -hex 24)
"${d[@]}" volume create "$volume"
"${d[@]}" run -d --name "$container" --network none --read-only --user postgres \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m,uid=999,gid=999 \
  --tmpfs /var/run/postgresql:rw,noexec,nosuid,size=16m,uid=999,gid=999 \
  --shm-size 256m --memory 2g --cpus 2 --pids-limit 256 \
  --mount "type=volume,source=$volume,target=/var/lib/postgresql" \
  -e POSTGRES_PASSWORD -e POSTGRES_USER=demo -e POSTGRES_DB=demo_test_pg186 "$image"
unset POSTGRES_PASSWORD
trap '"${d[@]}" stop -t 15 "$container" >/dev/null 2>&1 || true' EXIT
ready() {
  for attempt in $(seq 1 60); do
    if "${d[@]}" exec "$container" pg_isready -U demo -d demo_test_pg186 >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  "${d[@]}" logs "$container"
  return 1
}
ready
"${d[@]}" exec "$container" sh -ceu 'test "$(id -u)" = 999; test ! -e /usr/local/bin/gosu; postgres --version; grep -E "^(NoNewPrivs|CapEff):" /proc/1/status'
"${d[@]}" exec "$container" sh -ceu 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U demo -d demo_test_pg186 -c "CREATE TABLE synthetic_retention(id integer PRIMARY KEY, value text NOT NULL); INSERT INTO synthetic_retention VALUES(1, '\''synthetic-security-smoke'\'');"'
"${d[@]}" kill --signal KILL "$container"
"${d[@]}" start "$container"
ready
"${d[@]}" exec "$container" sh -ceu 'value=$(psql -X -At -U demo -d demo_test_pg186 -c "SELECT value FROM synthetic_retention WHERE id=1"); test "$value" = "synthetic-security-smoke"; printf "%s\n" "Recovered durable synthetic row after SIGKILL"; pg_dump -U demo -d demo_test_pg186 -Fc -f /tmp/synthetic.dump; createdb -U demo demo_test_pg186_restore; pg_restore -U demo -d demo_test_pg186_restore --exit-on-error /tmp/synthetic.dump; restored=$(psql -X -At -U demo -d demo_test_pg186_restore -c "SELECT count(*) FROM synthetic_retention"); test "$restored" = 1; printf "%s\n" "Real pg_dump/pg_restore passed"'
"${d[@]}" inspect --format 'image={{.Image}} user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} capdrop={{json .HostConfig.CapDrop}} security={{json .HostConfig.SecurityOpt}} network={{.HostConfig.NetworkMode}}' "$container"
"${d[@]}" exec "$container" sh -ceu 'dpkg-query -W postgresql-18 postgresql-client-18 libgnutls30 libssl3 libxml2 libcap2; ldd /usr/lib/postgresql/18/bin/postgres; dpkg-query -W "*minizip*" 2>/dev/null || true'
echo "PASS: fresh non-root init, SCRAM TCP session, durable crash recovery, dump/restore, runtime restrictions. Synthetic volume retained."
