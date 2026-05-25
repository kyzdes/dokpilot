"use strict";
/* routes/backups.js — backup destinations + backups (KYZ-107).

   Scope (honest): destinations CRUD + test, per-database backup listing,
   manual backup trigger, and S3 file listing. RESTORE is intentionally NOT
   here: Dokploy exposes restore only as `restoreBackupWithLogs`, a tRPC
   subscription over WebSocket, which our HTTP-only dokploy-api.sh can't
   drive (see decision D-011 — we deferred the WS bridge). The UI points the
   user at Dokploy's own restore for now.

   Dokploy contract (verified live v0.29.5):
     GET  destination.all                         → [] (S3 targets)
     POST destination.create / .testConnection / .remove / .update
     POST backup.create / .update / .remove       (schedule, tied to a DB/compose)
     POST backup.manualBackup{Postgres|MySql|Mariadb|Mongo|Libsql|Compose|WebServer}  { backupId }
     GET  backup.listBackupFiles?destinationId=&search=&serverId=
     <engine>.one carries a backups[] array.
*/
const { json } = require("../lib/http");
const csrf = require("../lib/csrf");
const { dokploy } = require("../lib/exec");

function readBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let len = 0;
    req.on("data", (c) => { len += c.length; if (len > max) { reject(Object.assign(new Error("body too large"), { code: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => { const b = Buffer.concat(chunks).toString("utf8"); if (!b) return resolve(null); try { resolve(JSON.parse(b)); } catch (e) { reject(Object.assign(new Error("invalid json"), { code: 400 })); } });
    req.on("error", reject);
  });
}

const firstServer = (req) => req.query?.server;
const SECRET_KEYS = new Set(["accessKey", "secretAccessKey", "secretKey"]);
/** Strip S3 secret material from a destination object before returning it. */
function safeDest(d) {
  if (!d || typeof d !== "object") return d;
  const out = {};
  for (const k of Object.keys(d)) {
    if (SECRET_KEYS.has(k)) out[k] = d[k] ? "••••••••" : null;
    else out[k] = d[k];
  }
  return out;
}

const MANUAL = {
  postgres: "backup.manualBackupPostgres",
  mysql:    "backup.manualBackupMySql",
  mariadb:  "backup.manualBackupMariadb",
  mongo:    "backup.manualBackupMongo",
  libsql:   "backup.manualBackupLibsql",
  compose:  "backup.manualBackupCompose",
  webserver:"backup.manualBackupWebServer",
};

/** GET /api/destinations?server=<name> */
async function listDestinations(req, res) {
  const server = firstServer(req);
  if (!server) return json(res, 400, { error: "missing-server" });
  const r = await dokploy(server, "GET", "destination.all");
  if (r && r.__error) return json(res, 502, { error: "fetch-failed", ...r });
  const list = Array.isArray(r) ? r : (r?.result?.data || []);
  json(res, 200, { server, destinations: list.map(safeDest) });
}

/** POST /api/destinations  Body: { server, name, provider, endpoint, bucket, region, accessKey, secretAccessKey } */
async function createDestination(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  if (!body) return json(res, 400, { error: "missing-body" });
  const { server, ...fields } = body;
  if (!server) return json(res, 400, { error: "missing-server" });
  if (!fields.name || !fields.bucket) return json(res, 400, { error: "missing-fields", required: ["name", "bucket"] });
  const r = await dokploy(server, "POST", "destination.create", fields);
  if (r && r.__error) return json(res, 502, { error: "create-failed", ...r });
  const data = r?.result?.data || r;
  // Never echo secret material back
  json(res, 201, { destination: safeDest(data) });
}

/** POST /api/destinations/:id/test  Body: { server } — tests a saved destination */
async function testDestination(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const server = body?.server || req.query?.server;
  if (!server) return json(res, 400, { error: "missing-server" });
  const r = await dokploy(server, "POST", "destination.testConnection", { destinationId: params.id });
  if (r && r.__error) return json(res, 200, { ok: false, error: (r.stderr || "test failed").slice(0, 300) });
  json(res, 200, { ok: true, response: r });
}

/** DELETE /api/destinations/:id  (server via ?server=) */
async function removeDestination(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  const server = req.query?.server;
  if (!server) return json(res, 400, { error: "missing-server" });
  const r = await dokploy(server, "POST", "destination.remove", { destinationId: params.id });
  if (r && r.__error) return json(res, 502, { error: "remove-failed", ...r });
  json(res, 200, { deleted: params.id });
}

/** GET /api/backups?server=&engine=&id=  — backups[] on a specific DB/compose */
async function listBackups(req, res) {
  const server = req.query?.server;
  const engine = req.query?.engine || "postgres";
  const id = req.query?.id;
  if (!server || !id) return json(res, 400, { error: "missing-params", required: ["server", "id", "engine"] });
  const idParam = engine === "compose" ? "composeId" : `${engine}Id`;
  const r = await dokploy(server, "GET", `${engine}.one?${idParam}=${encodeURIComponent(id)}`);
  if (r && r.__error) return json(res, 502, { error: "fetch-failed", ...r });
  const data = r?.result?.data || r;
  json(res, 200, { server, engine, id, backups: Array.isArray(data?.backups) ? data.backups : [] });
}

/** POST /api/backups/manual  Body: { server, engine, backup_id } */
async function manualBackup(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const server = body?.server;
  const ep = MANUAL[body?.engine];
  const backupId = body?.backup_id;
  if (!server || !ep || !backupId) return json(res, 400, { error: "missing-params", required: ["server", "engine", "backup_id"], engines: Object.keys(MANUAL) });
  const r = await dokploy(server, "POST", ep, { backupId });
  if (r && r.__error) return json(res, 502, { error: "backup-failed", ...r });
  json(res, 200, { ok: true, engine: body.engine, backup_id: backupId });
}

/** GET /api/backups/files?server=&destination_id=&search= */
async function listFiles(req, res) {
  const server = req.query?.server;
  const destinationId = req.query?.destination_id;
  if (!server || !destinationId) return json(res, 400, { error: "missing-params", required: ["server", "destination_id"] });
  const search = req.query?.search ? `&search=${encodeURIComponent(req.query.search)}` : "";
  const r = await dokploy(server, "GET", `backup.listBackupFiles?destinationId=${encodeURIComponent(destinationId)}${search}`);
  if (r && r.__error) return json(res, 502, { error: "fetch-failed", ...r });
  const files = Array.isArray(r) ? r : (r?.result?.data || []);
  json(res, 200, { server, destination_id: destinationId, files });
}

module.exports = {
  "GET /api/destinations": listDestinations,
  "POST /api/destinations": createDestination,
  "POST /api/destinations/:id/test": testDestination,
  "DELETE /api/destinations/:id": removeDestination,
  "GET /api/backups": listBackups,
  "POST /api/backups/manual": manualBackup,
  "GET /api/backups/files": listFiles,
};
