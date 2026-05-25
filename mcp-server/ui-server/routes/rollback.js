"use strict";
/* routes/rollback.js — one-click rollback to a previous image (KYZ-105).

   Dokploy contract (verified live v0.29.5):
     - application.one carries `rollbackActive` + `rollbackRegistryId`.
       Rollbacks require a Docker registry (images are tagged & pushed so a
       prior tag can be redeployed). When no registry is set, rollbackActive
       is false and no rollback snapshots exist.
     - Each deployment has a `rollbackId`; deployments with a non-null
       rollbackId are the available rollback points.
     - rollback.rollback({ rollbackId }) performs the rollback (mutation).
*/
const { json } = require("../lib/http");
const csrf = require("../lib/csrf");
const { dokploy } = require("../lib/exec");

function readBody(req, max = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let len = 0;
    req.on("data", (c) => { len += c.length; if (len > max) { reject(Object.assign(new Error("body too large"), { code: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => { const b = Buffer.concat(chunks).toString("utf8"); if (!b) return resolve(null); try { resolve(JSON.parse(b)); } catch (e) { reject(Object.assign(new Error("invalid json"), { code: 400 })); } });
    req.on("error", reject);
  });
}

/**
 * GET /api/apps/:id/rollbacks?server=<name>
 *   { rollback_active, registry_id, rollbacks:[{rollback_id, deployment_id,
 *     title, status, finished_at}] }
 */
async function listRollbacks(req, res, ctx, params) {
  const server = req.query?.server || params.server;
  const appId = params.id;
  if (!server) return json(res, 400, { error: "missing-server" });

  const r = await dokploy(server, "GET", `application.one?applicationId=${encodeURIComponent(appId)}`);
  if (r && r.__error) return json(res, 502, { error: "fetch-failed", ...r });
  const data = r?.result?.data || r;
  const deployments = Array.isArray(data?.deployments) ? data.deployments : [];

  const rollbacks = deployments
    .filter((d) => d.rollbackId)
    .map((d) => ({
      rollback_id: d.rollbackId,
      deployment_id: d.deploymentId,
      title: (d.title || "").split("\n")[0] || "(deploy)",
      status: d.status,
      finished_at: d.finishedAt || d.createdAt || null,
    }));

  json(res, 200, {
    app_id: appId,
    server,
    rollback_active: !!data?.rollbackActive,
    registry_id: data?.rollbackRegistryId || data?.registryId || null,
    rollbacks,
  });
}

/**
 * POST /api/apps/:id/rollback   Body: { server, rollback_id }
 *   Rolls the app back to the image captured by that rollback point.
 */
async function doRollback(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const server = body?.server || req.query?.server;
  const rollbackId = body?.rollback_id;
  if (!server) return json(res, 400, { error: "missing-server" });
  if (!rollbackId) return json(res, 400, { error: "missing-rollback_id" });

  const r = await dokploy(server, "POST", "rollback.rollback", { rollbackId });
  if (r && r.__error) return json(res, 502, { error: "rollback-failed", ...r });
  json(res, 200, { rolled_back: true, app_id: params.id, rollback_id: rollbackId, response: r });
}

module.exports = {
  "GET /api/apps/:id/rollbacks": listRollbacks,
  "POST /api/apps/:id/rollback": doRollback,
};
