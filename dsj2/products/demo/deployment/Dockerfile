# Build context MUST be products/demo. No parent DSJ files enter any layer.
FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && chmod -R a+rX /opt/corepack
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/render-worker/package.json apps/render-worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/printing/package.json packages/printing/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN node scripts/verification/autonomy.mjs && DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm db:generate && pnpm -r build

FROM build AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 COREPACK_ENABLE_NETWORK=0
RUN mkdir -p /data/artifacts && chown -R node:node /app /data
USER node
EXPOSE 3100
CMD ["pnpm", "--filter", "@demo/web", "start"]

FROM python:3.12.14-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e AS python
FROM postgres:18.3-bookworm@sha256:80630f83606d8db77d30b3851b16a9f78be2d0d4dda6f7b82a1fdca5ebe3acba AS pgtools
FROM build AS runtime
USER root
COPY --from=python /usr/local/ /usr/local/
ARG LO_VERSION=26.2.6
ARG LO_SHA256=fd0e8f8f2408dd2e5b90286e60f3f97cf566ba441cd48cfc5bcc68067303e0bc
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl fontconfig libreadline8 liblz4-1 libzstd1 libpq5 \
    && curl --fail --location --retry 3 "https://download.documentfoundation.org/libreoffice/stable/${LO_VERSION}/deb/x86_64/LibreOffice_${LO_VERSION}_Linux_x86-64_deb.tar.gz" -o /tmp/libreoffice.tar.gz \
    && echo "${LO_SHA256}  /tmp/libreoffice.tar.gz" | sha256sum -c - \
    && mkdir /tmp/libreoffice && tar -xzf /tmp/libreoffice.tar.gz -C /tmp/libreoffice \
    && apt-get install -y --no-install-recommends /tmp/libreoffice/*/DEBS/*.deb \
    && /opt/libreoffice26.2/program/soffice --headless --version | grep 'LibreOffice 26.2.6' \
    && python3 -m pip install --no-cache-dir -r scripts/render/requirements.txt \
    && mkdir -p /usr/local/share/fonts/demo && cp -r assets/fonts/. /usr/local/share/fonts/demo/ && fc-cache -f \
    && mkdir -p /data/artifacts /backups && chown -R node:node /app /data /backups \
    && rm -rf /tmp/libreoffice /tmp/libreoffice.tar.gz /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 COREPACK_ENABLE_NETWORK=0 DEMO_PYTHON=python3 DEMO_SOFFICE=/opt/libreoffice26.2/program/soffice DEMO_ARTIFACT_ROOT=/data/artifacts
COPY --from=pgtools /usr/lib/postgresql/18/bin/ /usr/lib/postgresql/18/bin/
COPY --from=pgtools /usr/lib/x86_64-linux-gnu/libpq.so* /usr/lib/x86_64-linux-gnu/
ENV DEMO_PG_DUMP=/usr/lib/postgresql/18/bin/pg_dump DEMO_PG_RESTORE=/usr/lib/postgresql/18/bin/pg_restore DEMO_PSQL=/usr/lib/postgresql/18/bin/psql
USER node
EXPOSE 4100
CMD ["pnpm", "--filter", "@demo/api", "start"]

FROM runtime AS worker
CMD ["pnpm", "--filter", "@demo/render-worker", "start"]
