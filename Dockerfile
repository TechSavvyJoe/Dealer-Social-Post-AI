# Stage 1: Build the Frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Setup PocketBase
FROM alpine:latest

ARG PB_VERSION=0.22.21

RUN apk add --no-cache \
    unzip \
    ca-certificates

# Download and unzip PocketBase
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /pb/

# Copy the built frontend assets to PocketBase's public directory
COPY --from=frontend-builder /app/dist /pb/pb_public

# Copy the PocketBase hooks
COPY pb_hooks /pb/pb_hooks

EXPOSE 8090

# Start PocketBase with hooks enabled
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--hooksDir=/pb/pb_hooks", "--dir=/pb/pb_data"]
