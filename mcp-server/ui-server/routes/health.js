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
      milestone: "M1+M2+M3 (Epic 1: read-only)",
      next: "M4 (Epic 2): SSE log streaming",
      ui_root: ctx.uiRoot,
    });
  },
};
