#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
public_dir="$repo_root/public"
sharp_cli_version="5.3.0"

render_opaque() {
  local source="$1"
  local output="$2"
  local size="$3"
  npx --yes "sharp-cli@${sharp_cli_version}" \
    -i "$source" \
    -o "$output" \
    -f png \
    resize "$size" "$size" -- \
    flatten "#191c1f" -- \
    removeAlpha
}

render_transparent() {
  local source="$1"
  local output="$2"
  local size="$3"
  npx --yes "sharp-cli@${sharp_cli_version}" \
    -i "$source" \
    -o "$output" \
    -f png \
    resize "$size" "$size"
}

for size in 180 192 512 1024; do
  render_opaque \
    "$public_dir/dsp-brand-mark-v4-app.svg" \
    "$public_dir/dealer-social-dsp-v4-${size}.png" \
    "$size"
done

for size in 192 512 1024; do
  render_opaque \
    "$public_dir/dsp-brand-mark-v4-maskable.svg" \
    "$public_dir/dealer-social-dsp-v4-maskable-${size}.png" \
    "$size"
done

for size in 16 32 48; do
  favicon_source="$public_dir/dsp-brand-mark-v4.svg"
  if [[ "$size" == "16" ]]; then
    favicon_source="$public_dir/dsp-brand-mark-v4-micro.svg"
  fi
  render_transparent \
    "$favicon_source" \
    "$public_dir/dealer-social-favicon-v4-${size}.png" \
    "$size"
  render_transparent \
    "$favicon_source" \
    "$public_dir/favicon-${size}.png" \
    "$size"
done

render_opaque \
  "$public_dir/dsp-brand-mark-v4-app.svg" \
  "$public_dir/apple-touch-icon.png" \
  180

echo "Exported Dealer Social Post AI v4 logo assets."

# Current installed-app artwork; v4 URLs remain immutable for older clients.
studio_source="$repo_root/docs/brand/dealer-social-studio-v5-source.png"
for size in 180 192 512 1024; do
  render_opaque "$studio_source" "$public_dir/dealer-social-dsp-v5-${size}.png" "$size"
done
for size in 192 512 1024; do
  inset=$((size / 10))
  inner=$((size - inset * 2))
  npx --yes "sharp-cli@${sharp_cli_version}" \
    -i "$studio_source" -o "$public_dir/dealer-social-dsp-v5-maskable-${size}.png" -f png \
    resize "$inner" "$inner" -- \
    extend "$inset" "$inset" "$inset" "$inset" --background "#121416" -- \
    flatten "#121416" -- removeAlpha
done
render_opaque "$studio_source" "$public_dir/apple-touch-icon.png" 180
