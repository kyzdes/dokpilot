/* lib/sse.js — Server-Sent Events helpers.
   Provides:
     openStream(res)            sets headers and returns a stream-like
                                object with .send(type, data) and .close()
     followProcess(child, res)  pipes a child_process stdout/stderr into
                                SSE events line-by-line, closes when the
                                process exits or the client disconnects
     pingInterval(handle, ms)   sends a comment heartbeat every N ms
*/
"use strict";

/**
 * Initialize a Server-Sent Events response. Returns:
 *   { send(eventName, dataObj), comment(text), close(reason), closed:boolean }
 *
 * `event` is optional — if omitted, the default "message" event fires.
 *
 * NOTE: We deliberately do NOT set X-Accel-Buffering: no — the dashboard
 * is local-only (per Phase D R2) and there's no upstream reverse proxy
 * to disable. If anyone ever tunnels remotely, they need to set this
 * themselves at their proxy layer.
 */
function openStream(res) {
  let closed = false;
  const closeHandlers = [];
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    "connection": "keep-alive",
    "x-content-type-options": "nosniff",
  });
  res.write(": stream open\n\n");

  const markClosed = () => {
    if (closed) return;
    closed = true;
    for (const h of closeHandlers) { try { h(); } catch {} }
  };

  res.on("close", markClosed);
  res.on("error", markClosed);

  const close = (reason) => {
    if (closed) { return; }
    try {
      if (reason) res.write(`event: close\ndata: ${JSON.stringify({ reason })}\n\n`);
      res.end();
    } catch {}
    markClosed();
  };

  return {
    _res: res,
    get closed() { return closed; },
    send(eventName, data) {
      if (closed) return;
      try {
        if (eventName && eventName !== "message") res.write(`event: ${eventName}\n`);
        const payload = (typeof data === "string") ? data : JSON.stringify(data);
        for (const line of String(payload).split("\n")) res.write(`data: ${line}\n`);
        res.write("\n");
      } catch { markClosed(); }
    },
    comment(text) {
      if (closed) return;
      try { res.write(`: ${text}\n\n`); } catch { markClosed(); }
    },
    onClose(h) { closeHandlers.push(h); },
    close,
  };
}

/**
 * Run a child process and stream its stdout/stderr into the SSE stream
 * line-by-line. Each line is parsed for a leading timestamp (HH:MM:SS or
 * ISO-8601 prefix) so the client can render time + text columns; falls
 * back to current time when unparseable.
 *
 *   followProcess(child, stream, { event: "log" })
 *
 * Cleanup: if the SSE stream closes (client disconnect), the child is
 * SIGTERM'd. If the child exits, the stream emits one `done` event
 * then close.
 */
function followProcess(child, stream, opts = {}) {
  const event = opts.event || "log";

  // Line buffering for stdout
  let stdoutBuf = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString("utf8");
    let nl;
    while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.length > 0 || opts.emitEmpty) emitLine(line, "info");
    }
  });

  // stderr → warn kind
  let stderrBuf = "";
  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString("utf8");
    let nl;
    while ((nl = stderrBuf.indexOf("\n")) >= 0) {
      const line = stderrBuf.slice(0, nl);
      stderrBuf = stderrBuf.slice(nl + 1);
      if (line.length > 0 || opts.emitEmpty) emitLine(line, "warn");
    }
  });

  function emitLine(raw, kind) {
    if (stream.closed) return;
    // Strip ANSI escape sequences (build tools often emit colors)
    const text = raw.replace(/\x1b\[[0-9;]*m/g, "");
    // Try to lift a leading "HH:MM:SS" or "[HH:MM:SS]" timestamp
    let t = null, body = text;
    const m1 = text.match(/^\[?(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]?\s*(.*)$/);
    if (m1) { t = m1[1]; body = m1[2]; }
    else {
      const m2 = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+(.*)$/);
      if (m2) { t = m2[1].slice(11, 19); body = m2[2]; }
    }
    if (!t) {
      const now = new Date();
      t = now.toTimeString().slice(0, 8);
    }

    // Detect ok/warn/error markers ahead of the body
    let lineKind = kind;
    if (/^(?:✓|\[ok\]|success)/i.test(body))       lineKind = "ok";
    else if (/^(?:✕|✗|\[err\]|error|failed)/i.test(body)) lineKind = "error";
    else if (/^(?:⚠|warn|warning)/i.test(body))     lineKind = "warn";

    stream.send(event, { t, kind: lineKind, text: body });
  }

  child.on("exit", (code, signal) => {
    // flush any partial line
    if (stdoutBuf) { emitLine(stdoutBuf, "info"); stdoutBuf = ""; }
    if (stderrBuf) { emitLine(stderrBuf, "warn"); stderrBuf = ""; }
    stream.send("done", { code, signal });
    stream.close("exit");
  });

  child.on("error", (err) => {
    stream.send("error", { message: String(err.message || err) });
    stream.close("spawn-error");
  });

  // Tear down child on client disconnect
  stream.onClose(() => {
    try { child.kill("SIGTERM"); } catch {}
  });
}

/**
 * Heartbeat: emit an SSE comment every `ms` so proxies don't buffer/close
 * idle streams. Returns the interval handle (caller should clear on close).
 */
function pingInterval(stream, ms = 15_000) {
  return setInterval(() => stream.comment("ping " + Date.now()), ms);
}

module.exports = { openStream, followProcess, pingInterval };
