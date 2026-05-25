"use strict";
/* routes/notifications.js — deploy/build/threshold alerts (KYZ-109).

   SECURITY: notification.all leaks channel credentials (e.g.
   telegram.botToken, slack webhook). We NEVER surface those — the list is
   sanitized to id + name + type + the event flags only. On create the user
   supplies their own token; we pass it straight to Dokploy and never echo
   or store it (same model as the Dokploy API key).

   Dokploy contract (verified live v0.29.5):
     GET  notification.all
     POST notification.testTelegramConnection { botToken, chatId, messageThreadId }
     POST notification.createTelegram { name, botToken, chatId, messageThreadId, <all event flags> }
     POST notification.remove { notificationId }
   (Slack/Discord/etc. follow the same create<Type>/test<Type>Connection shape.)
*/
const { json } = require("../lib/http");
const csrf = require("../lib/csrf");
const { dokploy } = require("../lib/exec");

function readBody(req, max = 32 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let len = 0;
    req.on("data", (c) => { len += c.length; if (len > max) { reject(Object.assign(new Error("body too large"), { code: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => { const b = Buffer.concat(chunks).toString("utf8"); if (!b) return resolve(null); try { resolve(JSON.parse(b)); } catch (e) { reject(Object.assign(new Error("invalid json"), { code: 400 })); } });
    req.on("error", reject);
  });
}

const EVENTS = ["appDeploy", "appBuildError", "databaseBackup", "volumeBackup", "dokployRestart", "dokployBackup", "dockerCleanup", "serverThreshold"];

/** Return only safe fields — never any channel credential. */
function sanitize(n) {
  const events = {};
  for (const e of EVENTS) events[e] = !!n[e];
  return {
    notification_id: n.notificationId,
    name: n.name,
    type: n.notificationType,
    created_at: n.createdAt,
    events,
  };
}

/** GET /api/notifications?server=<name> */
async function listNotifications(req, res) {
  const server = req.query?.server;
  if (!server) return json(res, 400, { error: "missing-server" });
  const r = await dokploy(server, "GET", "notification.all");
  if (r && r.__error) return json(res, 502, { error: "fetch-failed", ...r });
  const list = Array.isArray(r) ? r : (r?.result?.data || []);
  json(res, 200, { server, notifications: list.map(sanitize) });
}

/** POST /api/notifications/test?server=  Body: { type, ...creds } — test before save */
async function testNotification(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const server = body?.server || req.query?.server;
  const type = body?.type;
  if (!server || !type) return json(res, 400, { error: "missing-fields", required: ["server", "type"] });
  const cap = type.charAt(0).toUpperCase() + type.slice(1);
  const { server: _s, type: _t, ...creds } = body;
  if (type === "telegram" && creds.messageThreadId == null) creds.messageThreadId = "";
  const r = await dokploy(server, "POST", `notification.test${cap}Connection`, creds);
  if (r && r.__error) return json(res, 200, { ok: false, error: (r.stderr || "test failed").slice(0, 300) });
  json(res, 200, { ok: true });
}

/** POST /api/notifications?server=  Body: { type, name, events:{}, ...creds } */
async function createNotification(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const server = body?.server;
  const type = body?.type;
  if (!server || !type || !body?.name) return json(res, 400, { error: "missing-fields", required: ["server", "type", "name"] });
  const cap = type.charAt(0).toUpperCase() + type.slice(1);
  const events = body.events || {};
  const payload = { name: body.name };
  for (const e of EVENTS) payload[e] = !!events[e];
  // channel creds (everything not server/type/name/events)
  for (const [k, v] of Object.entries(body)) {
    if (["server", "type", "name", "events"].includes(k)) continue;
    payload[k] = v;
  }
  if (type === "telegram" && payload.messageThreadId == null) payload.messageThreadId = "";
  const r = await dokploy(server, "POST", `notification.create${cap}`, payload);
  if (r && r.__error) return json(res, 502, { error: "create-failed", ...r });
  const data = r?.result?.data || r;
  json(res, 201, { notification: sanitize(data) });   // sanitized — no creds echoed
}

/** DELETE /api/notifications/:id?server= */
async function removeNotification(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  const server = req.query?.server;
  if (!server) return json(res, 400, { error: "missing-server" });
  const r = await dokploy(server, "POST", "notification.remove", { notificationId: params.id });
  if (r && r.__error) return json(res, 502, { error: "remove-failed", ...r });
  json(res, 200, { deleted: params.id });
}

module.exports = {
  "GET /api/notifications": listNotifications,
  "POST /api/notifications/test": testNotification,
  "POST /api/notifications": createNotification,
  "DELETE /api/notifications/:id": removeNotification,
};
