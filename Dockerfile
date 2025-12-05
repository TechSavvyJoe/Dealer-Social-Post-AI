# Stage 1: Build the Frontend
FROM node:18.20-alpine AS frontend-builder
WORKDIR /app

# Set build-time environment variables for Vite
ARG VITE_ADMIN_CODE=0000
ARG VITE_PROXY_ACCESS_TOKEN=208ade967fb8f2418b470f47f1d125c2318b56edba17c750c08361631de80288
ENV VITE_ADMIN_CODE=${VITE_ADMIN_CODE}
ENV VITE_PROXY_ACCESS_TOKEN=${VITE_PROXY_ACCESS_TOKEN}

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Setup PocketBase
FROM ubuntu:22.04

ARG PB_VERSION=0.22.22
ARG PB_SHA256=""

RUN apt-get update && apt-get install -y \
    unzip \
    ca-certificates \
    curl \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Download and verify PocketBase
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN if [ -n "$PB_SHA256" ]; then echo "${PB_SHA256}  /tmp/pb.zip" | sha256sum -c -; else echo "WARNING: PB_SHA256 not provided; skipping checksum verification."; fi && unzip /tmp/pb.zip -d /pb/

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
