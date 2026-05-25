"use strict";
/* routes/queue.js — deploy-queue visibility (KYZ-102).
   Abort actions (killBuild / cancelDeployment / cleanQueues) live in
   routes/writes.js since they're per-app POST mutations. */
const { json } = require("../lib/http");
const { listServerNames, dokploy, allSettledMap } = require("../lib/exec");

const unwrap = (r) => Array.isArray(r) ? r : (r?.result?.data || r?.deployments || r?.data || []);

/**
 * GET /api/deploy-queue?server=<name>
 *   Current deploy queue across all configured servers (or one). Each
 *   item is tagged with its server so the UI can show which Dokploy
 *   instance it belongs to.
 */
async function deployQueue(req, res) {
  const filter = req.query?.server;
  const names = filter ? [filter] : listServerNames();
  if (names.length === 0) return json(res, 200, { queue: [], empty: true });

  const byServer = await allSettledMap(names, async (name) => {
    const r = await dokploy(name, "GET", "deployment.queueList");
    if (r && r.__error) return { error: r };
    return { items: unwrap(r) };
  });

  const queue = [];
  const errors = [];
  for (const name of names) {
    const r = byServer[name];
    if (r.error) { errors.push({ server: name, error: r.error }); continue; }
    for (const d of (r.items || [])) {
      queue.push({
        server: name,
        deployment_id: d.deploymentId || d.id || null,
        app_id: d.applicationId || d.composeId || null,
        kind: d.composeId ? "compose" : "application",
        title: (d.title || d.commitMessage || "").split("\n")[0] || "",
        status: d.status || "queued",
        started_at: d.startedAt || d.createdAt || null,
      });
    }
  }
  json(res, 200, { queue, errors: errors.length ? errors : undefined });
}

module.exports = {
  "GET /api/deploy-queue": deployQueue,
};
