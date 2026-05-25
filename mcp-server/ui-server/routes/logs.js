"use strict";
/* routes/logs.js — container runtime logs (KYZ-101).

   Build/deploy logs are already streamed by routes/streams.js
   (/api/deploys/:id/log/stream, SSH tail of the deployment logPath).
   This module adds the *runtime* container logs of a running app/compose
   via Dokploy's readLogs queries.

   Dokploy contract (verified live against v0.29.5):
     GET application.readLogs?applicationId=<id>&tail=<n>
     GET compose.readLogs?composeId=<id>&tail=<n>[&containerId=<c>]
   Both return the log as a single JSON-encoded string with "\n"
   separators and a leading RFC3339 timestamp per line, e.g.
     2026-05-25T12:23:12.601Z 127.0.0.1 - - [..] "GET / HTTP/1.1" 200 ..
*/
const { json } = require("../lib/http");
const { dokploy } = require("../lib/exec");

const clampTail = (v) => {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.min(2000, n));
};

/** Split a raw log blob into structured lines, lifting the leading
 *  RFC3339 timestamp into HH:MM:SS and tagging error/warn lines. */
function parseLogLines(blob) {
  const out = [];
  for (const raw of String(blob).split("\n")) {
    if (!raw) continue;
    let t = null, text = raw;
    const m = raw.match(/^(\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?)\s+(.*)$/);
    if (m) { t = m[2]; text = m[3]; }
    let kind = "info";
    if (/\b(error|err|exception|fatal|panic)\b/i.test(text)) kind = "error";
    else if (/\b(warn|warning|deprecated)\b/i.test(text)) kind = "warn";
    else if (/\b(\s5\d\d\s)\b/.test(text)) kind = "error";
    out.push({ t, kind, text });
  }
  return out;
}

/**
 * GET /api/apps/:id/logs?server=<name>&kind=application|compose&tail=N
 *   Runtime container logs for an app/compose, newest last.
 */
async function appLogs(req, res, ctx, params) {
  const server = req.query?.server || params.server;
  const kind = req.query?.kind === "compose" ? "compose" : "application";
  const tail = clampTail(req.query?.tail);
  const id = params.id;
  if (!server) return json(res, 400, { error: "missing-server", message: "?server=<name> required" });

  const idParam = kind === "compose" ? "composeId" : "applicationId";
  const ep = `${kind}.readLogs?${idParam}=${encodeURIComponent(id)}&tail=${tail}`;
  const r = await dokploy(server, "GET", ep);
  if (r && r.__error) {
    return json(res, 502, { error: "logs-failed", kind, ...r });
  }
  // readLogs returns a JSON string; dokploy() already JSON-parsed it.
  const blob = typeof r === "string" ? r : (r?.logs || r?.text || "");
  const lines = parseLogLines(blob);
  json(res, 200, { id, kind, server, tail, count: lines.length, lines });
}

module.exports = {
  "GET /api/apps/:id/logs": appLogs,
};
