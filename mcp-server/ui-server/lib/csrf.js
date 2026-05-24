/* lib/csrf.js — per-launch CSRF token for POST routes.
   The dashboard is local-only and bearer-authed, so CSRF risk is low,
   but Phase D R3 / R4 calls out defense-in-depth: require X-CSRF on
   every POST so a malicious page on the user's machine can't issue
   cross-origin POSTs even if Origin checks somehow slip through.

   The CSRF token is the same as the bearer (rotates per launch). The
   client reads it via GET /api/csrf (which is bearer-protected) and
   echoes it in X-CSRF on POSTs. We compare timing-safe.
*/
"use strict";
const crypto = require("node:crypto");

const safeEqual = (a, b) => {
  const ba = Buffer.from(a || "", "utf8");
  const bb = Buffer.from(b || "", "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

/** Returns true if X-CSRF header matches the expected token. */
function check(req, token) {
  const got = req.headers["x-csrf"] || req.headers["X-CSRF"];
  return safeEqual(got, token);
}

module.exports = { check, safeEqual };
