"use strict";
const { json } = require("../lib/http");
const { readConfig, listServerNames } = require("../lib/exec");

module.exports = {
  // Returns masked config (never exposes secret values, only presence + source).
  "GET /api/config": (req, res) => {
    const cfg = readConfig({ maskSecrets: true });
    if (cfg.__error) return json(res, 503, { error: "config-unavailable", ...cfg });

    // Derive server count + cloudflare configured flag for quick UI access
    const serverCount = Object.keys(cfg.servers || {}).length;
    const cfConfigured = !!(cfg.cloudflare && cfg.cloudflare.api_token);

    json(res, 200, {
      config: cfg,
      summary: {
        server_count: serverCount,
        cloudflare_configured: cfConfigured,
        default_server: cfg.defaults?.server || null,
        server_names: listServerNames(),
      },
    });
  },
};
