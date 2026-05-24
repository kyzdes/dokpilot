"use strict";
const fs   = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { json } = require("../lib/http");
const { openStream, pingInterval } = require("../lib/sse");
const csrf = require("../lib/csrf");
const {
  JOBS_DIR, jobPath, readJob, createJob, answerQuestion, listJobs,
} = require("../lib/jobs");
const { listServerNames } = require("../lib/exec");

/* Choose worker:
   - DOKPILOT_WORKER=mock  → lib/mock-worker.js (deterministic demo loop, no
                              Claude required, doesn't actually deploy)
   - DOKPILOT_WORKER=claude → lib/claude-worker.js (default: spawns real
                              Claude with deploy-guide + helpers; does an
                              actual deploy)
   Both are detached + unref'd so the ui-server can restart without
   killing in-flight workers. */
function spawnWorker(id) {
  const which = process.env.DOKPILOT_WORKER || "claude";
  const file = which === "mock" ? "mock-worker.js" : "claude-worker.js";
  const workerPath = path.join(__dirname, "..", "lib", file);
  const child = spawn(process.execPath, [workerPath, id], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

/** Read the JSON body of a request (with 64KB cap). */
function readBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on("data", (c) => {
      length += c.length;
      if (length > max) {
        reject(Object.assign(new Error("body too large"), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const buf = Buffer.concat(chunks).toString("utf8");
      if (!buf) return resolve(null);
      try { resolve(JSON.parse(buf)); }
      catch (e) { reject(Object.assign(new Error("invalid json: " + e.message), { code: 400 })); }
    });
    req.on("error", reject);
  });
}

/* GET /api/jobs — list all jobs (read-only) */
function listAll(req, res) {
  const jobs = listJobs().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  json(res, 200, {
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      repo: j.repo,
      server: j.server,
      branch: j.branch,
      domain: j.domain,
      created_at: j.created_at,
      updated_at: j.updated_at,
      result: j.result,
    })),
    count: jobs.length,
  });
}

/* POST /api/jobs/deploy — create a new deploy job */
async function createDeploy(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });

  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, e.code || 400, { error: e.message }); }
  if (!body || typeof body !== "object") return json(res, 400, { error: "missing-body" });

  const { repo, server, branch, domain } = body;
  if (!repo || typeof repo !== "string") return json(res, 400, { error: "missing-repo" });

  // Sanity check: server must be configured
  const known = listServerNames();
  if (!server || !known.includes(server)) {
    return json(res, 400, { error: "unknown-server", known });
  }

  // Normalize repo — accept "github.com/owner/repo" or full URL
  let repoNorm = repo.trim();
  if (repoNorm.startsWith("https://")) repoNorm = repoNorm.replace(/^https?:\/\//, "");
  if (repoNorm.endsWith(".git")) repoNorm = repoNorm.slice(0, -4);
  if (!/^github\.com\/[^/]+\/[^/]+/.test(repoNorm)) {
    return json(res, 400, { error: "invalid-repo", hint: "format: github.com/owner/name" });
  }

  const job = createJob({
    repo: repoNorm,
    server,
    branch: branch || "main",
    domain: domain || null,
  });

  // Kick the worker. Default: claude-worker (real). Override with
  // DOKPILOT_WORKER=mock to use the deterministic demo loop.
  try { spawnWorker(job.id); } catch (e) {
    console.error("[ui] worker spawn failed:", e);
  }

  json(res, 201, { id: job.id, job });
}

/* GET /api/jobs/:id — current state */
function getJob(req, res, ctx, params) {
  const job = readJob(params.id);
  if (!job) return json(res, 404, { error: "not-found", id: params.id });
  json(res, 200, { job });
}

/* POST /api/jobs/:id/answer — submit a question answer */
async function postAnswer(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, e.code || 400, { error: e.message }); }
  if (!body?.questionId || body.answer === undefined) {
    return json(res, 400, { error: "missing-questionId-or-answer" });
  }
  const job = answerQuestion(params.id, body.questionId, body.answer);
  if (!job) return json(res, 404, { error: "not-found", id: params.id });
  json(res, 200, { job });
}

/* GET /api/jobs/:id/stream — SSE: emit current job, then re-emit on
   every fs.watch change. Auto-close when status reaches done/error. */
function streamJob(req, res, ctx, params) {
  const id = params.id;
  const p = jobPath(id);
  const stream = openStream(res);

  const emit = () => {
    const j = readJob(id);
    if (!j) {
      stream.send("not-found", { id });
      stream.close("not-found");
      return;
    }
    stream.send("job", j);
    if (j.status === "done" || j.status === "error") {
      // Give the client a moment to render the final state before
      // closing — but they can also keep the stream open to display
      // post-deploy events.
      setTimeout(() => stream.close("terminal"), 500);
    }
  };

  // Initial emit
  emit();

  // fs.watch is debounced via a tiny tail-latch. POSIX may double-fire.
  let pending = null;
  let watcher = null;
  try {
    watcher = fs.watch(JOBS_DIR, (ev, fname) => {
      if (fname !== path.basename(p)) return;
      clearTimeout(pending);
      pending = setTimeout(emit, 50);
    });
  } catch (e) {
    stream.send("warn", { message: "fs.watch unavailable; polling fallback at 2s" });
    const poll = setInterval(emit, 2000);
    stream.onClose(() => clearInterval(poll));
  }

  const ping = pingInterval(stream, 15_000);
  stream.onClose(() => {
    clearInterval(ping);
    clearTimeout(pending);
    try { watcher && watcher.close(); } catch {}
  });
}

/* GET /api/csrf — return the CSRF token (same as bearer; bearer-authed
   so unauthenticated callers can't fish for it). */
function getCsrf(req, res, ctx) {
  json(res, 200, { token: ctx.token });
}

module.exports = {
  "GET /api/csrf":             getCsrf,
  "GET /api/jobs":             listAll,
  "POST /api/jobs/deploy":     createDeploy,
  "GET /api/jobs/:id":         getJob,
  "POST /api/jobs/:id/answer": postAnswer,
  "GET /api/jobs/:id/stream":  streamJob,
};
