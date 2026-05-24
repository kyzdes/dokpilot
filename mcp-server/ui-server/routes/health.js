"use strict";
const { json } = require("../lib/http");

module.exports = {
  "GET /api/health": (req, res, ctx) => {
    json(res, 200, {
      status: "ok",
      version: "v4.0.0",
      port: ctx.port,
      pid: process.pid,
      uptime_s: Math.round(process.uptime()),
      milestone: "M5 (Epic 3: job-runner)",
      next: "M6 (write actions: domains create, redeploy, db create) + M7 Claude console",
      ui_root: ctx.uiRoot,
    });
  },
};
