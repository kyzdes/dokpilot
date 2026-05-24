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
      milestone: "M7 (Epic 4: Claude console) — all milestones live",
      next: "future: real Claude worker replacing lib/mock-worker.js",
      ui_root: ctx.uiRoot,
    });
  },
};
