# Stage 1: Build React frontend
FROM node:20-alpine AS client-builder
WORKDIR /build/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: Build server (with native module compilation)
FROM node:20-alpine AS server-deps
RUN apk add --no-cache python3 make g++
WORKDIR /build
COPY package*.json ./
RUN npm install --omit=dev

# Stage 3: Production runtime
FROM node:20-alpine AS runtime
RUN apk add --no-cache libstdc++ git

WORKDIR /app

# Copy built artifacts
COPY --from=server-deps /build/node_modules ./node_modules
COPY --from=client-builder /build/public ./public
COPY src/ ./src/
COPY drizzle/ ./drizzle/
COPY package.json ./

# Create volume mount points
RUN mkdir -p /app/data /projects

# Version embed (overridden by build arg in CI)
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
