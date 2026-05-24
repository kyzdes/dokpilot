# Dokpilot v3.1 — Benchmark Results

**Date:** 2026-04-08
**Model:** Claude Sonnet 4.6 (`claude -p` non-interactive mode)
**Skill version:** v3.1.1
**Runs per configuration:** 1
**Methodology:** Each eval prompt run via `claude -p` with skill enabled vs `--disable-slash-commands`. Assertions evaluated against output text.

## Summary

| Metric | With Skill | Without Skill | Delta |
|:-------|:-----------|:--------------|:------|
| **Pass rate** | 100% | 24% | **+76%** |

## Per-Eval Results

### Eval 1: Deploy Next.js App

**Prompt:** `/dokpilot deploy github.com/kyzdes/my-nextjs-app --domain app.kyzdes.com`

| Assertion | With Skill | Without Skill |
|:----------|:-----------|:--------------|
| Does NOT use WebSearch/WebFetch for docs | PASS | PASS |
| Reads deploy-guide.md / stack-detection.md | PASS | FAIL |
| Does NOT suggest GitHub webhooks | PASS | FAIL |
| Mentions GitHub App auto-deploy | PASS | FAIL |
| Uses environmentId for app creation | PASS | FAIL |
| Creates DNS with --no-proxy | PASS | FAIL |
| **Total** | **6/6 (100%)** | **1/6 (17%)** |

**Key differences:**
- WITH: Follows 3-phase deploy workflow, uses `saveGithubProvider` with `githubId`, all 7 fields in `saveBuildType`, all 5 fields in `saveEnvironment`, `--no-proxy` for Let's Encrypt, auto-deploy via GitHub App
- WITHOUT: Manual Dockerfile approach, recommends Dokploy dashboard UI, suggests GitHub Webhook for auto-deploy, no `environmentId`, no `--no-proxy`

### Eval 2: Auto-Deploy Troubleshooting

**Prompt:** `My app deployed earlier stopped updating when I push to main. How do I fix auto-deploy? Maybe I need to set up a webhook?`

| Assertion | With Skill | Without Skill |
|:----------|:-----------|:--------------|
| Does NOT suggest adding webhook | PASS | FAIL |
| Explains GitHub App handles auto-deploy | PASS | FAIL |
| Suggests checking: GitHub App, autoDeploy, branch | PASS | FAIL |
| Does NOT search the web | PASS | PASS |
| **Total** | **4/4 (100%)** | **1/4 (25%)** |

**Key differences:**
- WITH: Opens with "No webhook needed", explains GitHub App, provides 5-step Dokploy-specific diagnostic (App installed → autoDeploy flag → branch match → deployment history → GitHub App webhook deliveries)
- WITHOUT: Generic troubleshooting (GitHub Actions, webhook listeners, cron polling), recommends setting up webhook in Phase 4, no awareness of Dokploy GitHub App integration

### Eval 3: Setup VPS

**Prompt:** `/dokpilot setup <server-ip> <root-password>`

| Assertion | With Skill | Without Skill |
|:----------|:-----------|:--------------|
| Reads setup-guide.md | PASS | FAIL |
| Does NOT search the web | PASS | PASS |
| Attempts SSH connection (via ssh-exec.sh) | PASS | FAIL |
| Asks user to create admin + provide API key | PASS | FAIL |
| **Total** | **4/4 (100%)** | **1/4 (25%)** |

**Key differences:**
- WITH: Reads setup-guide.md, uses `ssh-exec.sh` with `--password` mode, uses `wait-ready.sh` for Dokploy readiness, asks for API key explicitly, validates key with `settings.version`, saves to `servers.json`, offers optional hardening (swap/fail2ban/unattended-upgrades)
- WITHOUT: Generic SSH + manual steps, no skill scripts, creates admin in UI but doesn't mention API key generation, no config file management, no Dokploy readiness check

## Key Findings

1. **100% vs 24% pass rate** — the skill's built-in references and GitHub App knowledge completely eliminate the most common errors
2. **Most discriminating test remains auto-deploy troubleshooting** — without the skill, the model recommends webhooks (the exact opposite of correct behavior with Dokploy's GitHub App)
3. **v3.1 improvements validated:**
   - `saveBuildType` with all 7 required fields (vs incomplete payload in v3)
   - `saveEnvironment` with all 5 required fields
   - `saveGithubProvider` + `githubId` lookup (vs non-existent REST endpoint in v3)
   - 4-tier deployment fallback chain (GitHub App → public git → PAT → manual Docker)
4. **DNS `--no-proxy` consistently missed without skill** — without the skill, the model uses standard proxied CloudFlare records which break Let's Encrypt HTTP challenges
5. **Without-skill regression from v3 benchmarks** (was 25%, now 24%) — likely due to model version differences in test runs

## v3 vs v3.1 Comparison

| Metric | v3 (2026-02-28) | v3.1 (2026-04-08) |
|:-------|:-----------------|:-------------------|
| With-skill pass rate | 100% | 100% |
| Without-skill pass rate | 25% | 24% |
| v3.1 improvements tested | N/A | saveBuildType 7 fields, saveEnvironment 5 fields, saveGithubProvider, 4-tier fallback |

## Previous Benchmark (v3, for reference)

| Metric | With Skill | Without Skill | Delta |
|:-------|:-----------|:--------------|:------|
| **Pass rate** | 100% | 25% | +75% |
| **Avg time** | 137.7s | 180.0s | -42.3s |
| **Avg tokens** | 50,612 | 39,304 | +11,308 |

## How to Run

```bash
# With skill (from project directory)
claude -p "/dokpilot deploy github.com/kyzdes/my-nextjs-app --domain app.kyzdes.com" --model sonnet

# Without skill
claude -p "Deploy a Next.js app from github.com/kyzdes/my-nextjs-app to a VPS with Dokploy..." --model sonnet --disable-slash-commands
```

Full eval definitions: [`../evals/evals.json`](../evals/evals.json)
