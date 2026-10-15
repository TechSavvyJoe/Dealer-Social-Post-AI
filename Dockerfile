# Stage 1: Build the Frontend
FROM node:22.23.1-alpine AS frontend-builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_ENABLE_CLAUDE_FALLBACK=false
ARG VITE_ENABLE_OPENAI_FALLBACK=false
ARG VITE_TURNSTILE_SITE_KEY
ARG VITE_RELEASE_SHA
ARG VITE_WALKAROUND_STUDIO_ENABLED=false
ENV VITE_ENABLE_CLAUDE_FALLBACK=${VITE_ENABLE_CLAUDE_FALLBACK}
ENV VITE_ENABLE_OPENAI_FALLBACK=${VITE_ENABLE_OPENAI_FALLBACK}
ENV VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY}
ENV VITE_RELEASE_SHA=${VITE_RELEASE_SHA}
ENV VITE_WALKAROUND_STUDIO_ENABLED=${VITE_WALKAROUND_STUDIO_ENABLED}
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
# SHA256 is for pocketbase_0.22.55_linux_amd64.zip (computed from the official
# GitHub release artifact; the project publishes no checksums file). 0.22.55 is
# the current head of the 0.22 line: it backports the goja bump, the golang.org/x
# security fixes, and the Go 1.27 encoding/json recursion workaround, with no
# API change for our hooks.
ARG PB_VERSION=0.22.55
ARG PB_SHA256="2e404f98bc693cfa7c8160bc9f1903fc7dc448c4f6fe78128c0cd1561a2db46e"
# Caddy terminates Fly's public :8090 and blocks /_/ by default so the
# PocketBase admin UI is not internet-reachable. Keep this pin in lockstep
# with the checksum below when bumping.
ARG CADDY_VERSION=2.9.1
ARG CADDY_SHA256="0542edbb5ce0d6987de6a37caa2bbc52a42445ec094fb9ba3e605534af5dd898"
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

# Download and verify Caddy (public edge in front of loopback PocketBase)
ADD https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz /tmp/caddy.tgz
RUN echo "${CADDY_SHA256}  /tmp/caddy.tgz" | sha256sum -c - \
    && tar -xzf /tmp/caddy.tgz -C /usr/local/bin caddy \
    && chmod 755 /usr/local/bin/caddy \
    && rm /tmp/caddy.tgz \
    && caddy version

# Force cache invalidation for frontend copy
RUN echo "Cache bust: ${CACHE_BUST}"

# Copy the built frontend assets to PocketBase's public directory
COPY --from=frontend-builder /app/dist /pb/pb_public

# Copy the PocketBase hooks
COPY pb_hooks /pb/pb_hooks

# Copy migrations
COPY pb_migrations /pb/pb_migrations

EXPOSE 8090

# Public edge (Caddy) + process supervisor. PocketBase is started on
# 127.0.0.1:8091 by entrypoint.sh; only Caddy listens on 0.0.0.0:8090.
COPY entrypoint.sh /pb/entrypoint.sh
COPY Caddyfile /pb/Caddyfile
COPY Caddyfile.open-admin /pb/Caddyfile.open-admin
RUN chmod +x /pb/entrypoint.sh

# Drop root privileges for runtime
RUN useradd -m -d /home/pbuser pbuser && chown -R pbuser:pbuser /pb
USER pbuser

CMD ["/pb/entrypoint.sh"]
