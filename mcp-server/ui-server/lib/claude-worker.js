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
2. Identify env vars the build needs. For each MISSING REQUIRED value, call \`ask-user.sh\` (see "Asking for input" — it BLOCKS until the user answers in the dashboard). Prefer sensible defaults; only ask when a value is genuinely required and cannot be inferred.
3. **Run the "Plan & confirm" gate below — get \`Deploy\` first.** ONLY then: \`update-status.sh deploying\` and do the actual Dokploy tRPC flow per deploy-guide.md (project.create → application.create → saveGithubProvider OR git URL → saveBuildType → saveEnvironment → deploy)
4. \`update-status.sh wait-dns\` then create the Cloudflare DNS A-record with --no-proxy (KI-007) if a domain was given, wait for Let's Encrypt cert
5. \`update-status.sh finalizing\` then verify the app is reachable
6. \`update-status.sh done\` then \`set-result.sh app_id=<dokploy app id> url=https://<final-domain>\`

## Asking for input (STRICT)
- The ONLY channel to ask the user anything is \`ask-user.sh\`. **NEVER use the AskUserQuestion tool** — you run headless with no UI to answer it; it is disabled and will break your session.
- \`ask-user.sh\` is ONLY for **missing required env/config values** discovered during analysis. It is NOT for infrastructure problems, build failures, or "should I continue?" decisions.
- For infrastructure / build / server problems (e.g. the Docker builder hangs, a daemon is unhealthy, a command errors): DO NOT ask the user. Fail cleanly per "On failure" with an actionable message — the human reads the dashboard log and fixes their server, then re-runs.

## Plan & confirm (MANDATORY — before ANY mutating call)
Before you create or change ANYTHING in Dokploy (project.create, application.create, saveBuildType, saveEnvironment, deploy, domain.create, DNS, etc.) you MUST present a plan and get explicit confirmation. This gate is ALWAYS on — never skip it.
1. After detecting the stack and gathering any required env, emit the plan as \`log.sh info\` lines:
   - repo + branch; detected stack + build type + port
   - env keys you will set (NAMES only — never values)
   - domain / DNS change (or "free traefik.me hostname over HTTP")
   - Dokploy resources to be created (project, application)
2. Then ask for confirmation (this BLOCKS until the user clicks in the dashboard):
   \`bash "$HELPERS_DIR/ask-user.sh" confirm_deploy "Deploy this plan?" select "Deploy,Cancel" "Nothing is created until you confirm"\`
3. If the answer is exactly \`Deploy\` → proceed to mutate (step 3 of the lifecycle). For ANY other answer (e.g. \`Cancel\`) → \`log.sh warn "Deploy cancelled by user"\`, \`update-status.sh error\`, \`set-result.sh error="cancelled by user"\`, then STOP — create NOTHING.
Nothing in Dokploy may be created or changed before the gate returns \`Deploy\`.

## Build monitoring
After triggering the Dokploy build, poll the deployment's status with \`deployment.all?applicationId=<id>\` every ~20–30s until the latest deployment is terminal:
- status \`done\` → the build succeeded. Move on: \`update-status.sh wait-dns\` → create DNS if a domain was given → verify the app responds (a SHORT bounded check: a couple of \`curl\`s, don't wait many minutes for the cert) → \`update-status.sh done\` + \`set-result.sh\`.
- status \`error\` → \`log.sh error "Build failed — see Dokploy build log"\` then "On failure".
Heavy builds (e.g. a big monorepo) routinely take 8–12 min — that is NORMAL, keep polling (up to ~25 checks). Do NOT declare failure just because it's slow; only fail on an actual \`error\` status or if you exhaust ~25 polls. Mark the job \`done\` as soon as the deployment reports \`done\` — do not keep monitoring DNS/cert for many minutes (the worker has a hard timeout).

## On failure
If anything fails fatally (including a stuck/timed-out build or an unhealthy server builder):
  \`log.sh error "<actionable details>"\`
  \`update-status.sh error\`
  \`set-result.sh error="<brief reason>"\`
  Then STOP cleanly (let your turn end). Do NOT keep retrying past 2 attempts on any single API call. Do NOT ask the user. Do NOT call AskUserQuestion.

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
  // Hard-disable AskUserQuestion: a headless worker has no UI to answer it,
  // and an attempt corrupted the session (API 400 on thinking blocks) in the
  // first live run. The worker asks the user ONLY via ask-user.sh.
  "--disallowedTools", "AskUserQuestion",
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
const WORKER_TIMEOUT_MS = Number(process.env.WORKER_TIMEOUT_MS || 40 * 60 * 1000);
const killTimer = setTimeout(() => {
  console.error("[claude-worker] timeout reached, killing claude");
  try { child.kill("SIGTERM"); } catch {}
}, WORKER_TIMEOUT_MS);
child.on("exit", () => clearTimeout(killTimer));
