# dokpilot

<p align="center">
  <img src="https://raw.githubusercontent.com/kyzdes/dokpilot-landing/main/public/brand/banner.png" alt="Dokpilot — Deploy anything. One command. No DevOps." width="100%" />
</p>

> Deploy and manage applications on VPS servers with Dokploy (Claude Code / Codex / Gemini skill).

## Install

### Claude Code

    /plugin install https://github.com/kyzdes/dokpilot
    # or via marketplace:
    /plugin marketplace add kyzdes/marketplace-skills
    /plugin install dokpilot@kyzdes-skills

### Codex CLI / Gemini CLI

    curl -sSL https://raw.githubusercontent.com/kyzdes/marketplace-skills/main/install.sh \
      | bash -s <codex|gemini> dokpilot

## Updates

Claude: `/plugin update dokpilot`
Codex/Gemini: `install.sh update <agent>`

---

<p align="center">
  <img src="https://img.shields.io/badge/version-v4.0.0-00FF41?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/pass_rate-100%25-00FF41?style=flat-square" alt="Pass Rate" />
  <img src="https://img.shields.io/badge/stacks-20+-blue?style=flat-square" alt="Stacks" />
  <img src="https://img.shields.io/badge/license-MIT-gray?style=flat-square" alt="License" />
</p>

# Dokpilot

> One command to go from a GitHub repo to a live app with SSL, domain, and auto-deploy on push.

```
/dokpilot deploy github.com/user/my-app --domain app.example.com
```

