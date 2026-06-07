# Stage 1: Build React frontend
FROM node:20-slim AS client-builder
WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build server deps (node-pty removed — no native build tools needed)
FROM node:20-slim AS server-deps
WORKDIR /build
COPY package*.json ./
RUN npm install --omit=dev

# Stage 3: Production runtime
FROM node:20-slim AS runtime
RUN apt-get update && apt-get install -y git docker.io && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=server-deps /build/node_modules ./node_modules
COPY --from=client-builder /build/public ./public
COPY src/ ./src/
COPY drizzle/ ./drizzle/
COPY package.json ./

RUN mkdir -p /app/data /projects

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PROJECTS_DIR=/projects

VOLUME ["/app/data", "/projects"]
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/setup/status > /dev/null 2>&1 || exit 1

CMD ["node", "src/index.js"]
