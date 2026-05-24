#!/usr/bin/env bash
# Dokpilot UI launcher
# Spawns ui-server/server.js in background. The server writes its own
# state files (.ui-pid, .ui-port, .ui-url) on listen — launcher polls
# them with a 5s timeout. No FIFO, no race conditions on restart.
#
# Usage:
#   launch.sh              start server, open browser, exit
#   launch.sh --stop       kill the running server (if any)
#   launch.sh --status     print port/pid/url if alive
#   launch.sh --no-open    start but don't `open` the URL (CI use)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_JS="$SCRIPT_DIR/server.js"

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
# Remove any stale state files so we can detect a fresh write.
rm -f "$URL_FILE" "$PORT_FILE" "$PID_FILE"

# Run server in --quiet mode so stdout is just the URL (server also
# writes state files atomically on listen — we poll those).
nohup node "$SERVER_JS" --port 0 --quiet \
  >>"$LOG_FILE" 2>>"$LOG_FILE" &

# Poll for state file with 5s timeout. The server writes .ui-url
# atomically as the last step, so seeing it means the listener is up.
deadline=$(($(date +%s) + 5))
while [ ! -s "$URL_FILE" ]; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "error: ui-server did not write state within 5s — check $LOG_FILE" >&2
    exit 3
  fi
  sleep 0.1
done

url="$(cat "$URL_FILE")"
pid="$(cat "$PID_FILE")"
port="$(cat "$PORT_FILE")"

echo "Dokpilot UI live at: $url"
echo "  pid:  $pid"
echo "  log:  $LOG_FILE"
echo "  stop: /dokpilot ui --stop"

if [ "$NO_OPEN" = "0" ]; then
  open "$url" 2>/dev/null || true
fi
