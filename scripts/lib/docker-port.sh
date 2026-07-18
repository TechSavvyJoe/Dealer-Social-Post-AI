#!/usr/bin/env bash

# Docker can return from `run --detach` before an automatically assigned host
# port is visible through `docker port`. Resolve that mapping with a short,
# bounded retry so release drills do not fail on daemon timing alone.
resolve_docker_published_port() {
  local container_id="${1:-}"
  local container_port="${2:-8090/tcp}"
  local max_attempts="${3:-20}"
  local attempt
  local mapping
  local port
  local state

  if [[ -z "$container_id" || -z "$container_port" ||
        ! "$max_attempts" =~ ^[1-9][0-9]*$ ]]; then
    return 2
  fi

  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    mapping="$(docker port "$container_id" "$container_port" 2>/dev/null || true)"
    port="$(awk -F: 'NR == 1 { print $NF }' <<<"$mapping")"
    if [[ "$port" =~ ^[0-9]+$ ]] &&
      ((10#$port >= 1 && 10#$port <= 65535)); then
      printf '%s\n' "$port"
      return 0
    fi

    state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
    if [[ "$state" = "dead" || "$state" = "exited" ]]; then
      return 1
    fi
    sleep 1
  done

  return 1
}
