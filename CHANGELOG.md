# Changelog

All notable changes to Dokpilot are documented in this file.

---

## v4.3.0 — 2026-05-30

Hardening + deploy reliability. First real e2e deploys ran and exposed that
several M1/M2 write paths shipped as "Done" had never actually been
exercised against a real Dokploy v0.29+ server. This release fixes them.

### Added — Safety + recovery

- **Plan-then-confirm gate (H1)** — worker now always emits a plan and blocks
  on `ask-user.sh confirm "Deploy this plan?"` before any mutating Dokploy
  call. Cancel → no resources created.
- **Cost-guard (KYZ-239 A)** — worker parses `total_cost_usd` from the
  Claude stream-json `result` and persists `job.cost_usd`. Done/error cards
  show "≈$X Claude usage (on your plan)". The cost is a subscription
  usage gauge, not per-deploy billing.
- **Retry/recovery (KYZ-239 B)** — failed and cancelled deploy cards have a
  **Retry** button that re-runs the same `{repo, branch, domain, server}`
  as a fresh job. Also fixed a bug where `startLiveDeploy` cleared the form
  *before* reading `#deploy-branch`/`#deploy-domain`, silently dropping
  custom branch/domain on the live path.
- **Delete app + project (H3)** — `POST /api/apps/:id/delete` +
  `POST /api/projects/:id/delete` (was previously CLI-only).

### Added — Onboarding + tooling

- **`dokpilot-ui/assets/deploy-flow.js`** — shared live-deploy plumbing
  (`window.DokFlow.{logLine, subscribeJob, postAnswers}`); `deploy.html` and
  `onboarding.html` both route through it. New `onCost` hook delivers the
  trailing cost write to terminal cards.
- **Functional CI** — `node --check` on every ui-server JS + every inline
  `<script>` (`scripts/check-inline-scripts.sh`), `shellcheck`, and
  `smoke.js --ci` mode. Added `server.js --no-state` so CI doesn't clobber
  the launcher's `.ui-url`.

### Fixed — Dokploy v0.29+ drift (the "shared providers" field-expansion family)

- **G-016** — GitHub App id is nested at `.github.githubId` (top-level is
  null). `saveGithubProvider` 500'd on every GitHub-App deploy. All 3
  reference jq snippets now read nested-first with a top-level fallback.
- **KI-023** — `application.reload` requires `appName` (KYZ-104 graceful
  restart). Dedicated `reloadApp()` fetches `application.one` for `appName`
  first.
- **KI-022** — Many Dokploy mutations ack with an empty body on success
  (`application.redeploy`, `killBuild`, `cleanQueues`, `application.deploy`).
  `dokploy()` was JSON-parsing the empty string and reporting a spurious
  `__error: non-json response`. Empty stdout on `code=0` is now treated as
  `{ ok: true }`. Single fix unblocked redeploy / kill-build (KYZ-102) /
  clean-queue.
- **KI-013 buildkit** — resolved on `main` via `docker builder prune -af`
  (2.4 GB stuck cache; zero downtime, no daemon restart).
- **KI-014 worker AskUserQuestion** — `--disallowedTools AskUserQuestion`
  + prompt rule. Worker now asks only via `ask-user.sh`.
- **KI-016 worker timeout** — `WORKER_TIMEOUT_MS` 20 → 40 min; the prompt
  polls `deployment.all` to a terminal state and marks `done` promptly.
- **KI-018 ask-user.sh jq precedence** — `(... | map(...)) + [$q]`.
- **KI-019 worker permission-mode** — `--permission-mode bypassPermissions`.
- **KI-020 worker lingered ~65 s after `done`** writing a summary + editing
  notes. Prompt rule **STOP after `set-result`**: end the turn the instant
  `set-result` returns. Faster cost capture + less usage.

### Fixed — Cost-delivery race

- `routes/jobs.js` holds the job SSE stream open until `cost_usd` lands or
  an 8 s grace cap, instead of closing 500 ms after terminal.
- `subscribeJob` fires `onDone`/`onError` once and then keeps listening for
  the trailing `cost_usd`; pages re-render the terminal card via `onCost`.
- Bounded fallback poll (≤13 GETs over ~65 s) in case the SSE closes
  before the worker process exits.

### Verified live

