/* lib/router.js — minimal pattern-matching router.
   Routes are declared as `"<METHOD> /path/with/:params"` keys.
   Matches against `req.method + " " + url.pathname`.
*/
"use strict";

const url = require("node:url");

/**
 * Compile a route pattern into { regex, paramNames } for matching.
 *   "/api/apps/:id"           → /^\/api\/apps\/([^/]+)$/
 *   "/api/servers/:name/stats" → /^\/api\/servers\/([^/]+)\/stats$/
 */
function compile(pattern) {
  const paramNames = [];
  const rx = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { regex: new RegExp("^" + rx + "$"), paramNames };
}

/**
 * Build a router from a list of route maps (each map is the
 * `module.exports` of a route module).
 *
 *   buildRouter([require("./routes/health"), require("./routes/apps")])
 *
 * Returns:
 *   route(req)  → { handler, params } | null
 */
function buildRouter(routeMaps) {
  const routes = [];
  for (const map of routeMaps) {
    for (const key of Object.keys(map)) {
      const space = key.indexOf(" ");
      if (space < 0) throw new Error(`bad route key: ${key}`);
      const method = key.slice(0, space).toUpperCase();
      const pattern = key.slice(space + 1);
      const { regex, paramNames } = compile(pattern);
      routes.push({ method, pattern, regex, paramNames, handler: map[key] });
    }
  }

  return function route(req) {
    const u = url.parse(req.url, true);
    // Stash parsed query on req for handlers
    req.query = u.query;
    const method = (req.method || "GET").toUpperCase();
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = u.pathname.match(r.regex);
      if (!m) continue;
      const params = {};
      r.paramNames.forEach((n, i) => { params[n] = m[i + 1]; });
      return { handler: r.handler, params, pattern: r.pattern, method: r.method };
    }
    return null;
  };
}

module.exports = { buildRouter };
