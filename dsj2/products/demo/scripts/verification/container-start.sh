#!/usr/bin/env bash
set -euo pipefail
# Run only against a dedicated engine/project. This script provisions synthetic data.
test "${DEMO_CONTAINER_ACCEPTANCE:-}" = "SYNTHETIC_ONLY"
case "${COMPOSE_PROJECT_NAME:-}" in demo-commercial-test|demo-commercial-release) ;; *) exit 2 ;; esac
test "$#" -eq 2
case "${DEMO_ACCEPTANCE_IMAGE_TAG:-}" in commercial-final|commercial-release) ;; *) echo 'Set the exact acceptance image tag' >&2; exit 2 ;; esac
release_root=$(realpath "$1")
secret_file=$(realpath "$2")
compose=(docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$secret_file" -f "$release_root/deployment/compose.yaml")
"${compose[@]}" config --quiet
docker tag "demo-api:$DEMO_ACCEPTANCE_IMAGE_TAG" demo-api:2.0.0
docker tag "demo-web:$DEMO_ACCEPTANCE_IMAGE_TAG" demo-web:2.0.0
docker image inspect demo-api:2.0.0 demo-web:2.0.0 --format '{{json .RepoTags}} {{.Id}}'
"${compose[@]}" up -d db
"${compose[@]}" run --rm migrate
"${compose[@]}" run --rm -e DEMO_SAMPLE_DATA=1 setup
"${compose[@]}" up -d api worker web ingress
"${compose[@]}" ps
for service in api worker web ingress db; do
  identifier=$("${compose[@]}" ps -q "$service")
  docker inspect --format '{{.Name}} user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} ports={{json .NetworkSettings.Ports}}' "$identifier"
done
curl --fail --silent http://localhost:8080/api/health