- Next.js (nixpacks) `dokpilot-landing`, Python/Flask (Dockerfile)
  `pen-slides-converter`, static `keeper-ui` — all GREEN end-to-end.
  `md2pdf`'s 1-service compose correctly degraded to a Dockerfile deploy
  and surfaced a clean actionable error on a real repo bug (`markdown==3.7.1`
  not on PyPI), exercising the error card + Retry + cost-on-error.
- Every M2 destructive write exercised live against a throwaway: stop,
  restart, reload, redeploy, kill-build, clean-queue, delete (app +
  project), domain.create, domain.delete, rollbacks list (correctly
  reports `rollback_active:false` — no registry).

### Deferred

- **KYZ-245** — multi-service docker-compose (the **Dokploy Compose API**
  path) was never exercised; the one compose repo tried was a 1-service
  wrapper. Needs a self-contained multi-service repo.
- **G-017** — `application.cancelDeployment` is cloud-only on Dokploy.
  Self-hosted UI button should be hidden.
- **G-018** — `application.saveBuildType` now requires `railpackVersion`;
  `application.deploy` rejects null `title`/`description`. Reference
  snippets need a sweep.

## v4.2.0 — 2026-05-28

### Added — Guided first-deploy onboarding (CJM)

- **`dokpilot-ui/onboarding.html`** — staged simple-mode wizard: paste GitHub URL → scan → add/pick server (manual host/SSH-user/SSH-key-path or existing) → Dokploy (detect · keep+API-key / reinstall / guided auto-install with streamed logs) → domain-or-URL (optional Cloudflare) → big green Deploy → live log stream → "your app is live" + link. "Get started" nav entry; first-run hero routing when no servers exist.
- **`routes/onboarding.js`** — `scan-repo` (GitHub API public/private/missing classify + stack hint, `git ls-remote` fallback), `detect-dokploy` (SSH probe), `install-dokploy` (job + `lib/install-worker.js` streaming `scripts/dokploy-install.sh` over SSH). The Dokploy API key is still minted by the user in Dokploy's own first-run UI.

### Changed — Design system

- Reconciled `dokpilot-ui/assets/app.css` toward keys-keeper's structure (muted status palette, `--border-strong`, `--shadow-md`, density vars) while **keeping the neon-green accent**. All status colours flow through tokens.

### Added — keys-keeper integration contract

- `references/keys-keeper-integration-contract.md` — spec for a future keys-keeper handshake (serve `--json` discovery, `X-Keys-Client` identity + verified registry, consent prompt, scoped reveal with verified audit). Dokpilot will store `{_keykeeper}` references, never raw values. keys-keeper side is built separately.

## v4.1.0 — 2026-05-25

### Added — Self-test harness

- `window.__DOK_PROBE__()` page-state probe + `mcp-server/ui-server/smoke.js` boot/endpoint smoke test.

### Added — Operator dashboard (Dokploy API coverage, KYZ-99…109)

- **Logs** — container/build log viewer with live tail (`application/compose.readLogs`).
- **Deploy queue** — `deployment.queueList` + kill-build / cancel / clean-queue.
- **Overview** — home rollup from `project.homeStats`.
- **Lifecycle** — `application.reload` + `compose.redeploy`.
- **Rollback** — one-click rollback to a prior image (`rollback.rollback`).
- **Docker containers** — per-server list + restart/stop/kill/remove (`docker.*`).
- **Backups** — S3 destinations CRUD + manual backups + `backups.html` page.
- **Domains** — update/delete/validate-DNS/generate (full CRUD over `domain.*`).
- **Notifications** — Telegram channel add/test/delete; channel tokens sanitised out of API responses.

### Added — Server management UI

- Add/edit/remove servers + SSH-key registry from the dashboard (`routes/servers-manage.js`, `lib/config-write.js`); API keys → Keychain, SSH keys path-only.

### Fixed

- Resource meter accuracy (vmstat-based CPU), deploy history pulled from Dokploy, false "Needs attention" card on a healthy fleet.

## v4.0.0 — 2026-05-24

### Renamed

