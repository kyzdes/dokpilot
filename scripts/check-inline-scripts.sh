#!/usr/bin/env bash
# check-inline-scripts.sh — node --check the inline <script> in every
# dokpilot-ui/*.html page. Catches syntax errors (e.g. a missing paren)
# that never surface server-side. Used by CI + locally before browser tests.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0

for f in "$ROOT"/dokpilot-ui/*.html; do
  # The inline block opens with a bare `<script>` on its own line (the other
  # tag is `<script src="assets/app.js">`). Grab the last such block.
  start=$(grep -n '^<script>$' "$f" | tail -1 | cut -d: -f1)
  end=$(grep -n '^</script>$' "$f" | tail -1 | cut -d: -f1)
  [ -z "$start" ] && continue   # page has no inline script
  tmp="$(mktemp "${TMPDIR:-/tmp}/dok-inline.XXXXXX.js")"
  sed -n "$((start+1)),$((end-1))p" "$f" > "$tmp"
  if node --check "$tmp" 2>/tmp/dok-inline.err; then
    echo "✓ $(basename "$f")"
  else
    echo "✗ $(basename "$f")"; sed 's/^/    /' /tmp/dok-inline.err; fail=1
  fi
  rm -f "$tmp"
done

[ "$fail" = 0 ] && echo "all inline scripts OK" || echo "INLINE SCRIPT ERRORS"
exit "$fail"
