#!/usr/bin/env bash
# Dokpilot UI launcher — M0
# Spawns ui-server/server.js in background, captures the URL on stdout,
# writes pid + port + token paths under ~/.claude/skills/dokpilot/, opens
# the URL in the default browser (macOS `open`).
#
# Usage:
#   launch.sh              start server, open browser, exit
#   launch.sh --stop       kill the running server (if any)
#   launch.sh --status     print port/pid/url if alive
#   launch.sh --no-open    start but don't `open` the URL (CI use)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_JS="$SCRIPT_DIR/server.js"

# State paths — under skill install (not repo) so they survive repo moves
STATE_DIR="${HOME}/.claude/skills/dokpilot"
PID_FILE="$STATE_DIR/.ui-pid"
PORT_FILE="$STATE_DIR/.ui-port"
URL_FILE="$STATE_DIR/.ui-url"
LOG_FILE="$STATE_DIR/ui-server.log"

mkdir -p "$STATE_DIR"

# ─── subcommands ────────────────────────────────────────────────
if [ "${1:-}" = "--stop" ]; then
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && echo "stopped pid=$pid"
    else
      echo "stale pid=$pid (process already gone)"
    fi
    rm -f "$PID_FILE" "$PORT_FILE" "$URL_FILE"
  else
    echo "not running"
  fi
  exit 0
fi

if [ "${1:-}" = "--status" ]; then
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "running"
    echo "  pid:  $(cat "$PID_FILE")"
    echo "  port: $(cat "$PORT_FILE" 2>/dev/null || echo '?')"
    echo "  url:  $(cat "$URL_FILE" 2>/dev/null || echo '?')"
  else
    echo "not running"
  fi
  exit 0
fi

NO_OPEN=0
[ "${1:-}" = "--no-open" ] && NO_OPEN=1

# ─── ensure node available ──────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "error: node not on PATH. Install Node 20+ to run the dashboard." >&2
  exit 2
fi

# ─── if already running, just reopen ────────────────────────────
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  url="$(cat "$URL_FILE")"
  echo "already running at $url"
  [ "$NO_OPEN" = "1" ] || open "$url" 2>/dev/null || true
  exit 0
fi

# ─── start ──────────────────────────────────────────────────────
# Run in --quiet mode so the only stdout is the URL.
# Background it, capture pid, read the URL from a tiny coproc.
# We use a fifo for the URL handoff so we can wait for the listen event.

URL_FIFO="$(mktemp -u)"
mkfifo "$URL_FIFO"
trap 'rm -f "$URL_FIFO"' EXIT

# Spawn: write stderr to log, stdout to fifo, fork into background
( node "$SERVER_JS" --port 0 --quiet 2>>"$LOG_FILE" 1>"$URL_FIFO" & echo $! >"$PID_FILE" ) &

# Read the URL with a 5s timeout (server should listen near-instantly)
url=""
if read -r -t 5 url <"$URL_FIFO"; then
  :
else
  echo "error: ui-server did not emit URL within 5s — check $LOG_FILE" >&2
  if [ -f "$PID_FILE" ]; then kill "$(cat "$PID_FILE")" 2>/dev/null || true; fi
  exit 3
fi

# Derive port from URL (http://127.0.0.1:<port>/?t=…)
port="$(echo "$url" | sed -nE 's|.*://127\.0\.0\.1:([0-9]+)/.*|\1|p')"
chmod 600 "$PID_FILE" 2>/dev/null || true
printf '%s' "$port" >"$PORT_FILE" && chmod 600 "$PORT_FILE" 2>/dev/null || true
printf '%s' "$url"  >"$URL_FILE"  && chmod 600 "$URL_FILE"  2>/dev/null || true

echo "Dokpilot UI live at: $url"
echo "  pid:  $(cat "$PID_FILE")"
echo "  log:  $LOG_FILE"
echo "  stop: /dokpilot ui --stop"

if [ "$NO_OPEN" = "0" ]; then
  open "$url" 2>/dev/null || true
fi
