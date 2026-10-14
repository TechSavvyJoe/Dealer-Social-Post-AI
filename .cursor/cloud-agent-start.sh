#!/usr/bin/env bash
# Cloud Agent start: local .env.local, then PocketBase (8090) and Vite (5173).
set -euo pipefail

cd /workspace
export PATH="/opt/node-v22.23.1/bin:${PATH}"

python3 - <<'PY'
import os, pathlib, secrets
path = pathlib.Path(".env.local")
existing = {}
if path.exists():
    for line in path.read_text().splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        existing[key] = value

def pick(name, fallback=""):
    env = os.environ.get(name, "")
    if env:
        return env
    return existing.get(name, fallback)

username = pick("ADMIN_LOGIN_USERNAME", "admin")
password = pick("ADMIN_LOGIN_PASSWORD")
if len(password) < 8:
    password = secrets.token_urlsafe(18)
pepper = pick("SALESPERSON_PIN_PEPPER")
if len(pepper) < 32:
    pepper = secrets.token_hex(24)
gemini = pick("GEMINI_API_KEY", "")

lines = [
    f"GEMINI_API_KEY={gemini}",
    f"ADMIN_LOGIN_USERNAME={username}",
    f"ADMIN_LOGIN_PASSWORD={password}",
    f"SALESPERSON_PIN_PEPPER={pepper}",
    "VITE_POCKETBASE_URL=http://127.0.0.1:8090",
    "VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA",
    "TURNSTILE_SITE_KEY=1x00000000000000000000AA",
    "TURNSTILE_ALLOWED_HOSTNAMES=localhost,127.0.0.1",
    "TURNSTILE_ENFORCEMENT_ENABLED=false",
    "ENABLE_CLAUDE_FALLBACK=false",
    "ENABLE_OPENAI_FALLBACK=false",
    "VITE_ENABLE_CLAUDE_FALLBACK=false",
    "VITE_ENABLE_OPENAI_FALLBACK=false",
    "VITE_WALKAROUND_STUDIO_ENABLED=false",
    "WALKAROUND_STUDIO_ENABLED=false",
]
text = "\n".join(lines) + "\n"
current = path.read_text() if path.exists() else ""
if current != text:
    path.write_text(text)
os.chmod(path, 0o600)
PY

health_code="$(curl -sS --connect-timeout 1 --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8090/api/app/health 2>/dev/null || true)"
vite_code="$(curl -sS --connect-timeout 1 --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/ 2>/dev/null || true)"
if { [ "$health_code" = "200" ] || [ "$health_code" = "503" ]; } && [ "$vite_code" = "200" ]; then
  echo "PocketBase and Vite are already listening."
  exit 0
fi

exec ./start-dev.sh
