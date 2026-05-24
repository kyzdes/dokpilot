# PRD: Dokpilot — Claude Code Skill for VPS Automation

## 1. Overview

### What is it

**Dokpilot** is a private Claude Code skill that turns Claude into a full-fledged DevOps engineer. Through simple text commands, users can set up a VPS from scratch, deploy any project from GitHub, and automatically configure domains via CloudFlare — all without manual work with servers and control panels.

### Problem

- Setting up VPS, Dokploy, DNS, SSL is routine nobody wants to do manually
- Every project requires the same steps: create a Dokploy project, set env vars, configure domain, DNS record, SSL
- Different projects have different stacks, each needing its own build configuration
- Manual configuration errors waste significant time
- Without proper references, even AI assistants make mistakes (wrong API endpoints, missing fields, webhook confusion)

### Solution

One skill for Claude Code covering the full lifecycle:

```
/dokpilot setup 123.45.67.89 root:password    → configured VPS with Dokploy
/dokpilot deploy github.com/user/repo          → running project on server
/dokpilot domain app.example.com project-name   → domain with SSL attached
```

### Target user

Single user — project author. The skill is private, stored in `~/.claude/skills/dokpilot/`.

---

## 2. Architecture

### System components

```
┌──────────────────────────────────────────────────────────┐
│                      Claude Code                          │
│                                                           │
│  ┌───────────────────────────────────────────────────┐   │
│  │           Dokpilot Skill (SKILL.md)               │   │
│  │                                                     │   │
│  │  /dokpilot setup    → SSH → Install Dokploy             │   │
│  │  /dokpilot deploy   → Dokploy tRPC API → Deploy App    │   │
│  │  /dokpilot domain   → CF API + Dokploy API → Domain    │   │
│  │  /dokpilot db       → Dokploy API → Database            │   │
│  │  /dokpilot status   → Dokploy API + SSH → Status        │   │
│  │  /dokpilot logs     → SSH + Dokploy API → Logs          │   │
│  │  /dokpilot destroy  → Dokploy API + CF API → Cleanup    │   │
│  │  /dokpilot config   → Local JSON → Configuration        │   │
│  └───────────────────────────────────────────────────┘   │
│                          │                                │
│              ┌───────────┼───────────┐                    │
│              ▼           ▼           ▼                    │
│          SSH (22)   Dokploy tRPC  CloudFlare API          │
│                     (port 3000)  (api.cloudflare.com)     │
└──────────────────────────────────────────────────────────┘
              │           │           │
              ▼           ▼           ▼
         ┌─────────┐  ┌───────┐  ┌──────────┐
         │   VPS   │  │Dokploy│  │CloudFlare│
         │ (Linux) │  │  API  │  │   DNS    │
         └─────────┘  └───────┘  └──────────┘
```

### Two-phase approach

1. **Setup phase (direct SSH):**
   - SSH connection via `ssh` / `sshpass`
   - Dokploy installation and basic server configuration
   - API key generation
   - Credentials saved to local config

2. **Operations phase (Dokploy tRPC API + SSH):**
   - Project/app/database management — via Dokploy tRPC API (all mutations are POST)
   - Deploy and monitoring — via Dokploy API
   - Diagnostics and non-standard operations — SSH fallback
   - Logs — SSH + logPath from API response (primary), API endpoint (fallback)

### Configuration storage

```
~/.claude/skills/dokpilot/
├── SKILL.md                    # Main skill with routing and inline commands
├── config/
│   └── servers.json            # Server credentials registry (gitignored)
├── scripts/
│   ├── dokploy-api.sh          # Dokploy tRPC API wrapper (dynamic timeouts)
│   ├── cloudflare-dns.sh       # CloudFlare DNS wrapper (multi-part TLD support)
│   ├── ssh-exec.sh             # SSH wrapper (bg/poll modes, injection-safe)
│   └── wait-ready.sh           # URL health checker
├── references/
│   ├── deploy-guide.md         # 3-phase deploy workflow
│   ├── setup-guide.md          # VPS setup from scratch (10 steps)
│   ├── stack-detection.md      # Framework detection rules (11 priorities)
│   ├── dokploy-api-reference.md # Full tRPC API reference (v0.27+)
│   ├── github-app-autodeploy.md # GitHub App auto-deploy guide
│   ├── troubleshooting.md      # SSL, DNS, build error solutions
│   └── manual-docker-deploy.md # Fallback deploy without GitHub
├── templates/
│   └── setup-server.sh         # VPS initialization script
└── mcp-server/                 # Optional Dokploy Docs MCP server
    ├── index.js
    └── docs/
```

### Server config file (`servers.json`)

```json
{
  "servers": {
    "main": {
      "name": "main",
      "host": "123.45.67.89",
      "ssh_user": "root",
      "dokploy_url": "http://123.45.67.89:3000",
      "dokploy_api_key": "dk_...",
      "github_provider_id": "...",
      "added_at": "2026-02-16"
    }
  },
  "cloudflare": {
    "api_token": "cf_...",
    "account_id": "..."
  },
  "defaults": {
    "server": "main",
    "build_type": "nixpacks"
  }
}
```

