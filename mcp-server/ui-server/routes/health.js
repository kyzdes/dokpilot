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
      milestone: "M4 (Epic 2: SSE streaming)",
      next: "M5+M6 (Epic 3): job-runner + write actions",
      ui_root: ctx.uiRoot,
    });
  },
};
