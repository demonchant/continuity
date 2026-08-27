FROM node:22-bookworm-slim AS build

WORKDIR /workspace/backend
RUN apt-get update \
    && apt-get install --no-install-recommends -y openssl \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm install --global npm@11.16.0
RUN npm ci
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/prisma ./prisma
COPY backend/src ./src
RUN npm run prisma:generate && npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PATH="/opt/sibyl/bin:${PATH}"

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates openssl python3 python3-venv \
    && python3 -m venv /opt/sibyl \
    && /opt/sibyl/bin/pip install --no-cache-dir --timeout 120 --retries 5 sibyl-memory-mcp==0.1.13 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm install --global npm@11.16.0
RUN npm ci --omit=dev
COPY --chown=node:node --from=build /workspace/backend/dist ./dist
COPY --chown=node:node --from=build /workspace/backend/node_modules/.prisma ./node_modules/.prisma
COPY --chown=node:node backend/prisma ./prisma
COPY --chown=node:node public /workspace/public

RUN mkdir -p /data/sibyl && chown node:node /data/sibyl
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const port=process.env.PORT||3000;fetch('http://127.0.0.1:'+port+'/api/v1/readiness').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["sh", "-c", "npm run prisma:deploy && node dist/server.js"]
