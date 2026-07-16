# Stage 1: Build the Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_ENABLE_CLAUDE_FALLBACK=false
ARG VITE_ENABLE_OPENAI_FALLBACK=false
ENV VITE_ENABLE_CLAUDE_FALLBACK=${VITE_ENABLE_CLAUDE_FALLBACK}
ENV VITE_ENABLE_OPENAI_FALLBACK=${VITE_ENABLE_OPENAI_FALLBACK}
RUN npm run build

# Stage 2: Setup PocketBase
FROM ubuntu:22.04

# Pinned to the latest 0.22 maintenance release to MATCH the JSVM API the hooks
# are written against while retaining the security and stability backports in
# that compatibility line.
# (pb_hooks/*.js use $app.dao(), c.request(), $apis.requestInfo — all removed
# in PocketBase v0.23+). The committed ./pocketbase binary and
# start-pocketbase.sh use the same 0.22 line. Building 0.39.x here would ship
# hooks that throw at runtime (every /api/app/*
# and /api/proxy/* route fails). To move to 0.39 later, migrate ALL hooks +
# migrations to the v0.23+ API first, then bump this version + SHA together.
# SHA256 is for pocketbase_0.22.37_linux_amd64.zip (verified against the
# official GitHub release).
ARG PB_VERSION=0.22.37
ARG PB_SHA256="71ea53559eff79e7afc80898bd63bdb04930003e2ee9440971c3d958c25c63d8"
# Cache bust arg - change to force rebuild of frontend copy
ARG CACHE_BUST=1

RUN apt-get update && apt-get install -y \
    unzip \
    ca-certificates \
    curl \
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
