"use strict";
/* routes/onboarding.js — first-deploy onboarding helpers (v4.2 CJM).

   - POST /api/onboarding/scan-repo      classify a GitHub repo (public /
                                         private-or-missing) + a stack hint.
   - POST /api/onboarding/detect-dokploy SSH-probe whether Dokploy is on a
                                         configured server.
   - POST /api/onboarding/install-dokploy create an install job (streamed via
                                         the existing /api/jobs/:id/stream) that
                                         runs the official Dokploy installer
                                         over SSH. Destructive — strong-confirm
                                         in the UI; live-mode only.

   Full stack detection + the deploy itself stay in the Claude deploy worker;
   scan-repo is only the cheap pre-flight that powers the wizard's Stage 2.
*/
const https = require("node:https");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { json } = require("../lib/http");
const csrf = require("../lib/csrf");
const { run, sshExec, readConfig, SCRIPTS_DIR, REPO_ROOT } = require("../lib/exec");
const { writeJob, newJobId, readJob } = require("../lib/jobs");

function readBody(req, max = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let len = 0;
    req.on("data", (c) => { len += c.length; if (len > max) { reject(Object.assign(new Error("body too large"), { code: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => { const b = Buffer.concat(chunks).toString("utf8"); if (!b) return resolve(null); try { resolve(JSON.parse(b)); } catch (e) { reject(Object.assign(new Error("invalid json"), { code: 400 })); } });
    req.on("error", reject);
  });
}

/** Normalize many GitHub URL forms → { owner, repo } | null. */
function parseGithub(url) {
  if (!url || typeof url !== "string") return null;
  let s = url.trim().replace(/\.git$/, "");
  s = s.replace(/^git@github\.com:/, "github.com/");
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const m = s.match(/^github\.com\/([^/\s]+)\/([^/\s?#]+)/i) || s.match(/^([^/\s]+)\/([^/\s?#]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function ghApi(owner, repo) {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname: "api.github.com", path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        method: "GET", headers: { "User-Agent": "dokpilot-onboarding", "Accept": "application/vnd.github+json" }, timeout: 8000 },
      (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, json: j }); }); }
    );
    req.on("error", () => resolve({ status: 0 }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0 }); });
    req.end();
  });
}

/**
 * POST /api/onboarding/scan-repo  Body: { url }
 *   { ok, visibility:"public"|"private-or-missing"|"unknown", stack_hint?,
 *     default_branch?, owner, repo, normalized, reason? }
 */
async function scanRepo(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const gh = parseGithub(body?.url);
  if (!gh) return json(res, 400, { ok: false, error: "bad-url", reason: "That doesn't look like a GitHub repo URL. Try github.com/owner/repo." });
  const normalized = `github.com/${gh.owner}/${gh.repo}`;

  const api = await ghApi(gh.owner, gh.repo);
  if (api.status === 200 && api.json) {
    return json(res, 200, {
      ok: true, visibility: "public", owner: gh.owner, repo: gh.repo, normalized,
      stack_hint: api.json.language || null,
      default_branch: api.json.default_branch || "main",
      description: api.json.description || null,
    });
  }
  if (api.status === 404) {
    return json(res, 200, {
      ok: false, visibility: "private-or-missing", owner: gh.owner, repo: gh.repo, normalized,
      reason: "This repo is private or doesn't exist. If it's private, that's fine — we'll use your GitHub access on the server during deploy. If the URL is wrong, fix it and rescan.",
    });
  }
  // 403 (rate limit) or network → fall back to an unauthenticated git probe.
  const g = await run("git", ["ls-remote", "--heads", `https://github.com/${gh.owner}/${gh.repo}`], { timeout: 8000, env: { GIT_TERMINAL_PROMPT: "0" } });
  if (g.code === 0) {
    return json(res, 200, { ok: true, visibility: "public", owner: gh.owner, repo: gh.repo, normalized, stack_hint: null, default_branch: "main", note: "verified via git (GitHub API unavailable)" });
  }
  return json(res, 200, { ok: false, visibility: "private-or-missing", owner: gh.owner, repo: gh.repo, normalized,
    reason: "Couldn't read this repo without credentials — it's private or doesn't exist. Private repos deploy fine using your GitHub access on the server." });
}

/**
 * POST /api/onboarding/detect-dokploy  Body: { server }
 *   { installed, detail } — SSH probe (docker container / port 3000).
 */
async function detectDokploy(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const server = body?.server;
  if (!server) return json(res, 400, { error: "missing-server" });
  const cfg = readConfig({ maskSecrets: false });
  if (cfg.__error || !cfg.servers?.[server]) return json(res, 404, { error: "unknown-server" });

  // One round-trip probe: container named *dokploy*, or something on :3000.
  const probe = [
    "docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -i dokploy | head -1",
    "(curl -s -o /dev/null -w 'http_%{http_code}' --max-time 4 http://127.0.0.1:3000 2>/dev/null || true)",
  ].join(" ; echo '---' ; ");
  const r = await sshExec(server, probe);
  if (r.__error) return json(res, 200, { installed: false, detail: "ssh probe failed: " + (r.stderr || "").slice(0, 160) });
  const [containerLine = "", portLine = ""] = String(r.stdout).split("---").map((s) => s.trim());
  const installed = /dokploy/i.test(containerLine) || /http_(200|30\d|401|403)/.test(portLine);
  json(res, 200, { installed, detail: containerLine || portLine || "no Dokploy signs found" });
}

/**
 * POST /api/onboarding/install-dokploy  Body: { server }
 *   Creates an install job and spawns the streamer. Returns { job_id }.
 *   Watch progress via GET /api/jobs/:id/stream (existing SSE).
 *   DESTRUCTIVE — runs the official Dokploy installer on the host.
 */
async function installDokploy(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const server = body?.server;
  if (!server) return json(res, 400, { error: "missing-server" });
  const cfg = readConfig({ maskSecrets: false });
  if (cfg.__error || !cfg.servers?.[server]) return json(res, 404, { error: "unknown-server" });

  const id = newJobId();
  const now = new Date().toISOString();
  writeJob({
    schemaVersion: 1, id, created_at: now, updated_at: now,
    status: "installing", kind: "dokploy-install", server,
    repo: null, branch: null, domain: null,
    steps: [{ id: "install", label: "Install Dokploy", status: "active" }],
    questions: [],
    log: [{ t: new Date().toTimeString().slice(0, 8), kind: "info", text: `Installing Dokploy on ${server} via SSH…` }],
    result: null, error: null, worker: null,
  });

  const child = spawn("node", [path.join(__dirname, "..", "lib", "install-worker.js"), id, server], {
    cwd: REPO_ROOT, env: process.env, detached: true, stdio: "ignore",
  });
  child.unref();

  json(res, 201, { job_id: id, stream: `/api/jobs/${id}/stream` });
}

module.exports = {
  "POST /api/onboarding/scan-repo": scanRepo,
  "POST /api/onboarding/detect-dokploy": detectDokploy,
  "POST /api/onboarding/install-dokploy": installDokploy,
};
