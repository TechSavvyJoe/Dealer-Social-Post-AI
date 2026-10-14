#!/usr/bin/env bash
# Cloud Agent install: Node 22.23.1, npm ci, Playwright Chromium, PocketBase 0.22.55.
set -euo pipefail

cd /workspace

NODE_VERSION="22.23.1"
NODE_PREFIX="/opt/node-v${NODE_VERSION}"
PB_VERSION="0.22.55"
PB_SHA256="2e404f98bc693cfa7c8160bc9f1903fc7dc448c4f6fe78128c0cd1561a2db46e"

export PATH="${NODE_PREFIX}/bin:${PATH}"

if ! "${NODE_PREFIX}/bin/node" -v 2>/dev/null | grep -qx "v${NODE_VERSION}"; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl --fail --location --retry 3 --retry-all-errors \
    --connect-timeout 15 --max-time 180 \
    "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    -o "${tmp}/node-v${NODE_VERSION}-linux-x64.tar.xz"
  curl --fail --location --retry 3 --retry-all-errors \
    --connect-timeout 15 --max-time 60 \
    "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
    -o "${tmp}/SHASUMS256.txt"
  (cd "$tmp" && grep "node-v${NODE_VERSION}-linux-x64.tar.xz" SHASUMS256.txt | sha256sum -c -)
  sudo tar -xJf "${tmp}/node-v${NODE_VERSION}-linux-x64.tar.xz" -C /opt
  sudo rm -rf "${NODE_PREFIX}"
  sudo mv "/opt/node-v${NODE_VERSION}-linux-x64" "${NODE_PREFIX}"
  rm -rf "$tmp"
  trap - EXIT
fi

# /exec-daemon/node is an older Node that precedes /usr/local/bin on this image.
# cargo/bin is ahead of it in login shells, so link both.
for bin in node npm npx corepack; do
  sudo ln -sfn "${NODE_PREFIX}/bin/${bin}" "/usr/local/bin/${bin}"
  if [ -d /usr/local/cargo/bin ]; then
    sudo ln -sfn "${NODE_PREFIX}/bin/${bin}" "/usr/local/cargo/bin/${bin}"
  fi
done

hash -r
corepack enable
corepack prepare npm@10.9.8 --activate

npm ci --no-audit --no-fund

# Frontend smoke tests (npx playwright test) use Chromium. WebKit is CI-only.
npx playwright install --with-deps chromium

if ! ./pocketbase --version 2>/dev/null | grep -q "${PB_VERSION}"; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl --fail --location --retry 3 --retry-all-errors \
    --connect-timeout 15 --max-time 180 \
    "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" \
    -o "${tmp}/pocketbase.zip"
  echo "${PB_SHA256}  ${tmp}/pocketbase.zip" | sha256sum -c -
  unzip -q "${tmp}/pocketbase.zip" -d "$tmp"
  chmod 0755 "${tmp}/pocketbase"
  mv -f "${tmp}/pocketbase" ./pocketbase
  rm -rf "$tmp"
  trap - EXIT
fi

./pocketbase --version
node -v
npm -v