- **Plugin slug:** `vps-ninja` → `dokpilot`. Repo: `kyzdes/vps-ninja` → `kyzdes/dokpilot` (landing repo similarly).
- **Skill slug:** `vps` → `dokpilot`. Command prefix `/vps …` → `/dokpilot …`. Install path `~/.claude/skills/vps/` → `~/.claude/skills/dokpilot/`.
- **macOS Keychain service:** `vps-ninja` → `dokpilot`. Re-run `dokpilot config migrate-to-keychain` after upgrade if you already had Keychain items under the old service.
- **In-repo skill directory:** `skills/vps/` → `skills/dokpilot/`. CI workflow and `scripts/sync-mirrors.sh` updated to match.
- Plugin metadata (`.claude-plugin/plugin.json`, `gemini-extension.json`) bumped to v4.0.0 with new homepage / repository URLs.

### Added — Local web dashboard

- **`/dokpilot ui`** — launches a local web dashboard at `http://127.0.0.1:<random-ephemeral-port>/`. Bearer-token gated, 127.0.0.1-only, strict Origin/Referer + CSRF on POSTs, HttpOnly cookie + injected `window.__DOKPILOT_TOKEN__` for `fetch()`. Subcommands: `--stop`, `--status`, `--no-open`.
- **9-page UI** (`dokpilot-ui/`) — Open Design-generated multi-page operator surface. Pages: Overview, Projects, Deploy wizard, Logs, Domains, Databases, Servers, Claude console, Settings. Simple ⟷ Advanced mode toggle persisted to localStorage.
- **Backend** (`mcp-server/ui-server/`, Node 20 stdlib, zero npm deps). 16 endpoints across read (servers, apps, app detail, app deploys, domains, databases, secrets/status, config, health), writes (domain create, app redeploy/restart/stop, database create) with CSRF gate, SSE (deploy log tail via SSH `tail -f`, events firehose, deploy job stream, Claude session stream), and `/api/assistant` (spawns the local `claude` CLI in stream-json mode, forwards tool calls + message deltas to the UI).
- **Deploy wizard job-runner** — paste GitHub URL → POST `/api/jobs/deploy` → atomic job file at `~/.claude/skills/dokpilot/jobs/<id>.json` → mock worker advances the lifecycle (analyzing-stack → awaiting-answers → deploying → wait-dns → finalizing → done) while the UI tails via `fs.watch` + SSE. The mock will be replaced by a real `/dokpilot deploy --job <id>` Claude worker in a future minor release.

### Added — Brand

- **Pixel-art whale-pilot logo** (Higgsfield GPT Image 2) and full asset set: GitHub social card 1280×640, README banner 1200×300, landing hero 1920×1080 still + 5s Kling v3.0 loopable MP4. Files under `landing/public/brand/`.
- **`design-systems/dokpilot/`** in Open Design — canonical DESIGN.md + tokens.css + components.html + manifest.json. Brand voice: dark base `#0a0b0c`, neon-green accent `#39ff14`, JetBrains Mono for technical strings, Inter for narrative. Sibling design system to keys-keeper.
- `LICENSE` (MIT) at repo root.

### Added — Dokploy currency

- Documented baseline bumped to **Dokploy v0.29+** (released 2026-05-22). New eval case `dokploy-version-drift` calls `settings.version` and warns when the running instance is below baseline.
- All references translated to English; Russian fragments removed.

### Not changed

- Command surface (`setup|deploy|domain|db|status|logs|destroy|config`) — same names, same args.
- Dokploy tRPC contracts and CloudFlare DNS flow.
- macOS Keychain secret-store mechanics (only the service name changed).

### Migration notes

- This is a hard rename. There are **no `/vps` alias commands** and the old `vps-ninja` plugin slug is gone. GitHub's repo-rename redirect covers the URL change; nothing further is needed for `git pull`.
- If you scripted any path with `~/.claude/skills/vps` or `skills/vps/`, update it to `dokpilot`.

---

## v3.2.0 — 2026-04-19

### Security

- **Secrets moved to macOS Keychain by default** — Dokploy API keys and the CloudFlare API token now live under service `dokpilot` in the system Keychain. `config/servers.json` holds references of the form `{"_secret": "<account>"}` instead of raw values. Plain-string storage remains fully supported for backwards compatibility and non-macOS platforms.
- **First-access prompt via system dialog** — Keychain items are stored without `-T`, so macOS prompts for permission the first time each binary reads a secret; users click "Always Allow" to whitelist. This is stricter than pre-authorising arbitrary callers.
- **Hidden input for token entry** — `config server add` and `config cloudflare` prompt via `read -s` when invoked without an argument, keeping tokens out of shell history.
- **Warning when a token is passed as a CLI argument** — `config cloudflare <token>` still works but now prints a rotation hint.

