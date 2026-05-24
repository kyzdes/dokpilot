#!/usr/bin/env node
/* claude-worker.js — REAL deploy worker driven by the local `claude` CLI.
   Replaces lib/mock-worker.js as the default executor for /api/jobs/deploy.

   Spawns Claude with:
     - The job spec via env JOB_PATH (absolute path to ~/.claude/skills/dokpilot/jobs/<id>.json)
     - Helper-script directory via env HELPERS_DIR (absolute path to lib/worker-helpers/)
     - A focused system prompt that tells Claude:
       1. You are a deploy worker
       2. Read deploy-guide.md + stack-detection.md from references/
       3. Use the existing skill scripts (dokploy-api.sh, cloudflare-dns.sh) to do the work
       4. Use the four worker helpers (update-status, log, ask-user, set-result) to
          surface progress + ask the user for input
       5. The lifecycle: pending → analyzing-stack → awaiting-answers
          → deploying → wait-dns → finalizing → done|error

   On Claude's exit, we check the final status. If it's not a terminal
   state, we patch it to error (so the UI doesn't hang forever).

   Claude's raw stream-json is mirrored to a per-job claude.log file
   under ~/.claude/skills/dokpilot/jobs/<id>.claude.log for debugging;
   it is never streamed to the UI directly (the UI only sees what the
   helpers append via log.sh).
*/
"use strict";

const fs   = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { readJob, writeJob, jobPath } = require("./jobs");

const id = process.argv[2];
if (!id) { console.error("usage: claude-worker.js <job-id>"); process.exit(2); }

const JOB_FILE   = jobPath(id);
const HELPERS_DIR = path.resolve(__dirname, "worker-helpers");
const REPO_ROOT   = path.resolve(__dirname, "..", "..", "..");
const CLAUDE_LOG  = JOB_FILE.replace(/\.json$/, ".claude.log");

const job = readJob(id);
if (!job) { console.error("job not found:", id); process.exit(2); }

// Pre-flight: mark worker started so the UI knows Claude is in the loop
job.worker = { pid: process.pid, started_at: new Date().toISOString(), host: "claude", helpers_dir: HELPERS_DIR };
writeJob(job);

/* ─── system prompt ───────────────────────────────────────────────── */
const systemPrompt = `
You are the Dokpilot deploy worker. Your job: deploy the GitHub repo described in JOB_PATH to a Dokploy server.

## Job spec
The full spec is at \`$JOB_PATH\`. Read it FIRST with:
  cat "$JOB_PATH" | jq .

Key fields: \`repo\` (github.com/owner/name), \`branch\`, \`server\` (name in config/servers.json), \`domain\` (optional, may be null).

## Worker helpers
These bash scripts are in \`$HELPERS_DIR\`. Invoke each via \`bash "$HELPERS_DIR/<name>.sh" <args>\`. They patch the job file atomically — JOB_PATH is set in your environment, they pick it up automatically.

- \`update-status.sh <state>\` — transitions: analyzing-stack | awaiting-answers | deploying | wait-dns | finalizing | done | error. Call this BETWEEN major phases so the UI stepper advances.
- \`log.sh <kind> "<message>"\` — kind: info | ok | warn | error. Use ok for successes, warn for things that need attention, error for failures. Keep messages SHORT (≤80 chars) — they show up in the dashboard log viewer.
- \`ask-user.sh <id> "<label>" <type> "<extra>" "<hint>"\` — type: text or select. For text, <extra> is the placeholder. For select, <extra> is a comma-separated options list. BLOCKS until the user answers in the dashboard. Prints the answer to stdout.
- \`set-result.sh key=value [key=value ...]\` — usually called once at the end with: \`app_id=<id> url=https://<host> server=<name>\`.

## Deploy flow
Read these references before deciding what to do:
- \`skills/dokpilot/references/deploy-guide.md\` — the 31-step Dokploy tRPC flow
- \`skills/dokpilot/references/stack-detection.md\` — how to detect Next.js / Astro / FastAPI / etc
- \`skills/dokpilot/references/github-app-autodeploy.md\` — KI-009: never suggest webhooks
- \`skills/dokpilot/references/dokploy-api-reference.md\` — endpoint signatures

For deploy operations, use the existing skill scripts (do NOT reimplement):
- \`bash skills/dokpilot/scripts/dokploy-api.sh <server> GET|POST <endpoint> [body]\`
- \`bash skills/dokpilot/scripts/cloudflare-dns.sh create <host> <ip> --no-proxy\`
- \`bash skills/dokpilot/scripts/ssh-exec.sh <server> "<cmd>"\`

## Required lifecycle steps
1. \`update-status.sh analyzing-stack\` then clone the repo, detect the stack, log findings via \`log.sh ok ...\`
2. Identify env vars the build needs. For each MISSING required value, call \`ask-user.sh\` — IT BLOCKS until the user fills it in via the dashboard. Once you have all answers, continue.
3. \`update-status.sh deploying\` then do the actual Dokploy tRPC flow per deploy-guide.md (project.create → application.create → saveGithubProvider OR git URL → saveBuildType → saveEnvironment → deploy)
4. \`update-status.sh wait-dns\` then create the Cloudflare DNS A-record with --no-proxy (KI-007) if a domain was given, wait for Let's Encrypt cert
5. \`update-status.sh finalizing\` then verify the app is reachable
6. \`update-status.sh done\` then \`set-result.sh app_id=<dokploy app id> url=https://<final-domain>\`

## On failure
If anything fails fatally:
  \`update-status.sh error\`
  \`set-result.sh error="<brief reason>"\`
  \`log.sh error "<details>"\`
  Then stop. Do NOT keep retrying past 2 attempts on any single API call.

## Tone
You are an operator, not a chatbot. Skip pleasantries. Don't narrate your reasoning to the user — call \`log.sh\` only for meaningful state changes. Keep your assistant text minimal; the dashboard log is the user-facing channel.

Begin now: read \`$JOB_PATH\` first.
`.trim();