> **Security:** `servers.json` is stored locally in `~/.claude/skills/dokpilot/config/` only. Never committed to repositories. The skill asks for credentials on first run and saves them.

---

## 3. Commands

### 3.1 `/dokpilot setup` — Set up VPS from scratch

**Syntax:**
```
/dokpilot setup <ip> <root-password>
/dokpilot setup                          # prompts for IP and password
```

**What it does:**
1. Connects via SSH
2. Updates system (`apt update && apt upgrade`)
3. Configures firewall (UFW: ports 22, 80, 443, 3000)
4. Installs Dokploy (`curl -sSL https://dokploy.com/install.sh | sh`)
5. Waits for Dokploy to be ready (port 3000)
6. Guides user through admin account creation in Dokploy UI
7. User provides API key from Dokploy UI
8. Saves server data to `servers.json`
9. Optional: swap, fail2ban, unattended-upgrades
10. Outputs final report

**Error handling:**
- SSH connection failed → check IP, password, port 22
- Port 3000 occupied → suggest alternative port
- Low RAM (< 2GB) → warn, suggest swap
- Dokploy won't start → show logs, suggest manual diagnostics

---

### 3.2 `/dokpilot deploy` — Deploy a project

**Syntax:**
```
/dokpilot deploy <github-url> [--server <name>] [--domain <domain>] [--branch <branch>] [--dry-run]
```

**Phase 1 — Project analysis (automatic):**
1. Clones repository locally (shallow clone)
2. Detects stack (see stack detection rules in `references/stack-detection.md`)
3. Determines application port
4. Discovers required env vars
5. Detects database dependencies
6. Determines build type (Nixpacks / Dockerfile / Docker Compose)
7. For Next.js: checks version and creates `.nvmrc` if Node 20+ required

**Phase 2 — User clarification:**
- Shows analysis results
- Asks for secret env var values
- Asks for domain (if not in command)
- Suggests database creation if dependencies found

**Phase 3 — Deploy:**
1. Creates project in Dokploy (`POST project.create` with `environmentId`)
2. Creates databases if needed
3. Creates application in project
4. Configures Git provider using **4-tier fallback strategy:**
   - Path A: GitHub App (`application.saveGithubProvider` + `githubId` from `gitProvider.getAll`)
   - Path B: Public git URL (`application.update` with `sourceType: "git"`)
   - Path C: PAT-authenticated URL
   - Path D: Manual Docker build (see `references/manual-docker-deploy.md`)
