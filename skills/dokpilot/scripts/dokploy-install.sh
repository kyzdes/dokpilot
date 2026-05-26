#!/usr/bin/env bash
# dokploy-install.sh <server> — run the official Dokploy installer on a
# configured server over SSH, streaming output line-by-line.
#
# DESTRUCTIVE: installs Docker (if needed) + Dokploy on the host. Only call
# this from the onboarding install job after an explicit user confirm.
#
# The Dokploy install command is the upstream one-liner. We run it through
# ssh-exec.sh so credentials + host resolution stay in one place. After it
# finishes the user creates the admin + API key in Dokploy's own first-run
# UI at http://<ip>:3000 (the key can't be minted headlessly).
set -euo pipefail

SERVER="${1:?usage: dokploy-install.sh <server>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Upstream installer (https://dokploy.com/install.sh). Piped to sh on the
# remote. Unbuffered so lines stream as they happen.
REMOTE_CMD='curl -sSL https://dokploy.com/install.sh | sh'

echo "[ok] Connecting to ${SERVER} to install Dokploy…"
exec bash "${SCRIPT_DIR}/ssh-exec.sh" "${SERVER}" "${REMOTE_CMD}"
