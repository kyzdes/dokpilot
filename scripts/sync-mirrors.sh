#!/usr/bin/env bash
# Windows fallback: if AGENTS.md / GEMINI.md are not symlinks, overwrite them
# with the current SKILL.md content so CI mirror-parity passes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/skills/dokpilot/SKILL.md"

for MIRROR in "$ROOT/AGENTS.md" "$ROOT/GEMINI.md"; do
  if [ -L "$MIRROR" ]; then
    continue
  fi
  cp "$SRC" "$MIRROR"
  echo "Synced $MIRROR from SKILL.md"
done
