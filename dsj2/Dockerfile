FROM node:22-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace manifests first so pnpm install can be cached.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/ncalayer-bridge/package.json apps/ncalayer-bridge/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/utils/package.json packages/utils/package.json
COPY packages/database/prisma packages/database/prisma

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm db:generate && pnpm exec turbo run build --filter=@dsj/api... --filter=@dsj/worker...

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="/opt/venv/bin:${PNPM_HOME}:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip libatomic1 openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY scripts/requirements-runtime.txt /tmp/requirements-runtime.txt

RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements-runtime.txt

WORKDIR /app

COPY --from=build /app /app

# Run from the repo root so deploy and document-generation helpers share the same layout.
CMD ["pnpm", "--filter", "@dsj/api", "start:railway"]
