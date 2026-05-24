"use strict";
const { json } = require("../lib/http");
const { keysList } = require("../lib/exec");

/**
 * GET /api/secrets/status
 *   Returns metadata for all secrets stored in keys-keeper. NEVER
 *   exposes values — only names, types, and tags. The UI uses this to
 *   render the settings/integrations page (which keys are present,
 *   which are missing).
 *
 *   If the `keys` CLI is not installed, returns 503 with a hint.
 */
async function secretStatus(req, res) {
  const r = await keysList();
  if (r.__error) {
    return json(res, 503, {
      error: "keys-cli-unavailable",
      message: r.message || "Cannot reach keys-keeper CLI",
      hint: r.code === 127 ? "Install via: pipx install keys-keeper" : null,
    });
  }
  // The shape varies slightly between `keys list --json` and our text-parse
  // fallback. Normalize to { items: [{type, name, tags[]}] }.
  const items = (r.items || r.entries || []).map((it) => ({
    name: it.name,
    type: it.type,
    tags: it.tags || [],
  }));

  // Compute presence flags relevant to Dokpilot — UI can render
  // "Dokploy API key: ✓ stored / ✗ missing" without needing to grep.
  const present = (predicate) => items.some(predicate);
  const flags = {
    dokploy_keys: items.filter(i => i.type === "api_key" && /dokploy/i.test(i.name)).map(i => i.name),
    cloudflare:   present(i => i.type === "api_key" && /cloudflare/i.test(i.name)),
    has_keys_cli: true,
  };

  json(res, 200, { items, flags, count: items.length });
}

module.exports = {
  "GET /api/secrets/status": secretStatus,
};
