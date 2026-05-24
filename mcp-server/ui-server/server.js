#!/usr/bin/env node
/* Dokpilot UI server — M0 foundation
   Node 20+ stdlib only. No npm deps.
   Serves dokpilot-ui/ as static + minimal /api surface.

   Security model
     - 127.0.0.1 bind only (refuses other Hosts).
     - Random ephemeral port unless --port specified.
     - 32-byte bearer token issued per launch. First GET carries it in
       the URL (`?t=…`); the server sets it as an HttpOnly SameSite=Strict
       cookie and 302-redirects to a clean URL.  Subsequent requests are
       authenticated via cookie OR `Authorization: Bearer …` header.
     - Strict Origin/Referer check on every request (mitigates DNS
       rebinding and CSRF). No CORS headers.
     - POSTs will additionally require CSRF token in X-CSRF (added in M6).

   Args
     --port <n>        explicit port (default: 0 = OS picks ephemeral)
     --token <hex>     explicit bearer token (default: generated 32-byte hex)
     --ui-root <path>  static root (default: <repo>/dokpilot-ui)
     --quiet           emit only the launch URL on stdout (one line)
*/
"use strict";

const http   = require("node:http");
const fs     = require("node:fs");
const path   = require("node:path");
const crypto = require("node:crypto");
const url    = require("node:url");

/* ─── args ──────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const hasFlag = (name) => argv.includes(`--${name}`);

const PORT       = Number(arg("port", "0")) || 0;
const TOKEN      = arg("token") || crypto.randomBytes(16).toString("hex");
const REPO_ROOT  = path.resolve(__dirname, "..", "..");
const UI_ROOT    = path.resolve(arg("ui-root", path.join(REPO_ROOT, "dokpilot-ui")));
const QUIET      = hasFlag("quiet");
const COOKIE_NAME = "dokpilot_token";

if (!fs.existsSync(path.join(UI_ROOT, "index.html"))) {
  console.error(`ui-server: cannot find index.html under ${UI_ROOT}`);
  process.exit(2);
}

/* ─── helpers ───────────────────────────────────────────────────── */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".map":  "application/json; charset=utf-8",
};

const parseCookies = (header) => {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
};

