/* lib/http.js — tiny response helpers shared across routes. */
"use strict";

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

/** Wraps a route fn that may throw. */
const safe = (fn) => async (req, res, ctx) => {
  try {
    await fn(req, res, ctx);
  } catch (err) {
    console.error("[ui] route error:", err);
    if (!res.headersSent) json(res, 500, { error: "internal", message: String(err?.message || err) });
  }
};

module.exports = { json, text, safe };