Dokpilot is a [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills) that turns Claude into a DevOps engineer for your VPS. It automates the full lifecycle through [Dokploy](https://dokploy.com) and CloudFlare DNS — setup, deploy, domains, databases, monitoring, and teardown.

---

## Benchmarks

We tested Claude with and without Dokpilot across 3 real-world DevOps scenarios:

<table>
<tr>
<td width="50%">

### With Dokpilot
- Pass rate: **100%**
- Reads built-in references instantly
- Uses correct tRPC API calls
- DNS `--no-proxy` for Let's Encrypt
- Auto-deploy via GitHub App (no webhooks)

</td>
<td width="50%">

### Without Dokpilot
- Pass rate: **24%**
- Googles outdated Dokploy docs
- Misses required API fields
- Breaks SSL with CloudFlare proxy
- Recommends manual webhook setup

</td>
</tr>
</table>

> **Most revealing test:** When asked about auto-deploy, naked Claude recommends setting up webhooks — the exact opposite of how Dokploy works. Dokpilot correctly explains that the GitHub App handles it automatically.

Full results: [`benchmarks/BENCHMARK.md`](benchmarks/BENCHMARK.md)

---

## Quick Start

### 1. Install the skill

```bash
git clone https://github.com/kyzdes/dokpilot.git ~/dokpilot
ln -s ~/dokpilot ~/.claude/skills/dokpilot
```

### 2. Install dependencies

```bash
# macOS
brew install jq sshpass

# Ubuntu/Debian
sudo apt install jq sshpass
```

### 3. Set up your VPS

```
/dokpilot setup <server-ip> <root-password>
```

Claude SSHs in, installs Dokploy, configures the firewall, and walks you through creating an admin account.

### 4. Deploy

```
/dokpilot deploy github.com/user/app --domain app.example.com
```

Claude detects your stack, creates the project in Dokploy, sets up DNS + SSL, deploys, and enables auto-deploy on push. Done.

---

## Commands

| Command | Description |
|:--------|:------------|
| `/dokpilot setup <ip> <password>` | Set up a fresh VPS with Dokploy |
| `/dokpilot deploy <url> [--domain D] [--dry-run]` | Deploy from GitHub |
| `/dokpilot domain add <domain> <project>` | Add domain with SSL |
| `/dokpilot domain remove <domain>` | Remove domain |
| `/dokpilot domain list` | List all domains |
| `/dokpilot db create <type> <name>` | Create database (postgres/mysql/mongo/redis) |
| `/dokpilot db list` | List databases |
| `/dokpilot db delete <name>` | Delete database |
| `/dokpilot status` | Server + project status with resource warnings |
| `/dokpilot logs <project> [--build]` | Runtime or build logs |
| `/dokpilot destroy <project>` | Delete project (with confirmation) |
| `/dokpilot config` | Manage servers and CloudFlare config |
| `/dokpilot ui` | Launch the local web dashboard (new in v4.0) |

All commands support `--server <name>` for multi-server setups.

---

## Dashboard (new in v4.0)

`/dokpilot ui` launches a local web dashboard at `http://127.0.0.1:<port>/`
(bearer-token gated, 127.0.0.1-only) with:

- **Servers + apps inventory** — live status from your configured Dokploy instances
- **Deploy wizard** — paste a GitHub URL, answer the questions Claude asks, watch
  the build stream live, click the resulting URL
- **Live log tail** — SSE-streamed deploy logs via SSH `tail -f`
- **Domains + DNS** — Dokploy domains × Cloudflare records, with one-click add
- **Databases** — list, create (postgres / mysql / mariadb / mongo / redis)
- **Claude console** — chat with Claude directly inside the dashboard; tool
  calls and reasoning stream inline

Backend is Node 20 stdlib only (zero npm deps), lives in
[`mcp-server/ui-server/`](mcp-server/ui-server/). Start with `/dokpilot ui`,
stop with `/dokpilot ui --stop`, status with `--status`.

---

## Supported Stacks

Auto-detected from your project files:

| Runtime | Frameworks |
|:--------|:-----------|
| **Node.js** | Next.js, Nuxt, NestJS, Express, Remix, Vite, Astro |
| **Python** | Django, FastAPI, Flask |
| **Go** | Any Go project |
| **Rust** | Any Rust project |
| **Ruby** | Rails, Sinatra |
| **Java** | Spring Boot, Maven, Gradle |
| **.NET** | ASP.NET Core |
| **PHP** | Laravel, Symfony |
| **Docker** | Dockerfile or docker-compose.yml |

---

## How It Works

```
You: /dokpilot deploy github.com/user/app --domain app.example.com

Dokpilot:
  1. Clones repo, detects Next.js + Prisma + PostgreSQL
  2. Asks for secret env vars (NEXTAUTH_SECRET, etc.)
  3. Creates project + PostgreSQL in Dokploy
  4. Connects repo via GitHub App (auto-deploy enabled)
  5. Sets build type (Nixpacks) with all required API fields
  6. Creates DNS A-record in CloudFlare (--no-proxy for SSL)
  7. Adds domain with Let's Encrypt certificate
  8. Deploys, monitors logs, verifies HTTPS

Result: https://app.example.com is live
        Auto-deploy active — push to main to redeploy
```

### Deployment fallback chain

If the GitHub App isn't available, the skill automatically falls back:

```
GitHub App (recommended)
  └─ Public git URL
       └─ PAT-authenticated URL
            └─ Manual Docker build on server
```

---

## Architecture

```
dokpilot/
├── SKILL.md                    # Skill logic and command routing
├── scripts/
│   ├── dokploy-api.sh          # Dokploy tRPC API client (dynamic timeouts)
│   ├── cloudflare-dns.sh       # CloudFlare DNS client (multi-part TLD support)
│   ├── ssh-exec.sh             # SSH wrapper (normal/bg/poll modes)
│   └── wait-ready.sh           # URL health checker
├── references/                 # 7 built-in guides (primary source of truth)
│   ├── deploy-guide.md         # 3-phase deploy workflow
│   ├── setup-guide.md          # 10-step VPS setup
│   ├── stack-detection.md      # Framework detection rules
│   ├── dokploy-api-reference.md
│   ├── github-app-autodeploy.md
│   ├── troubleshooting.md
│   └── manual-docker-deploy.md
├── config/
│   └── servers.json            # Credentials (gitignored)
├── templates/
│   └── setup-server.sh         # VPS init script
├── mcp-server/                 # Optional Dokploy docs MCP server
└── benchmarks/                 # Eval results and viewer
```

---

## Security

| Measure | Detail |
|:--------|:-------|
| Credentials | `servers.json` is gitignored, never committed |
| Passwords | Passed via `SSHPASS` env var (not visible in `ps`) |
| SSH | Command injection prevention via single-quote escaping |
| API keys | Never shown in Claude's responses |
| Destructive ops | `destroy` and `db delete` always require confirmation |
| DNS changes | Preview shown before applying |

---

## Optional: MCP Server

Dokpilot includes a bundled MCP server for always-fresh Dokploy documentation:

```bash
cd ~/.claude/skills/dokpilot/mcp-server && npm install
```

Add to `~/.claude/.mcp.json`:
```json
{
  "mcpServers": {
    "dokploy-docs": {
      "command": "node",
      "args": ["<path-to>/mcp-server/index.js"]
    }
  }
}
```

---

## Documentation

| Document | Description |
|:---------|:------------|
| [`PRD.md`](PRD.md) | Product requirements, architecture, all commands |
| [`CHANGELOG.md`](CHANGELOG.md) | Full version history (v1 → v4.0.0) |
| [`fixed-errors.md`](fixed-errors.md) | 9 production bugs: root cause + solution |
| [`context-map.md`](context-map.md) | Technical deep-dive for contributors |
| [`benchmarks/BENCHMARK.md`](benchmarks/BENCHMARK.md) | Benchmark methodology and results |

---

## Version History

**Current: v4.0.0** (2026-05-24) — [Full changelog](CHANGELOG.md)

- v4.0: Rebrand to Dokpilot, Dokploy v0.29+ baseline, local web dashboard with deploy wizard & SSE log streaming, real Claude console
- v3.2: macOS Keychain secret store (`scripts/secret-store.sh`)
- v3.1: Fixed GitHub App integration, 4-tier deploy fallback, command injection fix, `--dry-run` mode
- v3.0: Built-in reference guides, MCP server, benchmarks (100% pass rate)
- v2.0: Dokploy v0.27 compatibility (`environmentId`)
- v1.0: Initial release — 8 commands, 20+ stacks

---

## License

MIT

## Contributing

PRs welcome. If you find a bug or want to add support for a new stack, [open an issue](https://github.com/kyzdes/dokpilot/issues).