const safeEqual = (a, b) => {
  const ba = Buffer.from(a || "", "utf8");
  const bb = Buffer.from(b || "", "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

const json = (res, code, body) => {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": buf.length,
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  res.end(buf);
};

const text = (res, code, body, contentType = "text/plain; charset=utf-8") => {
  const buf = Buffer.from(body);
  res.writeHead(code, {
    "content-type": contentType,
    "content-length": buf.length,
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  res.end(buf);
};

/* ─── auth ──────────────────────────────────────────────────────── */
/**
 * Three-tier auth check:
 *   1. Token must be present in cookie, query, or Authorization: Bearer.
 *   2. Origin/Referer (if present) must match http://127.0.0.1:<port>.
 *   3. Host header must be 127.0.0.1 or localhost.
 *
 * Returns { ok: true, source } or { ok: false, reason }.
 */
function checkAuth(req, port) {
  const u = url.parse(req.url, true);
  const cookies = parseCookies(req.headers.cookie);
  const cookieTok = cookies[COOKIE_NAME];
  const queryTok = u.query.t;
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  let source = null;
  if (safeEqual(cookieTok, TOKEN)) source = "cookie";
  else if (safeEqual(queryTok, TOKEN)) source = "query";
  else if (safeEqual(bearer, TOKEN)) source = "bearer";
  if (!source) return { ok: false, reason: "token" };

  const expectedHost = `127.0.0.1:${port}`;
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (origin && !origin.endsWith(expectedHost)) return { ok: false, reason: "origin" };
  if (referer && !referer.includes(expectedHost)) return { ok: false, reason: "referer" };

  return { ok: true, source };
}

function setTokenCookie(res) {
  res.setHeader("set-cookie",
    `${COOKIE_NAME}=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Strict`);
}

const missingTokenPage = (reason) =>
  `<!doctype html><meta charset=utf-8><title>Dokpilot UI — missing token</title>` +
  `<body style="font:13px/1.5 ui-monospace,Menlo,monospace;background:#0a0b0c;color:#e8e9eb;padding:40px;">` +
  `<div style="max-width:520px;margin:0 auto;">` +
  `<h1 style="color:#39ff14;font-size:18px;margin:0 0 12px;">missing or invalid token</h1>` +
  `<p>Reason: <code>${reason}</code></p>` +
  `<p>Launch the dashboard via <code>/dokpilot ui</code> in Claude Code. The launcher generates a per-session token and opens the correct URL.</p>` +
  `<p style="color:#6c7178;">The dashboard refuses direct visits without a launch-issued token. This protects against accidental remote access and CSRF.</p>` +
  `</div>`;

/* ─── routes ────────────────────────────────────────────────────── */
function handleApi(req, res, port) {
  const u = url.parse(req.url, true);

  if (u.pathname === "/api/health" && req.method === "GET") {
    return json(res, 200, {
      status: "ok",
      version: "v4.0.0",
      port,
      pid: process.pid,
      uptime_s: Math.round(process.uptime()),
      milestone: "M0",
      next: "M1: /api/config + /api/servers + /api/apps",
      ui_root: UI_ROOT,
    });
  }

  return json(res, 501, {
    error: "not-implemented",
    message: `Endpoint ${req.method} ${u.pathname} is not wired yet. M0 ships only /api/health.`,
    milestone: "M0",
  });
}

function handleStatic(req, res) {
  const u = url.parse(req.url);
  let p = decodeURIComponent(u.pathname || "/");
  if (p === "/" || p === "") p = "/index.html";

  const target = path.resolve(UI_ROOT, "." + p);
  if (!target.startsWith(UI_ROOT + path.sep) && target !== UI_ROOT) {
    return text(res, 403, "forbidden");
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) return text(res, 404, "not found");
    const ext = path.extname(target).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    res.writeHead(200, {
      "content-type": mime,
      "content-length": st.size,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "cache-control": "no-cache",
    });
    fs.createReadStream(target).pipe(res);
  });
}

/* ─── request dispatcher ────────────────────────────────────────── */
function dispatch(req, res, port) {
  // Host check
  const host = (req.headers.host || "").split(":")[0];
  if (host && host !== "127.0.0.1" && host !== "localhost") {
    return text(res, 403, "host mismatch");
  }

  const u = url.parse(req.url, true);
  const cookies = parseCookies(req.headers.cookie);
  const cookieTok = cookies[COOKIE_NAME];
  const queryTok = u.query.t;

  // First-hit: token in query, no cookie yet → set cookie + redirect to clean URL
  // (only for HTML navigation; /api/* clients should send the header explicitly)
  if (queryTok && !cookieTok && !u.pathname.startsWith("/api/")) {
    const auth = checkAuth(req, port);
    if (auth.ok) {
      setTokenCookie(res);
      const newQuery = { ...u.query };
      delete newQuery.t;
      const qs = new url.URLSearchParams(newQuery).toString();
      res.writeHead(302, { location: u.pathname + (qs ? "?" + qs : "") });
      return res.end();
    }
  }

  // Auth gate
  const auth = checkAuth(req, port);
  if (!auth.ok) {
    if (req.method === "GET" && !u.pathname.startsWith("/api/")) {
      return text(res, 401, missingTokenPage(auth.reason), "text/html; charset=utf-8");
    }
    return json(res, 401, { error: "unauthorized", reason: auth.reason });
  }

  // Route
  if (u.pathname.startsWith("/api/")) return handleApi(req, res, port);
  if (req.method !== "GET" && req.method !== "HEAD") return text(res, 405, "method not allowed");
  return handleStatic(req, res);
}

/* ─── boot ──────────────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  const port = server.address().port;
  try { dispatch(req, res, port); }
  catch (err) {
    console.error("[ui] dispatch error:", err);
    if (!res.headersSent) json(res, 500, { error: "internal", message: String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const actualPort = server.address().port;
  const launchUrl = `http://127.0.0.1:${actualPort}/?t=${TOKEN}`;
  if (QUIET) {
    process.stdout.write(launchUrl + "\n");
  } else {
    console.log(JSON.stringify({
      url: launchUrl,
      port: actualPort,
      token_preview: TOKEN.slice(0, 6) + "…" + TOKEN.slice(-4),
      pid: process.pid,
      ui_root: UI_ROOT,
    }, null, 2));
  }
});

/* ─── graceful shutdown ─────────────────────────────────────────── */
process.on("SIGINT",  () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
