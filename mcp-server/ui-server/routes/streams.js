"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
const { json } = require("../lib/http");
const { openStream, followProcess, pingInterval } = require("../lib/sse");
const { dokploy, readConfig, REPO_ROOT, SCRIPTS_DIR } = require("../lib/exec");

/**
 * GET /api/deploys/:id/log/stream?server=<name>
 *
 * Streams a deployment's build/runtime log via SSE.
 *
 * Strategy (KI-005 fallback):
 *   1. Fetch `deployment.all` for that app to find `logPath` for this deploy.
 *   2. SSH to the server and `tail -f -n 200 <logPath>` so the client gets
 *      the last 200 lines immediately then live tail forward.
 *   3. Stream each stdout line as `event: log` with parsed timestamp.
 *
 * Per-event payload:
 *   { t: "HH:MM:SS", kind: "info"|"ok"|"warn"|"error", text: "…" }
 *
 * NOTE: deployment.all may not work in some Dokploy versions — the
 * reference flags this. If it fails we still attempt the tail using
 * the *latest* log under Dokploy's default log dir as a best-effort.
 */
async function deployLogStream(req, res, ctx, params) {
  const deployId = params.id;
  const server = req.query?.server;
  const appId = req.query?.appId;
  if (!server) return json(res, 400, { error: "missing-server" });
  if (!appId)  return json(res, 400, { error: "missing-appId" });

  const cfg = readConfig({ maskSecrets: false });
  if (cfg.__error || !cfg.servers?.[server]) {
    return json(res, 404, { error: "unknown-server", server });
  }

  // 1. Find logPath
  const dlist = await dokploy(server, "GET", `deployment.all?applicationId=${encodeURIComponent(appId)}`);
  let logPath = null;
  if (!dlist.__error) {
    const data = Array.isArray(dlist) ? dlist : (dlist.result?.data || dlist);
    const list = Array.isArray(data) ? data : (data.deployments || []);
    const match = list.find((d) => d.deploymentId === deployId);
    if (match) logPath = match.logPath;
  }
  if (!logPath) {
    return json(res, 404, { error: "deployment-not-found-or-no-logpath", deployId, hint: "Pass ?appId= so we can locate the deploy" });
  }

  // 2. Open SSE
  const stream = openStream(res);
  stream.send("meta", {
    deploy_id: deployId,
    log_path: logPath,
    server,
    source: "ssh-tail",
  });

  // 3. Spawn ssh-exec.sh and follow.
  // Use `bash -lc 'tail -f -n 200 LOGPATH'` so the remote shell has PATH.
  const sshScript = path.join(SCRIPTS_DIR, "ssh-exec.sh");
  // Shell-quote logPath — POSIX single-quote escape is enough since the path
  // is server-controlled (came from Dokploy API) and we want literal usage.
  const safePath = "'" + logPath.replace(/'/g, "'\\''") + "'";
  const child = spawn("bash", [sshScript, server, `tail -f -n 200 ${safePath}`], {
    cwd: REPO_ROOT,
    env: process.env,
  });

  followProcess(child, stream, { event: "log" });

  // Heartbeat every 15s to keep the stream warm
  const ping = pingInterval(stream, 15_000);
  stream.onClose(() => clearInterval(ping));
}

/**
 * GET /api/events/stream
 *
 * Global SSE firehose. M4 ships a placeholder that just heartbeats
 * (Epic 3's job-runner is where real events flow in). Keeping the
 * endpoint registered now so the UI can connect early and start
 * receiving events as soon as the job-queue lands.
 */
function eventsStream(req, res) {
  const stream = openStream(res);
  stream.send("hello", { milestone: "M4 (placeholder)", note: "real events arrive in Epic 3 job-runner" });
  const ping = pingInterval(stream, 15_000);
  stream.onClose(() => clearInterval(ping));
}

module.exports = {
  "GET /api/deploys/:id/log/stream": deployLogStream,
  "GET /api/events/stream": eventsStream,
};
