"use strict";
/* routes/docker.js — Docker container control per server (KYZ-106).

   Dokploy contract (verified live v0.29.5):
     GET  docker.getContainers[?serverId=<id>]  → [{containerId,name,image,ports,state,status}]
          (no serverId = the local Dokploy host; server.all is empty when
           everything runs on the controller host)
     POST docker.restartContainer|startContainer|stopContainer|killContainer
          |removeContainer  body { containerId, serverId? }
     GET  docker.getConfig?containerId=<id>[&serverId=<id>]  → inspect
*/
const { json } = require("../lib/http");
const csrf = require("../lib/csrf");
const { dokploy, readConfig } = require("../lib/exec");

function readBody(req, max = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let len = 0;
    req.on("data", (c) => { len += c.length; if (len > max) { reject(Object.assign(new Error("body too large"), { code: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => { const b = Buffer.concat(chunks).toString("utf8"); if (!b) return resolve(null); try { resolve(JSON.parse(b)); } catch (e) { reject(Object.assign(new Error("invalid json"), { code: 400 })); } });
    req.on("error", reject);
  });
}

const ACTIONS = {
  restart: "docker.restartContainer",
  start:   "docker.startContainer",
  stop:    "docker.stopContainer",
  kill:    "docker.killContainer",
  remove:  "docker.removeContainer",
};

function ensureServer(server) {
  const cfg = readConfig({ maskSecrets: false });
  if (cfg.__error || !cfg.servers?.[server]) return false;
  return true;
}

/** GET /api/servers/:name/containers[?serverId=] */
async function listContainers(req, res, ctx, params) {
  const server = params.name;
  if (!ensureServer(server)) return json(res, 404, { error: "unknown-server", server });
  const serverId = req.query?.serverId;
  const ep = serverId ? `docker.getContainers?serverId=${encodeURIComponent(serverId)}` : "docker.getContainers";
  const r = await dokploy(server, "GET", ep);
  if (r && r.__error) return json(res, 502, { error: "fetch-failed", ...r });
  const list = Array.isArray(r) ? r : (r?.result?.data || []);
  json(res, 200, {
    server,
    containers: list.map((c) => ({
      id: c.containerId,
      name: c.name,
      image: c.image,
      ports: c.ports || "",
      state: c.state || "",
      status: c.status || "",
    })),
  });
}

/** POST /api/servers/:name/containers/:cid/:action  (restart|start|stop|kill|remove) */
async function containerAction(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  const server = params.name;
  if (!ensureServer(server)) return json(res, 404, { error: "unknown-server", server });
  const ep = ACTIONS[params.action];
  if (!ep) return json(res, 400, { error: "unknown-action", action: params.action, allowed: Object.keys(ACTIONS) });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const payload = { containerId: params.cid };
  if (body?.serverId) payload.serverId = body.serverId;
  const r = await dokploy(server, "POST", ep, payload);
  if (r && r.__error) return json(res, 502, { error: "action-failed", action: params.action, ...r });
  json(res, 200, { ok: true, action: params.action, container: params.cid, response: r });
}

/** GET /api/servers/:name/containers/:cid/config[?serverId=] */
async function containerConfig(req, res, ctx, params) {
  const server = params.name;
  if (!ensureServer(server)) return json(res, 404, { error: "unknown-server", server });
  const serverId = req.query?.serverId;
  const ep = `docker.getConfig?containerId=${encodeURIComponent(params.cid)}` + (serverId ? `&serverId=${encodeURIComponent(serverId)}` : "");
  const r = await dokploy(server, "GET", ep);
  if (r && r.__error) return json(res, 502, { error: "config-failed", ...r });
  json(res, 200, { server, container: params.cid, config: r?.result?.data || r });
}

module.exports = {
  "GET /api/servers/:name/containers": listContainers,
  "POST /api/servers/:name/containers/:cid/:action": containerAction,
  "GET /api/servers/:name/containers/:cid/config": containerConfig,
};
