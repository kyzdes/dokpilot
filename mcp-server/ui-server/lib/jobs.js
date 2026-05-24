/* lib/jobs.js — deploy job-queue helpers.
   Jobs live as JSON files under ~/.claude/skills/dokpilot/jobs/.
   The skill-side worker (`/dokpilot deploy --job <id>`) is the
   executor — it reads the file, transitions it through states,
   appends log lines, and persists answers. The HTTP server is the
   queue + UI proxy; it never deploys directly.

   File schema (versioned for forward compat):
   {
     schemaVersion: 1,
     id, created_at, updated_at,
     status: "pending|analyzing-stack|awaiting-answers|deploying|wait-dns|finalizing|done|error",
     repo, branch, server, domain,
     steps: [{id, label, status, duration_ms?}],
     questions: [{id, label, type, options?, hint?, required, answer?}],
     log: [{t, kind, text}],
     result: { app_id, url, ... } | null,
     error: string | null,
     worker: { pid, started_at, host } | null,
   }
*/
"use strict";

const fs   = require("node:fs");
const path = require("node:path");
const os   = require("node:os");

const JOBS_DIR = path.join(os.homedir(), ".claude", "skills", "dokpilot", "jobs");

function ensureDir() {
  fs.mkdirSync(JOBS_DIR, { recursive: true, mode: 0o700 });
}

function jobPath(id) {
  // Defensive: id must be `job_<hex>` shape so we can't be tricked into
  // writing outside JOBS_DIR via a path-traversal payload.
  if (!/^job_[a-z0-9_]+$/i.test(id)) {
    throw new Error("invalid job id: " + id);
  }
  return path.join(JOBS_DIR, id + ".json");
}

function newJobId() {
  // 12 hex chars; collision probability is negligible at this scale
  const rnd = require("node:crypto").randomBytes(6).toString("hex");
  return "job_" + rnd;
}

function readJob(id) {
  const p = jobPath(id);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

/** Atomic write via tmp+rename so readers never see a half-written file. */
function writeJob(job) {
  ensureDir();
  job.updated_at = new Date().toISOString();
  const p = jobPath(job.id);
  const tmp = p + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
  return job;
}

function listJobs() {
  ensureDir();
  return fs.readdirSync(JOBS_DIR)
    .filter((f) => /^job_[a-z0-9_]+\.json$/.test(f))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), "utf8")); }
      catch { return null; }
    })
    .filter(Boolean);
}

function createJob({ repo, server, branch = "main", domain = null }) {
  ensureDir();
  const id = newJobId();
  const now = new Date().toISOString();
  const job = {
    schemaVersion: 1,
    id,
    created_at: now,
    updated_at: now,
    status: "pending",
    repo, branch, server, domain,
    steps: [
      { id: "detect",    label: "Detect stack",   status: "pending" },
      { id: "questions", label: "Await answers",  status: "pending" },
      { id: "deploy",    label: "Deploying",      status: "pending" },
      { id: "dns",       label: "DNS + SSL",      status: "pending" },
      { id: "finalize",  label: "Finalize",       status: "pending" },
    ],
    questions: [],
    log: [{ t: now.slice(11, 19), kind: "info", text: "Job created. Waiting for worker to pick up." }],
    result: null,
    error: null,
    worker: null,
  };
  writeJob(job);
  return job;
}

function patchJob(id, mutator) {
  const job = readJob(id);
  if (!job) return null;
  mutator(job);
  return writeJob(job);
}

function answerQuestion(id, questionId, answer) {
  return patchJob(id, (job) => {
    const q = (job.questions || []).find((x) => x.id === questionId);
    if (!q) return;
    q.answer = answer;
    job.log = job.log || [];
    job.log.push({
      t: new Date().toTimeString().slice(0, 8),
      kind: "info",
      text: `User answered ${q.label}: ${typeof answer === "string" ? answer : JSON.stringify(answer)}`,
    });
    // If all required answers present, flip status so worker can resume
    const pendingReq = (job.questions || []).filter((q) => q.required && (q.answer == null || q.answer === ""));
    if (pendingReq.length === 0 && job.status === "awaiting-answers") {
      job.status = "deploying";
      const step = job.steps?.find((s) => s.id === "questions");
      if (step) step.status = "done";
      const next = job.steps?.find((s) => s.id === "deploy");
      if (next) next.status = "active";
    }
  });
}

module.exports = {
  JOBS_DIR,
  jobPath,
  newJobId,
  readJob,
  writeJob,
  listJobs,
  createJob,
  patchJob,
  answerQuestion,
};
