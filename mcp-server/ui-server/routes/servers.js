"use strict";
const { json } = require("../lib/http");
const { listServerNames, readConfig, dokploy, sshExec, allSettledMap } = require("../lib/exec");

/**
 * GET /api/servers
 *   Returns a list of configured servers with:
 *     - identity: name, host, dokploy_url, ssh_user
 *     - liveness: status (healthy | unreachable | error) + project_count + app_count
 *     - secret source (file | keychain)
 *
 *   Uses `project.all` as the liveness probe (settings.version is
 *   often 404 in newer Dokploy versions — see KI-005-ish quirk).
 */
async function listServers(req, res) {
  const cfg = readConfig({ maskSecrets: false });
  if (cfg.__error) return json(res, 503, { error: "config-unavailable", ...cfg });

  const names = Object.keys(cfg.servers || {});
  if (names.length === 0) return json(res, 200, { servers: [], empty: true });

  const probes = await allSettledMap(names, async (name) => {
    const r = await dokploy(name, "GET", "project.all");
    if (r.__error) return { status: r.timedOut ? "unreachable" : "error", error: r };
    const list = Array.isArray(r) ? r : (r.result?.data || []);
    let appCount = 0, composeCount = 0, dbCount = 0;
    for (const p of list) {
      for (const e of (p.environments || [])) {
        appCount     += (e.applications || []).length;
        composeCount += (e.compose      || []).length;
        dbCount      += (e.postgres || []).length + (e.mysql || []).length
                      + (e.mariadb  || []).length + (e.mongo || []).length
                      + (e.redis    || []).length + (e.libsql || []).length;
      }
    }
    return {
      status: "healthy",
      project_count: list.length,
      app_count: appCount,
      compose_count: composeCount,
      database_count: dbCount,
    };
  });

  const servers = names.map((name) => {
    const sCfg = cfg.servers[name];
    const probe = probes[name] || { status: "error" };
    return {
      id: name,
      name,
      ip: sCfg.host,
      ssh_user: sCfg.ssh_user || "root",
      dokploy_url: sCfg.dokploy_url,
      is_default: cfg.defaults?.server === name,
      secret: (sCfg.dokploy_api_key && typeof sCfg.dokploy_api_key === "object" && sCfg.dokploy_api_key._secret)
        ? "keychain"
        : "file",
      added_at: sCfg.added_at,
      ...probe,
    };
  });

  json(res, 200, { servers });
}

/**
 * GET /api/servers/:name/stats — SSH probe.
 */
async function serverStats(req, res, ctx, params) {
  const name = params.name;
  const cfg = readConfig({ maskSecrets: false });
  if (cfg.__error) return json(res, 503, { error: "config-unavailable" });
  if (!cfg.servers?.[name]) return json(res, 404, { error: "unknown-server", name });

  // CPU: `top -bn1` reports a misleading first-sample value (we saw 94%
  // where Dokploy's own monitor showed 2%). vmstat's 2nd sample is a real
  // 1-second average. Column 15 is idle% on standard procps; 100-idle = used.
  const cmd = [
    "uptime -p",
    "vmstat 1 2 | tail -1 | awk '{print $15}'",   // idle %, 1s-averaged
    "free -m | grep Mem | awk '{print $3,$2}'",
    "df -h / | tail -1 | awk '{print $5}' | tr -d %",
  ].join(" && echo '---' && ");

  const r = await sshExec(name, cmd);
  if (r.__error) return json(res, 503, { error: "ssh-failed", ...r });

  const parts = r.stdout.split("---").map((s) => s.trim());
  const [uptimeStr, cpuIdleStr, memStr, diskStr] = parts;

  const cpuIdle = parseFloat(cpuIdleStr);
  const cpuUsed = Number.isFinite(cpuIdle) ? Math.max(0, Math.min(100, Math.round(100 - cpuIdle))) : null;

  const [ramUsed, ramTotal] = (memStr || "").split(/\s+/).map(Number);
  const ramPct = ramUsed && ramTotal ? Math.round((ramUsed / ramTotal) * 100) : null;

  const diskPct = parseInt(diskStr, 10);

  json(res, 200, {
    name,
    cpu_percent: cpuUsed,
    ram_used_mb: ramUsed || null,
    ram_total_mb: ramTotal || null,
    ram_percent: ramPct,
    disk_percent: Number.isFinite(diskPct) ? diskPct : null,
    uptime: uptimeStr,
    probed_at: new Date().toISOString(),
  });
}

module.exports = {
  "GET /api/servers": listServers,
  "GET /api/servers/:name/stats": serverStats,
};
