#!/usr/bin/env node
/* smoke.js — boot/health smoke test for the Dokpilot UI server.
   Closes the P0 "smoke tests / CI boot-test" gap.

   What it does:
     1. Spawns `node server.js --port 0 --quiet` and reads the launch URL
        (token included) off stdout.
     2. Hits every read endpoint in SPECS with Authorization: Bearer <token>.
     3. Asserts HTTP 200 + a per-endpoint shape check.
     4. Prints a PASS/FAIL table and exits non-zero on any failure.
     5. Always tears the server down.

   Requires a live config/servers.json (the read endpoints fan out to the
   real Dokploy). With zero servers configured most endpoints still 200
   with empty arrays — the shape checks tolerate that. Endpoints that
   genuinely depend on a server are tagged `live:true` and are reported
   as SKIP (not FAIL) when no server is configured.

   Usage:  node mcp-server/ui-server/smoke.js
*/
"use strict";

const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const SERVER_JS = path.join(__dirname, "server.js");

/* ─── endpoint specs ────────────────────────────────────────────────
   `check` returns true (ok), false (bad shape), or "skip" to mark the
   endpoint SKIP (e.g. nothing to test against without a live server). */
const SPECS = [
  { path: "/api/health", check: (j) => j && j.status === "ok" },
  { path: "/api/config", check: (j) => j && typeof j === "object" && !j.error },
  { path: "/api/servers", check: (j) => Array.isArray(j.servers) },
  { path: "/api/apps", check: (j) => Array.isArray(j.apps) },
  { path: "/api/domains", check: (j) => Array.isArray(j.domains) },
  { path: "/api/databases", check: (j) => Array.isArray(j.databases) },
  { path: "/api/secrets/status", check: (j) => j && typeof j === "object" && !j.__error },
  // ── v4.1 additions (registered as they ship) ──
  { path: "/api/deploy-queue", check: (j) => Array.isArray(j.queue), optional: true },
  { path: "/api/overview", check: (j) => j && typeof j === "object" && !j.__error, optional: true },
];

function get(urlBase, token, p) {
  return new Promise((resolve) => {
    const u = new URL(p, urlBase);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "GET",
        headers: { Authorization: "Bearer " + token } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(body); } catch {}
          resolve({ status: res.statusCode, json, raw: body.slice(0, 200) });
        });
      }
    );
    req.on("error", (e) => resolve({ status: 0, error: String(e.message) }));
    req.setTimeout(20_000, () => { req.destroy(); resolve({ status: 0, error: "timeout" }); });
    req.end();
  });
}

function waitForUrl(child, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("server did not print URL within " + timeoutMs + "ms")), timeoutMs);
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/http:\/\/127\.0\.0\.1:\d+\/\?t=[a-f0-9]+/);
      if (m) { clearTimeout(timer); resolve(m[0]); }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error("server exited early (code " + code + ")")); });
  });
}

(async () => {
  const child = spawn("node", [SERVER_JS, "--port", "0", "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c.toString()));

  let launchUrl;
  try {
    launchUrl = await waitForUrl(child);
  } catch (e) {
    console.error("BOOT FAILED:", e.message);
    if (stderr) console.error(stderr.slice(0, 1000));
    try { child.kill("SIGTERM"); } catch {}
    process.exit(1);
  }

  const u = new URL(launchUrl);
  const token = u.searchParams.get("t");
  const base = `http://127.0.0.1:${u.port}`;
  console.log(`booted at ${base} (pid ${child.pid})\n`);

  const results = [];
  for (const spec of SPECS) {
    const r = await get(base, token, spec.path);
    let verdict;
    if (r.status === 0) verdict = spec.optional ? "SKIP" : "FAIL";
    else if (r.status === 404 && spec.optional) verdict = "SKIP"; // not yet registered
    else if (r.status !== 200) verdict = "FAIL";
    else {
      let ok;
      try { ok = spec.check(r.json); } catch { ok = false; }
      verdict = ok === "skip" ? "SKIP" : (ok ? "PASS" : "FAIL");
    }
    results.push({ path: spec.path, status: r.status, verdict, note: r.error || "" });
  }

  try { child.kill("SIGTERM"); } catch {}

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("ENDPOINT", 28) + pad("HTTP", 6) + "RESULT");
  console.log("─".repeat(46));
  for (const r of results) {
    const mark = r.verdict === "PASS" ? "✓" : r.verdict === "SKIP" ? "·" : "✗";
    console.log(pad(r.path, 28) + pad(r.status, 6) + `${mark} ${r.verdict}` + (r.note ? `  (${r.note})` : ""));
  }

  const failed = results.filter((r) => r.verdict === "FAIL");
  const passed = results.filter((r) => r.verdict === "PASS").length;
  const skipped = results.filter((r) => r.verdict === "SKIP").length;
  console.log("─".repeat(46));
  console.log(`${passed} passed · ${failed.length} failed · ${skipped} skipped`);
  process.exit(failed.length ? 1 : 0);
})();