### Added

- **`scripts/secret-store.sh`** — thin wrapper over the macOS `security` CLI with `get`/`set`/`delete`/`list`/`available` actions.
- **`scripts/_lib.sh`** — shared `resolve_secret()` helper sourced by `cloudflare-dns.sh` and `dokploy-api.sh`; transparently handles both plain-string and `{"_secret": ...}` forms.
- **`/dokpilot config migrate-to-keychain`** — one-shot migration for existing installations: writes a `.pre-keychain-<date>` backup, moves every plain secret into the Keychain, and rewrites `servers.json` to use references.
- **`/dokpilot config` output rewrite** — now prints a source report (Keychain vs file) per secret field without ever printing values.
- **`references/secrets-management.md`** — new guide covering storage formats, the first-access prompt, rotation, revocation, rollback to plain, and troubleshooting a locked Keychain.
- **Two new eval scenarios** — `config migrate-to-keychain` and backwards compatibility of legacy plain-string configs.

### Changed

- **`/dokpilot config server add` flow** — prompts for the API key with hidden input (no argument form), then asks where to store it. Keychain is the default on macOS.
- **`/dokpilot config server remove` flow** — now deletes related Keychain items after an explicit `Y/n` confirmation.
- **Eval #3 (Setup VPS)** — extended with assertions that Keychain is offered as the default secret store on macOS and that the raw token never reaches stdout.

### Not changed (by design)

- **SSH private keys** — `servers.<name>.ssh_key` remains a path on disk. The recommendation for passphrase storage is `ssh-add --apple-use-keychain`, which is system-wide and outside this skill's scope.
- **Non-macOS platforms** — Linux/Windows continue to use plain-string storage; no warnings, no forced migration.

---

## v3.1.1 — 2026-03-18

### Security

- **Fixed command injection in ssh-exec.sh** — `--bg` and `--poll` modes now escape single quotes in commands, preventing injection via crafted arguments
- **SSH passwords no longer visible in process list** — switched from `sshpass -p` flag to `SSHPASS` environment variable
- **DRY refactor of ssh-exec.sh** — extracted `_load_server_config()` and `_run_ssh()` helper functions, reducing code duplication

### Added

- **`--dry-run` mode for deploy** — preview the full deployment plan (project, DNS, env vars) without executing any changes
- **`--server` flag on all commands** — target a specific server in multi-server setups
- **Resource warnings in `/dokpilot status`** — alerts when disk > 80%, RAM > 90%, or Docker images are accumulating
- **Rollback documentation** — `references/troubleshooting.md` now includes rollback strategies for broken deployments
- **Smoke test after manual Docker deploy** — automatic health check after fallback deployment

### Fixed

- **CloudFlare multi-part TLD support** — `.co.uk`, `.com.br`, and similar TLDs now resolve correctly via API zone lookup fallback

---

## v3.1.0 — 2026-03-09

### Fixed (deployment reliability)

- **GitHub App integration completely rewritten** — replaced non-existent REST endpoint `PUT applications/{id}/github` with correct tRPC call `application.saveGithubProvider` + `gitProvider.getAll` for obtaining `githubId`
- **`application.saveBuildType` validation errors** — added 3 missing required fields (`dockerfile`, `herokuVersion`, `railpackVersion`) that Dokploy v0.28 Zod schema demands for all build types, not just Docker
- **`application.saveEnvironment` validation errors** — added 3 missing required fields (`buildArgs`, `buildSecrets`, `createEnvFile`) required by Zod schema
- **All HTTP methods corrected** — documented that Dokploy tRPC uses POST for all mutations (no PUT/DELETE exists)
- **`composeFile` field name** — corrected from `customCompose` in older docs
- **API timeouts** — increased from 30s to 60s for mutation endpoints (`application.update`, `saveBuildType`, etc.) to prevent false timeout errors

### Added

