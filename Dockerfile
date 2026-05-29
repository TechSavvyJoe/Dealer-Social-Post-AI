# Stage 1: Build the Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Setup PocketBase
FROM ubuntu:22.04

# Pinned to 0.22.21 to MATCH the JSVM API the hooks are written against
# (pb_hooks/*.js use $app.dao(), c.request(), $apis.requestInfo — all removed
# in PocketBase v0.23+). The committed ./pocketbase binary and
# start-pocketbase.sh are also 0.22.21, so this is the version actually tested.
# Building 0.38.0 here shipped hooks that throw at runtime (every /api/app/*
# and /api/proxy/* route fails). To move to 0.38 later, migrate ALL hooks +
# migrations to the v0.23+ API first, then bump this version + SHA together.
# SHA256 is for pocketbase_0.22.21_linux_amd64.zip (verified against the
# official GitHub release).
ARG PB_VERSION=0.22.21
ARG PB_SHA256="b63271053a2ea2c703f3438a8fc7db89775d6f5667765b72a5157bfaa35414e6"
# Cache bust arg - change to force rebuild of frontend copy
ARG CACHE_BUST=1

RUN apt-get update && apt-get install -y \
    unzip \
    ca-certificates \
    curl \
    openssl \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Download and verify PocketBase
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN if [ -n "$PB_SHA256" ]; then echo "${PB_SHA256}  /tmp/pb.zip" | sha256sum -c -; else echo "WARNING: PB_SHA256 not provided; skipping checksum verification."; fi && unzip /tmp/pb.zip -d /pb/

# Force cache invalidation for frontend copy
RUN echo "Cache bust: ${CACHE_BUST}"

# Copy the built frontend assets to PocketBase's public directory
COPY --from=frontend-builder /app/dist /pb/pb_public

# Copy the PocketBase hooks
COPY pb_hooks /pb/pb_hooks

# Copy migrations
COPY pb_migrations /pb/pb_migrations

EXPOSE 8090

# Start PocketBase with hooks enabled
COPY entrypoint.sh /pb/entrypoint.sh
RUN chmod +x /pb/entrypoint.sh

# Drop root privileges for runtime
RUN useradd -m -d /home/pbuser pbuser && chown -R pbuser:pbuser /pb
USER pbuser

# Start PocketBase with hooks enabled
CMD ["/pb/entrypoint.sh"]
