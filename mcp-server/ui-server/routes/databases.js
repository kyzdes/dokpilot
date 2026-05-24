"use strict";
const { json } = require("../lib/http");
const { listServerNames, dokploy, allSettledMap } = require("../lib/exec");

const ENGINE_LABELS = {
  postgres: "PostgreSQL",
  mysql:    "MySQL",
  mariadb:  "MariaDB",
  mongo:    "MongoDB",
  redis:    "Redis",
  libsql:   "libSQL",
};

const ID_FIELD = {
  postgres: "postgresId",
  mysql:    "mysqlId",
  mariadb:  "mariadbId",
  mongo:    "mongoId",
  redis:    "redisId",
  libsql:   "libsqlId",
};

function unwrapList(r) {
  if (Array.isArray(r)) return r;
  if (r?.result?.data) return r.result.data;
  return [];
}

/**
 * GET /api/databases?server=<name>
 *
 * Two-stage fetch:
 *   1. project.all per server → collect tuples
 *      {server, engine_id, id, project_name}
 *      (project.all only returns IDs for databases, not names)
 *   2. <engine>.one per DB → fetch name + dockerImage + status
 *      (parallel via allSettledMap)
 */
async function listDatabases(req, res) {
  const filter = req.query?.server;
  const names = filter ? [filter] : listServerNames();
  if (names.length === 0) return json(res, 200, { databases: [], empty: true });

  // Stage 1: enumerate
  const byServer = await allSettledMap(names, async (name) => {
    const r = await dokploy(name, "GET", "project.all");
    if (r.__error) return { error: r };
    return { projects: unwrapList(r) };
  });

  const tuples = []; // {server, engine_id, id, project_name, env_name}
  const errors = [];
  for (const name of names) {
    const r = byServer[name];
    if (r.error) { errors.push({ server: name, error: r.error }); continue; }
    for (const proj of (r.projects || [])) {
      for (const env of (proj.environments || [])) {
        for (const engineKey of Object.keys(ENGINE_LABELS)) {
          for (const db of (env[engineKey] || [])) {
            tuples.push({
              server: name,
              engine_id: engineKey,
              id: db[ID_FIELD[engineKey]],
              project_name: proj.name,
              project_id: proj.projectId,
              env_name: env.name,
            });
          }
        }
      }
    }
  }

  if (tuples.length === 0) return json(res, 200, { databases: [], errors: errors.length ? errors : undefined });

  // Stage 2: fetch detail per DB (parallel)
  const details = await allSettledMap(tuples.map((_, i) => String(i)), async (idx) => {
    const t = tuples[Number(idx)];
    const endpoint = `${t.engine_id}.one?${ID_FIELD[t.engine_id]}=${encodeURIComponent(t.id)}`;
    const r = await dokploy(t.server, "GET", endpoint);
    if (r.__error) return { tuple: t, error: r };
    const data = r.result?.data || r;
    return { tuple: t, data };
  });

  const databases = [];
  for (const idx of Object.keys(details)) {
    const r = details[idx];
    const t = r.tuple;
    if (r.error || !r.data) {
      // Still emit a row so the UI shows "(detail unavailable)" — better
      // than a silent drop. Mark with status:unknown so badge renders muted.
      databases.push({
        id: t.id,
        name: `(${t.engine_id})`,
        engine: ENGINE_LABELS[t.engine_id],
        engine_id: t.engine_id,
        server: t.server,
        project: t.project_name,
        project_id: t.project_id,
        env: t.env_name,
        status: "unknown",
        detail_unavailable: true,
      });
      continue;
    }
    const d = r.data;
    databases.push({
      id: t.id,
      name: d.name,
      engine: ENGINE_LABELS[t.engine_id] + (d.dockerImage ? " (" + (d.dockerImage.split(":")[1] || "?") + ")" : ""),
      engine_id: t.engine_id,
      docker_image: d.dockerImage || null,
      server: t.server,
      project: t.project_name,
      project_id: t.project_id,
      env: t.env_name,
      external_port: d.externalPort || null,
      status: d.applicationStatus || "unknown",
      created_at: d.createdAt,
    });
  }

  json(res, 200, { databases, errors: errors.length ? errors : undefined });
}

module.exports = {
  "GET /api/databases": listDatabases,
};
