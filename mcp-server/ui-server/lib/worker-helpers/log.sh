#!/usr/bin/env bash
# log.sh — append a log entry to the job file.
# Usage: log.sh <kind> "<message>"
#   kind: info | ok | warn | error

source "$(dirname "$0")/_jq-patch.sh"

KIND="${1:?Usage: log.sh <kind> <message>}"
shift
TEXT="$*"

case "$KIND" in
  info|ok|warn|error) : ;;
  *) echo "unknown kind: $KIND (use info|ok|warn|error)" >&2; exit 2 ;;
esac

jq_patch "
  .log += [{ t: \"$(now_t)\", kind: \"$KIND\", text: \$text }]
  | .updated_at = \"$(now_iso)\"
" --arg text "$TEXT"

# Echo to stdout for Claude's own visibility too
echo "[$KIND] $TEXT"
