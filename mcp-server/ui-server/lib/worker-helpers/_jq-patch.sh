#!/usr/bin/env bash
# Atomic jq-patch helper sourced by the other worker scripts.
# Reads JOB_PATH from env (set by claude-worker.js when spawning claude),
# applies a jq filter, writes back via tmp+rename.
#
# Usage (sourced):
#   source "$(dirname "$0")/_jq-patch.sh"
#   jq_patch '<filter>' [extra jq args]
#
# extra jq args lets you use --arg / --argjson safely (text values
# never get interpolated into the filter string).

set -euo pipefail

: "${JOB_PATH:?JOB_PATH env not set — worker helpers must be invoked from claude-worker subprocess}"

jq_patch() {
  local filter="$1"
  shift
  local tmp="${JOB_PATH}.tmp-$$"
  jq "$@" "${filter}" "$JOB_PATH" > "$tmp"
  mv "$tmp" "$JOB_PATH"
}

# Get current time as HH:MM:SS for log entries
now_t() { date +%H:%M:%S; }
# ISO-8601 timestamp for updated_at
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
