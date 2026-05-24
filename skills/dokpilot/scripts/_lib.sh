#!/bin/bash
# Shared helpers sourced by cloudflare-dns.sh, dokploy-api.sh, and ssh-exec.sh.
#
# Not meant to be executed directly. Each caller must define:
#   - CONFIG      absolute path to servers.json
#   - SCRIPT_DIR  absolute path to the scripts/ directory (for locating secret-store.sh)

# resolve_secret <jq-path>
# Reads a field from $CONFIG. If the field is an object of the form
#   {"_secret": "<account>"}
# the value is fetched from the macOS Keychain via secret-store.sh.
# If the field is a plain string, it is returned as-is (backwards compatibility).
# Returns exit 1 and prints nothing if the field is missing or empty.
resolve_secret() {
  local jq_path="$1"
  local raw
  raw=$(jq -c "$jq_path // empty" "$CONFIG")
  [ -z "$raw" ] && return 1

  # Keychain reference: {"_secret": "<account>"}
  local account
  account=$(printf '%s' "$raw" | jq -r 'if type == "object" and has("_secret") then ._secret else empty end' 2>/dev/null)
  if [ -n "$account" ]; then
    bash "$SCRIPT_DIR/secret-store.sh" get "$account"
    return $?
  fi

  # Plain string value
  printf '%s' "$raw" | jq -r 'if type == "string" then . else empty end'
}
