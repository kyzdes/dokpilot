"use strict";
const { json } = require("../lib/http");
const { listServerNames, dokploy, cloudflareList, allSettledMap } = require("../lib/exec");

function unwrapList(r) {
  if (Array.isArray(r)) return r;
  if (r?.result?.data) return r.result.data;
  return [];
}

/**
 * Naive zone extraction: last two labels, with .co.uk-style fallback
 * to last three when the second-to-last label is ≤3 chars (per KI-006).
 */
function zoneOf(host) {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  if (parts[parts.length - 2].length <= 3 && parts.length >= 3) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

/**
 * GET /api/domains
 *   Returns every domain across all configured servers + their CF
 *   record state. Two-stage fetch:
 *     1. Walk project.all per server → identify apps that have domains
 *        (we get app IDs from environments[].applications/compose).
 *     2. For each app, call application.one (or compose.one) to get
 *        the domain array. This is the expensive part — N parallel
 *        calls. Acceptable because the Domains page is opened on
 *        demand, not on every dashboard load.
 *     3. Group hosts by zone and fetch CF DNS records per zone.
 *     4. Cross-reference: each domain gets its CF record (or null).
 */
async function listDomains(req, res) {
  const names = listServerNames();
  if (names.length === 0) return json(res, 200, { domains: [], empty: true });

  // Step 1: discover all (server, kind, app-id) tuples
  const projectsByServer = await allSettledMap(names, async (name) => {
    const r = await dokploy(name, "GET", "project.all");
    if (r.__error) return { error: r };
    return { projects: unwrapList(r) };
  });

  const appTuples = []; // {server, kind, id, app_name, project_name}
  for (const name of names) {
    const r = projectsByServer[name];
    if (r.error) continue;
    for (const proj of (r.projects || [])) {
      for (const env of (proj.environments || [])) {
        for (const a of (env.applications || [])) {
          appTuples.push({ server: name, kind: "application", id: a.applicationId, app_name: a.name, project_name: proj.name });
        }
        for (const c of (env.compose || [])) {
          appTuples.push({ server: name, kind: "compose", id: c.composeId, app_name: c.name, project_name: proj.name });
        }
      }
    }
  }

  // Step 2: fetch detail per app to read domains[]
  // Dokploy convention: ID goes in query string, not body (per reference).
  const details = await allSettledMap(appTuples.map((t, i) => String(i)), async (idx) => {
    const t = appTuples[Number(idx)];
    const endpoint = t.kind === "application"
      ? `application.one?applicationId=${encodeURIComponent(t.id)}`
      : `compose.one?composeId=${encodeURIComponent(t.id)}`;
    const r = await dokploy(t.server, "GET", endpoint);
    if (r.__error) return { error: r };
    const data = r.result?.data || r;
    return { domains: data.domains || [], tuple: t };
  });

  // Flatten domains
  const allDomains = [];
  for (const idx of Object.keys(details)) {
    const r = details[idx];
    if (r.error || !r.domains) continue;
    for (const d of r.domains) {
      allDomains.push({
        host: d.host,
        app: r.tuple.app_name,
        app_id: r.tuple.id,
        app_kind: r.tuple.kind,
        server: r.tuple.server,
        project: r.tuple.project_name,
        port: d.port,
        https: d.https,
        certificate_type: d.certificateType,
        ssl: d.certificateType === "letsencrypt" ? "active" : "missing",
      });
    }
  }

  // Step 3: discover unique zones and fetch CF DNS
  const zones = [...new Set(allDomains.map((d) => zoneOf(d.host)))];
  const zoneRecords = await allSettledMap(zones, async (zone) => {
    const r = await cloudflareList(zone);
    if (r.__error) return { error: r };
    // exec.js's cloudflareList parses the script's newline-delimited JSON
    // into { records: [{name, content, type, proxied, ...}] }
    const records = r.records || [];
    const byName = {};
    for (const rec of records) byName[rec.name] = rec;
    return { byName };
  });

  // Step 4: enrich
  const enriched = allDomains.map((d) => {
    const zone = zoneOf(d.host);
    const rec = zoneRecords[zone]?.byName?.[d.host];
    if (!rec) return { ...d, zone, record: null, proxied: null };
    return {
      ...d,
      zone,
      record: `${rec.type} → ${rec.content}`,
      proxied: !!rec.proxied,
      record_id: rec.id,
      record_ttl: rec.ttl,
    };
  });

  json(res, 200, { domains: enriched, zone_count: zones.length });
}

module.exports = {
  "GET /api/domains": listDomains,
};
