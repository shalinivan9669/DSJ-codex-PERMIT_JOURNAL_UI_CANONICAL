# Build context MUST be products/demo. No parent DSJ files enter any layer.
FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 COREPACK_HOME=/opt/corepack
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@11.27.1 --activate && chmod -R a+rX /opt/corepack \
    && rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
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
RUN mkdir -p /data/artifacts && chown -R node:node /data
USER node
EXPOSE 3100
CMD ["pnpm", "--filter", "@demo/web", "start"]

FROM python:3.12.14-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e AS python
FROM postgres:18.6-bookworm@sha256:3725f4e2499eef5134592b3b4ab79a543ed7f8e533b05b5b637af926630f6650 AS pgtools
FROM dependencies AS render-runtime
USER root
COPY --from=python /usr/local/ /usr/local/
COPY scripts/render/requirements.txt /tmp/demo-render-requirements.txt
COPY assets/fonts/ /usr/local/share/fonts/demo/
ARG LO_VERSION=26.2.6
ARG LO_SHA256=fd0e8f8f2408dd2e5b90286e60f3f97cf566ba441cd48cfc5bcc68067303e0bc
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl fontconfig libreadline8 liblz4-1 libzstd1 libpq5 \
        libxinerama1 libcairo2 libcups2 libdbus-1-3 libsm6 libx11-xcb1 libxrender1 libglu1-mesa libxrandr2 libnss3 libxslt1.1 libglib2.0-0 \
    && curl --fail --location --retry 3 "https://download.documentfoundation.org/libreoffice/stable/${LO_VERSION}/deb/x86_64/LibreOffice_${LO_VERSION}_Linux_x86-64_deb.tar.gz" -o /tmp/libreoffice.tar.gz \
    && echo "${LO_SHA256}  /tmp/libreoffice.tar.gz" | sha256sum -c - \
    && mkdir /tmp/libreoffice && tar -xzf /tmp/libreoffice.tar.gz -C /tmp/libreoffice \
    && apt-get install -y --no-install-recommends /tmp/libreoffice/*/DEBS/*.deb \
    && rm -rf /tmp/libreoffice /tmp/libreoffice.tar.gz /var/lib/apt/lists/*
RUN /opt/libreoffice26.2/program/soffice --headless --version | grep 'LibreOffice 26.2.6' \
    && python3 -m pip install --no-cache-dir -r /tmp/demo-render-requirements.txt \
    && rm /tmp/demo-render-requirements.txt && fc-cache -f \
    && mkdir -p /data/artifacts /backups && chown -R node:node /data /backups
ENV NODE_ENV=production HOST=0.0.0.0 COREPACK_ENABLE_NETWORK=0 DEMO_PYTHON=python3 DEMO_SOFFICE=/opt/libreoffice26.2/program/soffice DEMO_ARTIFACT_ROOT=/data/artifacts
COPY --from=pgtools /usr/lib/postgresql/18/bin/ /usr/lib/postgresql/18/bin/
COPY --from=pgtools /usr/lib/x86_64-linux-gnu/libpq.so* /usr/lib/x86_64-linux-gnu/
ENV DEMO_PG_DUMP=/usr/lib/postgresql/18/bin/pg_dump DEMO_PG_RESTORE=/usr/lib/postgresql/18/bin/pg_restore DEMO_PSQL=/usr/lib/postgresql/18/bin/psql

FROM render-runtime AS runtime
COPY --from=build /app/ /app/
USER node
EXPOSE 4100
CMD ["pnpm", "--filter", "@demo/api", "start"]

FROM runtime AS worker
CMD ["pnpm", "--filter", "@demo/render-worker", "start"]