5. Sets build type (`application.saveBuildType` — all 7 required fields)
6. Sets env vars (`application.saveEnvironment` — all 5 required fields)
7. Adds domain (`domain.create`)
8. Creates DNS A-record in CloudFlare (**`--no-proxy`** for Let's Encrypt)
9. Triggers deploy (`application.deploy`)
10. Monitors build logs via SSH
11. Checks accessibility
12. Outputs deploy report with note: "Auto-deploy active — push to `<branch>` to redeploy"

**`--dry-run` mode:** Shows what would happen without executing.

---

### 3.3 `/dokpilot domain` — Domain management

**Syntax:**
```
/dokpilot domain add <domain> <project-name> [--port <port>] [--server <name>]
/dokpilot domain remove <domain>
/dokpilot domain list [--server <name>]
```

**What `add` does:**
1. Gets server IP from config
2. Creates DNS A-record in CloudFlare with `--no-proxy` (for Let's Encrypt)
3. Waits 30s for DNS propagation
4. Adds domain in Dokploy (`domain.create` with `certificateType: "letsencrypt"`)
5. Verifies HTTPS accessibility
6. Optionally enables CloudFlare proxy after SSL certificate is issued

---

### 3.4 `/dokpilot db` — Database management

**Syntax:**
```
/dokpilot db create <type> <name> [--project <project>] [--server <name>]
/dokpilot db list [--server <name>]
/dokpilot db delete <name>
```

**Supported types:** `postgres`, `mysql`, `mariadb`, `mongo`, `redis`

All `*.create` calls require `environmentId` (Dokploy v0.27+).

---

### 3.5 `/dokpilot status` — Server and project status

**Syntax:**
```
/dokpilot status [--server <name>]
```

**What it does:**
1. Queries `project.all` from Dokploy API
2. Gets server resources via SSH (`df`, `free`, `docker stats`)
3. Displays formatted table
4. **Resource warnings:**
   - Disk > 80%: "Warning: Disk almost full. Run `docker system prune`"
   - RAM > 90%: "Warning: Low memory. Consider upgrading"
   - Docker images accumulating: shows `docker system df` summary

---

### 3.6 `/dokpilot logs` — View logs

**Syntax:**
```
/dokpilot logs <project-name> [--lines <n>] [--build]
```

- **Runtime logs** (default): `docker service logs`
- **Build logs** (`--build`): Get deploymentId, fetch via SSH + logPath (primary) or API (fallback)

---

### 3.7 `/dokpilot destroy` — Delete project

**Syntax:**
```
/dokpilot destroy <project-name> [--keep-db] [--keep-dns] [--server <name>]
```

**Always** asks for confirmation before deleting. Shows what will be removed.

---

### 3.8 `/dokpilot config` — Configuration management

**Syntax:**
```
/dokpilot config                          # Show config (without secrets)
/dokpilot config cloudflare <api-token>   # Configure CloudFlare
/dokpilot config server add <name> <ip>   # Add server
/dokpilot config server remove <name>     # Remove server
/dokpilot config default <server-name>    # Set default server
```

---

## 4. CloudFlare Integration

### Authorization
- Uses CloudFlare API Token (not Global API Key)
- Required permissions: `Zone:DNS:Edit`, `Zone:Zone:Read`
- Multi-part TLD support (`.co.uk`, `.com.br`) via API zone lookup fallback

### DNS operations

**During deploy:**
1. Get zone ID by domain (`GET /zones?name=example.com`)
2. Create A-record (`POST /zones/:zone_id/dns_records`)
   - `proxied: false` (`--no-proxy`) — **required for Let's Encrypt HTTP challenges**
3. After SSL is issued, optionally switch to `proxied: true`

**During removal:**
1. Find DNS record by name
2. Delete record

---

## 5. Stack Detection

Detection priority (checked in order):
1. `docker-compose.yml` → Docker Compose
2. `Dockerfile` → Docker
3. `next.config.*` → Next.js (check version for Node.js requirement)
4. `nuxt.config.*` → Nuxt
5. `angular.json` → Angular
6. `package.json` → Node.js (detect framework from dependencies)
7. `requirements.txt` / `pyproject.toml` → Python
8. `go.mod` → Go
9. `Cargo.toml` → Rust
10. `Gemfile` → Ruby
11. `pom.xml` / `build.gradle` → Java

Env vars discovered from 4 sources:
- `.env.example` / `.env.template`
- Code (`process.env.*`, `os.environ`, `os.Getenv`)
- ORM schemas (Prisma, Drizzle)
- README.md

---

## 6. Deployment Strategy

### 4-tier fallback chain

| Tier | Method | When to use |
|:-----|:-------|:------------|
| A | GitHub App (`saveGithubProvider`) | GitHub App installed in Dokploy (recommended) |
| B | Public git URL | No GitHub App, repo is public |
| C | PAT-authenticated URL | No GitHub App, repo is private, user has PAT |
| D | Manual Docker build | No GitHub access from server at all |

### Critical API details (Dokploy v0.27+)

- **All mutations are POST** (tRPC, not REST — no PUT/DELETE)
- **`environmentId` required** for all `*.create` calls
- **`saveBuildType` requires 7 fields:** `applicationId`, `buildType`, `dockerContextPath`, `dockerBuildStage`, `dockerfile`, `herokuVersion`, `railpackVersion`
- **`saveEnvironment` requires 5 fields:** `applicationId`, `env`, `buildArgs`, `buildSecrets`, `createEnvFile`
- **GitHub provider ID** comes from `gitProvider.getAll` → first entry with `providerType: "github"` → use `githubId` field
- **Timeouts:** 60s for mutation endpoints, 30s for reads

---

## 7. Security

### Principles
1. **Credentials local only** — `servers.json` never enters git
2. **Confirmation for destructive ops** — `destroy` always requires confirm
3. **Minimal CloudFlare permissions** — DNS:Edit, Zone:Read only
4. **SSH passwords via env var** — `SSHPASS` not visible in `ps` output
5. **Command injection prevention** — single-quote escaping in ssh-exec.sh
6. **Secrets never in output** — API keys and passwords masked

### Post-setup recommendations
- Configure SSH key instead of password
- Disable root password login
- Remove port 3000 from public access (set up domain for Dokploy panel)

---

## 8. Benchmarks

3 real-world evaluation scenarios on Claude Opus 4.6:

| Metric | With Skill | Without Skill | Delta |
|:-------|:-----------|:--------------|:------|
| **Pass rate** | 100% | 24% | **+76%** |
| **Avg time** | 137.7s | 180.0s | **-42.3s** |

Key findings:
1. Without skill, Claude recommends webhooks for auto-deploy (wrong — Dokploy uses GitHub App)
2. Without skill, Claude misses `--no-proxy` for Let's Encrypt DNS records
3. Skill eliminates web searching entirely (built-in references)
4. Token cost +29% but offset by faster completion and 100% accuracy

Full results: [`benchmarks/BENCHMARK.md`](benchmarks/BENCHMARK.md)

---

## 9. Limitations

Not included in current version:
- Multi-server cluster (Docker Swarm multi-node)
- Monitoring and alerts (Grafana, Prometheus)
- Automatic scaling
- Backup management
- Support for other panels (Coolify, CapRover)