- **4-tier deployment fallback chain** — GitHub App → public git → PAT git → manual Docker build, with automatic strategy selection
- **Server-side repo accessibility check** — SSH to server + `git ls-remote` before choosing deployment strategy
- **SSH long-running command support** — `--bg` mode (nohup background execution) and `--poll` mode (check if process is still running) for Docker builds and other slow operations
- **Manual Docker deploy guide** — new `references/manual-docker-deploy.md` with Dockerfile templates for Next.js, Node.js, Vite, and full Docker Compose raw YAML workflow
- **Next.js Node.js version detection** — auto-detects Next.js version and sets `NIXPACKS_NODE_VERSION` environment variable; creates `.nvmrc` file for Next.js 15+ (requires Node 20+) and 16+ (requires Node 20+)
- **`github_provider_id` caching** — stored in `servers.json` after first lookup to avoid repeated `gitProvider.getAll` calls
- **GitHub App auto-deploy documentation** — new `references/github-app-autodeploy.md` explaining that Dokploy auto-deploys via GitHub App (no webhooks needed)
- **Troubleshooting guide** — new `references/troubleshooting.md` covering 8 categories: build failures, SSL, DNS, connectivity, databases, auto-deploy, SSH, Dokploy panel

### Changed

- **Deploy report now includes auto-deploy note** — "Auto-deploy is active via GitHub App. Push to `<branch>` to trigger redeploy."
- **Skill never suggests webhook setup** — explicitly documented that Dokploy GitHub App handles auto-deploy without webhooks or GitHub Actions
- **`deployment.logsByDeployment` replaced with SSH** — primary log retrieval is now SSH + `logPath` from deployment response (API endpoint unreliable in current Dokploy versions)

---

## v3.0 — 2026-02-28

### Added

- **7 built-in reference guides** — deploy-guide.md, setup-guide.md, stack-detection.md, dokploy-api-reference.md, github-app-autodeploy.md, troubleshooting.md, manual-docker-deploy.md
- **MCP server for Dokploy documentation** — optional Node.js server exposing Dokploy docs as MCP tools (`dokploy_api_reference`, `dokploy_guide`, `dokploy_search`)
- **GitHub App auto-deploy knowledge** — skill understands Dokploy auto-deploys via GitHub App, never suggests webhooks
- **DNS `--no-proxy` mode** — CloudFlare records created in DNS-only mode for Let's Encrypt HTTP challenges
- **Evaluation framework** — 3 benchmark scenarios with assertion-based testing
- **Benchmark results** — 100% pass rate with skill vs 25% without, 42s faster on average

### Changed

- **Language switched to English** — SKILL.md and all reference guides rewritten in English for broader usability
- **Updated for Dokploy v0.27+** — all API calls include `environmentId` parameter
- **Documentation hierarchy** — reference guides are the primary source of truth, web search is last resort
- **Context7 integration** — fallback to `mcp__plugin_context7_context7__query-docs` for edge cases not covered by built-in docs

### Removed

- **Web search dependency** — skill no longer needs web access for standard operations

---

## v2.0 — 2026-02-20

### Changed

- **Updated for Dokploy v0.27 compatibility** — added `environmentId` to all `*.create` API calls
- **Improved security hardening** — better firewall configuration, swap detection
- **Better error messages** — more specific error descriptions with actionable suggestions

### Fixed

- **API calls failing on new Dokploy versions** — `environmentId` was missing from create requests

---

## v1.0 — 2026-02-16

### Added

- **8 commands:** `setup`, `deploy`, `domain`, `db`, `status`, `logs`, `destroy`, `config`
- **4 reference guides:** deploy-guide.md, setup-guide.md, stack-detection.md, dokploy-api-reference.md
- **4 shell scripts:** dokploy-api.sh, cloudflare-dns.sh, ssh-exec.sh, wait-ready.sh
- **VPS setup template** — automated server initialization (firewall, swap, fail2ban)
- **Auto stack detection** — 20+ frameworks across Node.js, Python, Go, Rust, Ruby, Java, .NET, PHP, Docker
- **CloudFlare DNS integration** — automatic A-record creation and management
- **Configuration management** — local `servers.json` for credentials storage
- **Env var discovery** — from `.env.example`, code analysis, ORM schemas, README
- **Database provisioning** — PostgreSQL, MySQL, MariaDB, MongoDB, Redis via Dokploy
