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
      milestone: "M6 (Epic 3.5: write actions)",
      next: "M7 (Epic 4): Claude console + /api/assistant",
      ui_root: ctx.uiRoot,
    });
  },
};
