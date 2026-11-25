# lil-dudes-server (apps/server) for Render / Fly / any Docker host. Build from the REPO ROOT:
#   docker build -f apps/server/Dockerfile -t lil-dudes-server .
# Secrets (SPONSOR_SECRET_KEY, BOT_SECRET_KEY) come from the host's secret store at run time,
# never from the image. One instance only: rooms, the queue and the limits live in memory.
FROM node:22.12-slim
ENV NODE_ENV=production PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# pnpm straight from npm: the Corepack bundled with this Node can't verify newer pnpm releases.
RUN npm install -g pnpm@10.34.9
WORKDIR /app
# Only what the server needs: the workspace manifests, the client contract and the prebuilt WASM.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/sim-wasm/package.json packages/sim-wasm/
COPY packages/client/package.json packages/client/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter server... --prod=false
COPY packages/sim-wasm packages/sim-wasm
COPY packages/client packages/client
COPY apps/server apps/server
# Never ship keys or local env files, even by accident.
RUN rm -rf packages/client/scripts/keys apps/server/.env* && test ! -e apps/server/.env
USER node
WORKDIR /app/apps/server
ENV PORT=8787 TRUST_PROXY=1
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/index.ts"]
