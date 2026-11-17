# Quinvium full node as a container image (ghcr.io/lakylife/quinvium-node).
# Build from the repository root: docker build -f ops/docker/Dockerfile -t quinvium-node .
# The node's dependencies are plain JavaScript and WebAssembly, so they are installed once on the build machine
# and copied into the image of every architecture (amd64, arm64) without emulation.
# Base image pinned by digest: node 24.22.2 on Debian bookworm (slim).
ARG NODE_IMAGE=node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/node/package.json packages/node/
COPY packages/contracts/package.json packages/contracts/
COPY packages/desktop/package.json packages/desktop/
RUN npm ci --ignore-scripts --omit=dev --workspace packages/node --include-workspace-root=false --no-audit --no-fund \
 && mkdir -p /data packages/node/node_modules

FROM ${NODE_IMAGE}
ARG VERSION=dev
LABEL org.opencontainers.image.title="quinvium-node" \
      org.opencontainers.image.description="Quinvium full node (Ethash proof-of-work, EVM)" \
      org.opencontainers.image.source="https://github.com/Lakylife/quinvium" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production QUINTIUM_LANG=en
WORKDIR /app
COPY --from=deps /src/node_modules node_modules
COPY packages/node/package.json packages/node/
COPY --from=deps /src/packages/node/node_modules packages/node/node_modules
COPY packages/node/src packages/node/src
COPY packages/explorer/public packages/explorer/public
# No RUN in this stage: it would need emulation for the other architecture.
COPY --from=deps --chown=node:node /data /data
USER node
VOLUME /data
# 30524 P2P (mainnet), 8545 JSON-RPC and the Explorer, 3333 Stratum. Testnet: 30525, 8546, 3334.
EXPOSE 30524 8545 3333
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.RPC_PORT||8545)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["node", "--no-warnings", "/app/packages/node/src/cli.js", "--data-dir", "/data", "--rpc-host", "0.0.0.0"]
CMD ["--network", "mainnet"]
