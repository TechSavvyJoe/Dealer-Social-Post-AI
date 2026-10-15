#!/usr/bin/env bash
# Decide which CI lanes take a runner.
#
# Push to main and workflow_dispatch run the full set. workflow_dispatch on
# main can deploy, so it uses the same bar as a push. The nightly schedule
# runs WebKit and the 3x unit pass only. Pull requests run Chromium and the
# unit suite once, skip WebKit, and run the 48-angle editor only when a
# vehicle-spin/editor path changed. Drafts and docs-only pull requests skip
# the heavy lanes. Docs-only detection matches the push paths-ignore list.
#
# Env:
#   EVENT_NAME   push | pull_request | schedule | workflow_dispatch
#   PR_DRAFT     true | false
#   BASE_SHA     pull request base, or github.event.before on push.
#                Empty or all zeros means there is no parent commit. Push,
#                schedule, and workflow_dispatch ignore it and keep their
#                fixed lane set. A pull request with no base runs the heavy
#                lanes instead of calling git diff.
#   CHANGED_FILES  optional NUL-separated path list. Tests set this so the
#                  decision does not depend on the checkout.
#   GITHUB_OUTPUT  when set, KEY=value lines are appended for Actions.
set -euo pipefail

EVENT_NAME="${EVENT_NAME:-}"
PR_DRAFT="${PR_DRAFT:-false}"
BASE_SHA="${BASE_SHA:-}"

unit=false
stability=false
chromium=false
webkit=false
editor=false
container=false
small=false
docs_only=false
draft=false

is_docs_path() {
  case "$1" in
    docs/* | *.md | *.mdx | .github/ISSUE_TEMPLATE/* | .github/PULL_REQUEST_TEMPLATE/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_editor_path() {
  case "$1" in
    utils/vehicleSpin* | components/VehicleSpin* | components/Home.tsx | hooks/useSpinFrameUrls.ts | e2e/vehicle-spin* | e2e/fixtures/* | services/vehicleSpins.ts | services/vehicleSpins.test.ts | pb_hooks/vehicleSpins.js | pb_hooks/vehicleSpins.pb.js | playwright.config.ts | .github/workflows/ci.yml)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

case "$EVENT_NAME" in
  push | workflow_dispatch)
    unit=true
    stability=true
    chromium=true
    webkit=true
    editor=true
    container=true
    small=true
    ;;
  schedule)
    unit=true
    stability=true
    webkit=true
    ;;
  pull_request)
    if [ "$PR_DRAFT" = "true" ]; then
      draft=true
      small=true
    else
      docs_only=true
      editor_match=false
      diff_empty=true
      list_file="$(mktemp)"
      if [ -n "${CHANGED_FILES:-}" ]; then
        cp "$CHANGED_FILES" "$list_file"
      elif [ -z "$BASE_SHA" ] || [[ "$BASE_SHA" =~ ^0+$ ]]; then
        docs_only=false
        editor_match=true
        diff_empty=false
      else
        git diff --name-only -z "$BASE_SHA" HEAD > "$list_file"
      fi
      if [ -s "$list_file" ]; then
        while IFS= read -r -d '' file; do
          diff_empty=false
          if ! is_docs_path "$file"; then
            docs_only=false
          fi
          if is_editor_path "$file"; then
            editor_match=true
          fi
        done < "$list_file"
      fi
      rm -f "$list_file"
      # An empty diff is not documentation. Run the heavy lanes.
      if [ "$diff_empty" = "true" ]; then
        docs_only=false
        editor_match=true
      fi
      if [ "$docs_only" != "true" ]; then
        unit=true
        chromium=true
        container=true
        small=true
        if [ "$editor_match" = "true" ]; then
          editor=true
        fi
      fi
    fi
    ;;
  *)
    echo "Unsupported CI event: ${EVENT_NAME:-<empty>}" >&2
    exit 1
    ;;
esac

echo "unit=$unit stability=$stability chromium=$chromium webkit=$webkit editor=$editor container=$container small=$small docs_only=$docs_only draft=$draft"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "unit=$unit"
    echo "stability=$stability"
    echo "chromium=$chromium"
    echo "webkit=$webkit"
    echo "editor=$editor"
    echo "container=$container"
    echo "small=$small"
    echo "docs_only=$docs_only"
    echo "draft=$draft"
  } >> "$GITHUB_OUTPUT"
fi
