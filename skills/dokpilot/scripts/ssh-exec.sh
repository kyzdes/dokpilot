#!/bin/bash
# SSH command execution wrapper
# Usage: ssh-exec.sh <server-name> <command>
#        ssh-exec.sh --password <pass> <ip> <command>
#        ssh-exec.sh --bg <server-name> <command> [log-file]
#        ssh-exec.sh --poll <server-name> <process-pattern> [log-file]
#
# Examples:
#   ssh-exec.sh main "uname -a"
#   ssh-exec.sh main "docker ps"
#   ssh-exec.sh main "free -h && df -h"
#   ssh-exec.sh --password MyPass123 45.55.67.89 "apt update"
#   ssh-exec.sh --bg main "docker build -t app ." "/tmp/build.log"
#   ssh-exec.sh --poll main "docker build" "/tmp/build.log"
#
# Reads SSH credentials from config/servers.json
# Exit codes: 0 = success, 1 = config error, 2 = SSH error

set -euo pipefail

# StrictHostKeyChecking=no is used because VPS IPs may be reassigned or
# reinstalled frequently. For long-lived servers, consider switching to
# StrictHostKeyChecking=accept-new after first connection.
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o LogLevel=ERROR"

# --- Helper functions ---

# Load server config from servers.json. Sets HOST, USER, SSH_KEY globals.
_load_server_config() {
  local server_name="$1"
  local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local config="$script_dir/../config/servers.json"

  if [ ! -f "$config" ]; then
    echo '{"error": "Config not found. Run: /dokpilot config server add <name> <ip>"}' >&2
    exit 1
  fi

  HOST=$(jq -r ".servers.\"$server_name\".host // empty" "$config")
  USER=$(jq -r ".servers.\"$server_name\".ssh_user // \"root\"" "$config")
  SSH_KEY=$(jq -r ".servers.\"$server_name\".ssh_key // empty" "$config")

  if [ -z "$HOST" ]; then
    echo "{\"error\": \"Server '$server_name' not found in config\"}" >&2
    exit 1
  fi
}

# Run SSH command, handling SSH_KEY presence automatically.
_run_ssh() {
  local cmd="$1"
  if [ -n "$SSH_KEY" ] && [ "$SSH_KEY" != "null" ]; then
    ssh $SSH_OPTS -i "$SSH_KEY" "${USER}@${HOST}" "$cmd"
  else
    ssh $SSH_OPTS "${USER}@${HOST}" "$cmd"
  fi
}

# Escape single quotes for safe interpolation into sh -c '...' strings.
_escape_for_sh() {
  printf '%s' "$1" | sed "s/'/'\\\\''/"
}

# --- Modes ---

# Password mode (for initial setup when server is not in config yet)
# Note: uses SSHPASS env var instead of -p flag to avoid password in ps output
if [ "${1:-}" = "--password" ]; then
  PASSWORD="${2:?Missing password}"
  HOST="${3:?Missing host}"
  CMD="${4:?Missing command}"

  if ! command -v sshpass &> /dev/null; then
    echo '{"error": "sshpass not installed. Install: apt install sshpass / brew install sshpass"}' >&2
    exit 1
  fi

  export SSHPASS="$PASSWORD"
  sshpass -e ssh $SSH_OPTS "root@${HOST}" "$CMD"
  EXIT_CODE=$?
  unset SSHPASS
  exit $EXIT_CODE
fi

# Background mode — run long commands without SSH timeout
# Usage: ssh-exec.sh --bg <server-name> <command> [log-file]
if [ "${1:-}" = "--bg" ]; then
  shift
  SERVER="${1:?Usage: ssh-exec.sh --bg <server-name> <command> [log-file]}"
  CMD="${2:?Missing command}"
  LOG_FILE="${3:-/tmp/dokpilot-bg-$(date +%s).log}"

  _load_server_config "$SERVER"

  ESCAPED_CMD=$(_escape_for_sh "$CMD")
  SSH_CMD="nohup sh -c '${ESCAPED_CMD}' > ${LOG_FILE} 2>&1 & echo \$!"
  PID=$(_run_ssh "$SSH_CMD")

  echo "{\"status\": \"started\", \"pid\": \"$PID\", \"log_file\": \"${LOG_FILE}\"}"
  exit 0
fi

# Poll mode — check if a background process is still running
# Usage: ssh-exec.sh --poll <server-name> <process-pattern> [log-file]
if [ "${1:-}" = "--poll" ]; then
  shift
  SERVER="${1:?Usage: ssh-exec.sh --poll <server-name> <process-pattern> [log-file]}"
  PATTERN="${2:?Missing process pattern}"
  LOG_FILE="${3:-}"

  _load_server_config "$SERVER"

  ESCAPED_PATTERN=$(_escape_for_sh "$PATTERN")
  CHECK_CMD="pgrep -f '${ESCAPED_PATTERN}' > /dev/null 2>&1 && echo running || echo done"
  STATUS=$(_run_ssh "$CHECK_CMD")

  if [ "$STATUS" = "done" ] && [ -n "$LOG_FILE" ]; then
    TAIL=$(_run_ssh "tail -20 ${LOG_FILE} 2>/dev/null || echo 'Log not found'")
    echo "{\"status\": \"done\", \"log_tail\": $(echo "$TAIL" | jq -Rs .)}"
  else
    echo "{\"status\": \"$STATUS\"}"
  fi
  exit 0
fi

# Normal mode — read from config
SERVER="${1:?Usage: ssh-exec.sh <server-name> <command>}"
CMD="${2:?Missing command}"

_load_server_config "$SERVER"
_run_ssh "$CMD"
