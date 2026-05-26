#!/usr/bin/env node
/* lib/install-worker.js — streams a remote Dokploy install into a job file.

   Spawned detached by routes/onboarding.js::installDokploy as:
     node install-worker.js <jobId> <server>
   Runs `scripts/dokploy-install.sh <server>` (which SSHes in and runs the
   official Dokploy installer), appends each output line to the job's log
   via patchJob, and flips status to done|error on exit. The dashboard tails
   the job through the existing GET /api/jobs/:id/stream SSE.
*/
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const { patchJob, readJob } = require("./jobs");
const { SCRIPTS_DIR, REPO_ROOT } = require("./exec");

const jobId = process.argv[2];
const server = process.argv[3];
if (!jobId || !server) { console.error("usage: install-worker.js <jobId> <server>"); process.exit(2); }

const now = () => new Date().toTimeString().slice(0, 8);
const append = (kind, text) => patchJob(jobId, (j) => { (j.log = j.log || []).push({ t: now(), kind, text }); });

function lineKind(text) {
  if (/^(✕|✗|\[err\]|error|fatal|failed)/i.test(text)) return "error";
  if (/^(⚠|warn|warning)/i.test(text)) return "warn";
  if (/^(✓|\[ok\]|success|done|installed|complete)/i.test(text)) return "ok";
  return "info";
}

function pump(stream, fallbackKind) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const raw = buf.slice(0, nl).replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
      buf = buf.slice(nl + 1);
      if (raw) append(fallbackKind === "warn" ? (lineKind(raw) === "info" ? "warn" : lineKind(raw)) : lineKind(raw), raw);
    }
  });
}

const child = spawn("bash", [path.join(SCRIPTS_DIR, "dokploy-install.sh"), server], { cwd: REPO_ROOT, env: process.env });
pump(child.stdout, "info");
pump(child.stderr, "warn");

const timeout = setTimeout(() => { append("error", "Install timed out after 12 min — check the server manually."); try { child.kill("SIGTERM"); } catch {} }, 12 * 60 * 1000);

child.on("exit", (code) => {
  clearTimeout(timeout);
  patchJob(jobId, (j) => {
    const step = j.steps?.find((s) => s.id === "install");
    if (code === 0) {
      j.status = "done";
      if (step) step.status = "done";
      j.result = { installed: true, server };
      (j.log = j.log || []).push({ t: now(), kind: "ok", text: `Dokploy installed on ${server}. Open http://<server-ip>:3000 to create your admin user + API key.` });
    } else {
      j.status = "error";
      if (step) step.status = "error";
      j.error = "Dokploy installer exited with code " + code;
      (j.log = j.log || []).push({ t: now(), kind: "error", text: j.error });
    }
  });
  process.exit(0);
});

child.on("error", (err) => {
  clearTimeout(timeout);
  patchJob(jobId, (j) => { j.status = "error"; j.error = String(err.message || err); (j.log = j.log || []).push({ t: now(), kind: "error", text: j.error }); });
  process.exit(1);
});
