# Dokpilot ↔ keys-keeper integration — contract spec

> **Status:** spec only (v4.2). keys-keeper is built in a separate session/repo
> (`~/Desktop/Projects/keys-keeper-skill/keys-keeper-skill`, Python, installed via
> pipx as `keys`). This document is the interface Dokpilot will consume; build it
> on the keys-keeper side first, then Dokpilot ships its "Import from keys-keeper"
> client against it. **No Dokpilot code depends on this yet.**

## Goal (user's vision)

In Dokpilot you press **"Import from keys-keeper"**. keys-keeper's local UI opens
(its server is started if needed) and shows a consent prompt:
*"Dokpilot requests permission to read secrets (local only) — Allow / Deny."*
You allow once (optionally "remember"). Dokpilot can then read the approved
secrets to fill deploy env vars. In keys-keeper's access **history**, those reads
appear attributed to **"Dokpilot ✓" (verified app)**.

## What keys-keeper already has (verified)

- `keys serve [--port 7777] [--no-browser]` → local web UI at
  `http://127.0.0.1:<port>/?t=<64-hex token>`; token auth via `Sec-Keys-Token`
  header / `kk_session` cookie / `?t=`. Idle-timeout ~15 min.
- REST API: `GET /api/entries` (metadata, no secret values), `GET /api/entries/{id}`
  (+ 10 recent audit events), `GET /api/audit?op=&name=&limit=`, `POST /api/copy`
  (clipboard, auto-clear), `GET /api/status`, plus create/patch/delete.
- Append-only **audit log** (JSONL, monthly gzip) that **already records caller PID +
  process path** per access. Backends: macOS Keychain / file.
- CLI: `reveal` (secret → stdout), `copy`, `resolve`, `inject`, `list`, `audit`, …
- Design system: dark base `#0a0b0c` + **burnt-orange `#d97550`** accent, Inter +
  JetBrains Mono, `[data-theme]`/`[data-accent]`/`[data-density]` hooks.

## What keys-keeper must ADD for this integration

### 1. Machine-readable serve handshake (discovery)
Dokpilot must find/launch the server without screen-scraping.
- Add `keys serve --json` → on listen, print **one line** of JSON to stdout and keep
  running: `{"url":"http://127.0.0.1:<port>","port":<n>,"token":"<hex>","pid":<n>}`.
- Also write a state file `~/.keys-keeper/.serve` (mode 0600) with the same JSON,
  refreshed on each listen and removed on exit (mirror Dokpilot's `.ui-url`).
- Dokpilot will: read the state file; if stale/missing, spawn `keys serve --json
  --no-browser` and read the printed line.

### 2. App identity + verified-client registry
- Dokpilot identifies itself on every request with header
  `X-Keys-Client: dokpilot` and `X-Keys-Client-Version: <semver>`.
- keys-keeper keeps a small built-in **verified-clients registry** (ship `dokpilot`
  as known/verified). A verified client renders with a **✓ "verified" badge**; any
  other/unknown client renders as **"unverified"** (still allowed, just flagged).
- Identity is advisory (local-only trust); it is NOT an auth boundary — the serve
  token remains the auth boundary.

### 3. Consent / permission grant
- New endpoint `POST /api/grants` body `{client:"dokpilot", scope:"all"|["<entry>",…],
  remember:bool, ttl_seconds?}`. It does **not** return secrets — it **surfaces a
  modal in the keys-keeper UI**: *"Dokpilot (✓ verified) requests permission to read
  secrets (local only)"* with **Allow / Deny**, a scope summary, and a remember
  toggle. Returns `{grant_id, status:"pending"}`.
- `GET /api/grants/{grant_id}` → `{status:"granted"|"denied"|"pending", scope, expires_at}`
  so Dokpilot can poll (or use SSE) for the user's decision.
- Granted grants are persisted (with scope + TTL) so "remember" works across reads.
- A grant is required before any client-attributed reveal (below).

### 4. Scoped, attributed read
- `GET /api/entries?client=dokpilot&grant=<grant_id>` → entry **names/metadata** the
  grant covers (no values).
- `POST /api/reveal` body `{grant_id, name}` → returns the **value** for an approved
  entry only; rejects (403) if not covered by a live grant.
- **Every** such read is appended to the audit log with: `op:"reveal"`,
  `client:"dokpilot"`, `verified:true`, `grant_id`, `name`, timestamp. The audit UI
  (`audit.html`) shows the client + a ✓ badge for verified clients.

### 5. Security principles (must hold)
- 127.0.0.1-only; token auth unchanged; no CORS.
- Consent is **per app + scope + TTL**; deny is sticky for the session.
- Values cross the boundary **only** via `POST /api/reveal` under a live grant, and
  each crossing is audited. No bulk export to a client.
- The serve token is never logged; grants never include secret values.

## Dokpilot-side client (future — built when the above ships)

UI: an **"Import from keys-keeper"** button in the onboarding env step + the
app env editor. Flow:
1. Read `~/.keys-keeper/.serve`; if absent/stale, spawn `keys serve --json --no-browser`,
   capture `{url,token}`. Surface a "keys-keeper isn't installed" hint if the `keys`
   bin is missing (Dokpilot already locates it in `lib/exec.js`).
2. `POST {url}/api/grants` with `X-Keys-Client: dokpilot` → tell the user to approve
   in the keys-keeper window that just opened; poll `GET /api/grants/{id}`.
3. On `granted`: `GET /api/entries?grant=…` → show the covered entry names; user picks
   which map to which deploy env keys.
4. **Store references, never raw values:** Dokpilot persists `{_keykeeper:"<entry>"}`
   in the job/app env (consistent with our `{_secret}` Keychain refs). The raw value
   is fetched via `POST /api/reveal` **only at deploy time** and passed to the worker;
   it is never written to `config/servers.json` or the job file in plaintext.
5. Reads show up in keys-keeper history as **Dokpilot ✓**.

### Dokpilot pieces to add later (not now)
- `mcp-server/ui-server/lib/keykeeper.js` — discovery/spawn + grant + reveal client.
- `routes/keykeeper.js` — `POST /api/keykeeper/connect`, `GET /api/keykeeper/grant/:id`,
  `GET /api/keykeeper/entries`. (Reveal happens server-side at deploy time only.)
- env-editor: honor decision **D-012** (write-only; never display existing secret
  values) — a keys-keeper-sourced value is a reference, shown as `from keys-keeper:
  <entry>`, never echoed.
- Resolve `{_keykeeper:…}` in the deploy worker alongside `{_secret:…}`.

## Open questions for the keys-keeper session
- Grant UX: modal vs a dedicated "Requests" page; SSE for the pending→granted flip
  vs Dokpilot polling.
- Scope granularity: all-secrets vs per-entry multi-select at grant time.
- Whether "remember" persists across `keys serve` restarts (recommended: yes, with TTL).
