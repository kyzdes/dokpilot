"use strict";
/* routes/overview.js — home dashboard aggregates (KYZ-103).
   Merges Dokploy's project.homeStats across all configured servers so
   the index page shows accurate totals + a status rollup without
   hand-walking project.all. */
const { json } = require("../lib/http");
const { listServerNames, dokploy, allSettledMap } = require("../lib/exec");

const num = (v) => (Number.isFinite(v) ? v : 0);

/**
 * GET /api/overview
 *   { totals:{projects,applications,compose,databases,services,running,error,idle},
 *     servers:[{server, ...stats}], errors? }
 */
async function overview(req, res) {
  const names = listServerNames();
  if (names.length === 0) return json(res, 200, { totals: blank(), servers: [], empty: true });

  const byServer = await allSettledMap(names, async (name) => {
    const r = await dokploy(name, "GET", "project.homeStats");
    if (r && r.__error) return { error: r };
    // homeStats returns the object directly in v0.29; tolerate result.data wrap
    return { stats: r?.result?.data || r };
  });

  const totals = blank();
  const servers = [];
  const errors = [];
  for (const name of names) {
    const r = byServer[name];
    if (r.error) { errors.push({ server: name, error: r.error }); continue; }
    const s = r.stats || {};
    const row = {
      server: name,
      projects: num(s.projects),
      applications: num(s.applications),
      compose: num(s.compose),
      databases: num(s.databases),
      services: num(s.services),
      running: num(s.status?.running),
      error: num(s.status?.error),
      idle: num(s.status?.idle),
    };
    servers.push(row);
    for (const k of Object.keys(totals)) totals[k] += row[k] || 0;
  }
  json(res, 200, { totals, servers, errors: errors.length ? errors : undefined });
}

function blank() {
  return { projects: 0, applications: 0, compose: 0, databases: 0, services: 0, running: 0, error: 0, idle: 0 };
}

module.exports = {
  "GET /api/overview": overview,
};