/* ─── spawn claude ────────────────────────────────────────────────── */
const claudeLogStream = fs.createWriteStream(CLAUDE_LOG, { flags: "a" });
claudeLogStream.write(`\n--- worker start ${new Date().toISOString()} pid=${process.pid} ---\n`);

const args = [
  "-p", "Begin the deploy.",
  "--output-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--append-system-prompt", systemPrompt,
  "--add-dir", REPO_ROOT,
  "--add-dir", HELPERS_DIR,
];

const env = {
  ...process.env,
  JOB_PATH:    JOB_FILE,
  HELPERS_DIR: HELPERS_DIR,
};

const child = spawn("claude", args, {
  cwd: REPO_ROOT,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

// Mirror stream-json + stderr into the per-job claude.log for debugging
child.stdout.on("data", (c) => claudeLogStream.write(c));
child.stderr.on("data", (c) => claudeLogStream.write(c));

/* ─── safety net ──────────────────────────────────────────────────── */
// If claude exits without setting a terminal state, mark error so the UI doesn't hang
child.on("exit", (code, signal) => {
  claudeLogStream.write(`--- worker exit code=${code} signal=${signal} ---\n`);
  claudeLogStream.end();

  const final = readJob(id);
  if (final && final.status !== "done" && final.status !== "error") {
    final.status = "error";
    final.error = `Claude exited (code ${code}${signal ? ", signal " + signal : ""}) before reaching a terminal state. Check ${path.basename(CLAUDE_LOG)} for details.`;
    final.log = final.log || [];
    final.log.push({
      t: new Date().toTimeString().slice(0, 8),
      kind: "error",
      text: final.error,
    });
    writeJob(final);
  }
  process.exit(code || 0);
});

child.on("error", (err) => {
  console.error("[claude-worker] spawn error:", err);
  const final = readJob(id);
  if (final) {
    final.status = "error";
    final.error = "Failed to spawn claude: " + err.message;
    final.log = final.log || [];
    final.log.push({ t: new Date().toTimeString().slice(0, 8), kind: "error", text: final.error });
    writeJob(final);
  }
  process.exit(1);
});

// Optional: timeout fallback — kill the worker if it runs > 20 minutes
const WORKER_TIMEOUT_MS = Number(process.env.WORKER_TIMEOUT_MS || 20 * 60 * 1000);
const killTimer = setTimeout(() => {
  console.error("[claude-worker] timeout reached, killing claude");
  try { child.kill("SIGTERM"); } catch {}
}, WORKER_TIMEOUT_MS);
child.on("exit", () => clearTimeout(killTimer));
