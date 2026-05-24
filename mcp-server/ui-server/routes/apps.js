"use strict";
const { json } = require("../lib/http");
const { listServerNames, dokploy, allSettledMap } = require("../lib/exec");

/**
 * Helper: pull the array out of `project.all` (Dokploy returns the raw
 * array in v0.29+ but earlier versions wrap it in `result.data`).
 */
function unwrapList(r) {
  if (Array.isArray(r)) return r;
  if (r?.result?.data) return r.result.data;
  if (r?.data) return r.data;
  return [];
}

/**
 * Walk projects → environments → applications/compose and yield a flat
 * shape the UI can render.
 *
 * Dokploy status vocabulary:
 *   "done"  → finished build, app is running
 *   "idle"  → not deployed
 *   "running" → build in progress (yes, the same word — context matters)
 *   "error" → last deploy failed
 *
 * We normalize:
 *   done → "running"
 *   running → "building"
 *   idle → "stopped"
 *   error → "error"
 */
const STATUS_MAP = {
  done: "running",
  running: "building",
  idle: "stopped",
  error: "error",
};
const normStatus = (s) => STATUS_MAP[s] || s || "stopped";

function flattenProjects(projects, server) {
  const apps = [];
  for (const proj of projects) {
    // Dokploy's project.all returns minimal app objects ({applicationId,
    // name, applicationStatus}) — it doesn't include updatedAt. We
    // fall back to the project's createdAt as a "last known activity"
    // proxy so the UI can sort/filter activity. Real per-deploy
    // timestamps land via /api/apps/:id/deploys (deployment.all).
    const projCreated = proj.createdAt || null;
    for (const env of (proj.environments || [])) {
      const ctx = {
        server,
        project_id: proj.projectId,
        project_name: proj.name,
        env_id: env.environmentId,
        env_name: env.name,
      };
      for (const a of (env.applications || [])) {
        apps.push({
          id: a.applicationId,
          name: a.name,
          status: normStatus(a.applicationStatus),
          stack: a.buildType || "auto-detect",
          domain: null, // fetched in detail view (application.one returns domains)
          last_deploy: a.updatedAt || a.createdAt || projCreated,
          last_deploy_source: a.updatedAt || a.createdAt ? "app" : (projCreated ? "project" : "none"),
          autodeploy: !!a.autoDeploy,
          source: a.sourceType || "unknown",
          kind: "application",
          ...ctx,
        });
      }
      for (const c of (env.compose || [])) {
        apps.push({
          id: c.composeId,
          name: c.name,
          status: normStatus(c.composeStatus),
          stack: "Docker compose",
          domain: null,
          last_deploy: c.updatedAt || c.createdAt || projCreated,
          last_deploy_source: c.updatedAt || c.createdAt ? "app" : (projCreated ? "project" : "none"),
          autodeploy: !!c.autoDeploy,
          source: "compose",
          kind: "compose",
          ...ctx,
        });
      }
    }
  }
  return apps;
}

/**
 * GET /api/apps?server=<name>
 *   Lists applications across all configured servers (or just one if
 *   ?server= is passed). Lightweight — no per-app detail fetch.
 */
async function listApps(req, res) {
  const filter = req.query?.server;
  const names = filter ? [filter] : listServerNames();
  if (names.length === 0) return json(res, 200, { apps: [], empty: true });

  const byServer = await allSettledMap(names, async (name) => {
    const r = await dokploy(name, "GET", "project.all");
    if (r.__error) return { error: r };
    return { apps: flattenProjects(unwrapList(r), name) };
  });

  const apps = [];
  const errors = [];
  for (const name of names) {
    const r = byServer[name];
    if (r.error) errors.push({ server: name, error: r.error });
    else apps.push(...(r.apps || []));
  }
  json(res, 200, { apps, errors: errors.length ? errors : undefined });
}

/**
 * GET /api/apps/:id?server=<name>
 *   Detail view — fetches application.one (or compose.one if not found),
 *   returns env keys (no values) + domains + autodeploy state.
 */
async function appDetail(req, res, ctx, params) {
  const server = req.query?.server || params.server;
  const appId = params.id;
  if (!server) return json(res, 400, { error: "missing-server", message: "?server=<name> required" });

  // Try application.one first. Dokploy's REST shim takes the ID
  // via query string in the endpoint, not via body — see
  // references/dokploy-api-reference.md "GET application.one".
  let detail = await dokploy(server, "GET", `application.one?applicationId=${encodeURIComponent(appId)}`);
  let kind = "application";
  let data = detail.__error ? null : (detail.result?.data || detail);

  // If 404 (e.g. it's a compose project), try compose.one
  if (!data || (data.error?.code === "NOT_FOUND") || (data.code === "NOT_FOUND")) {
    detail = await dokploy(server, "GET", `compose.one?composeId=${encodeURIComponent(appId)}`);
    kind = "compose";
    data = detail.__error ? null : (detail.result?.data || detail);
  }
  if (!data) return json(res, 404, { error: "not-found", appId });

  // Env keys without values
  const envKeys = [];
  const envRaw = data.env || "";
  for (const line of envRaw.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=/);
    if (m) envKeys.push(m[1]);
  }

  json(res, 200, {
    id: appId,
    kind,
    name: data.name,
    server,
    status: normStatus(data.applicationStatus || data.composeStatus),
    stack: data.buildType || (kind === "compose" ? "Docker compose" : "auto-detect"),
    source: data.sourceType,
    repo: data.repository || data.composeRepository || data.gitRepository || null,
    branch: data.branch || data.composeBranch || data.gitBranch || null,
    domains: (data.domains || []).map(d => ({
      host: d.host,
      port: d.port,
      https: d.https,
      certificate_type: d.certificateType,
      ssl: d.certificateType === "letsencrypt" ? "active" : "missing",
    })),
    env_keys: envKeys,
    autodeploy: !!data.autoDeploy,
    github_id: data.githubId || null,
    created_at: data.createdAt,
    updated_at: data.updatedAt,
  });
}

/**
 * GET /api/apps/:id/deploys?server=<name>
 *   Recent deployments for an app (top 10).
 */
async function appDeploys(req, res, ctx, params) {
  const server = req.query?.server || params.server;
  const appId = params.id;
  if (!server) return json(res, 400, { error: "missing-server" });

  // Note: per references/dokploy-api-reference.md, deployment.all may fail
  // in some Dokploy versions — Epic 2 (SSE) falls back to SSH-tailing
  // the logPath from this response. For the read-only milestone we
  // surface whatever the API returns.
  const r = await dokploy(server, "GET", `deployment.all?applicationId=${encodeURIComponent(appId)}`);
  if (r.__error) return json(res, 503, { error: "fetch-failed", ...r });
  const data = r.result?.data || r;
  const list = Array.isArray(data) ? data : (data.deployments || []);

  json(res, 200, {
    deploys: list.slice(0, 10).map((d) => ({
      id: d.deploymentId,
      status: d.status,
      title: d.title || d.commitMessage || "",
      sha: d.commitSha?.slice(0, 7) || null,
      branch: d.branch || null,
      duration_ms: d.endedAt && d.startedAt ? new Date(d.endedAt) - new Date(d.startedAt) : null,
      started_at: d.startedAt,
      ended_at: d.endedAt,
      log_path: d.logPath || null, // used by SSE in Epic 2
    })),
  });
}

module.exports = {
  "GET /api/apps": listApps,
  "GET /api/apps/:id": appDetail,
  "GET /api/apps/:id/deploys": appDeploys,
};
