/* deploy-flow.js — shared live-deploy plumbing (v4.3 H4 / KYZ-238).
   Dedupes the job-stream mechanics that were copy-pasted across
   deploy.html (startLiveDeploy) and onboarding.html (launch + startInstall):
     - logLine(t,kind,text)            build a log-viewer row
     - subscribeJob(id, token, hooks)  EventSource + log-index diffing +
                                       terminal (done/error/not-found) routing
     - postAnswers(id, token, answers) POST each answer to /api/jobs/:id/answer

   Page-specific rendering (cursor, stepper, Q&A panel, done card) stays in the
   pages and is driven via the hooks. Plain script (window.DokFlow) — load
   after app.js, before the page's inline <script>. No app.js dependency
   (uses document.createElement so log rendering can't break on load order). */
(() => {
"use strict";

function logLine(t, kind, text) {
  const row = document.createElement("div");
  row.className = "log-line log-kind-" + (kind || "info");
  const ts = document.createElement("span");
  ts.className = "log-t"; ts.textContent = t || "·";
  const tx = document.createElement("span");
  tx.className = "log-text"; tx.textContent = text == null ? "" : String(text);
  row.append(ts, tx);
  return row;
}

/* Subscribe to a deploy/install job's SSE stream.
   hooks: {
     onJob(job, newLogLines)  // every update; newLogLines = log entries since last tick
     onDone(job), onError(job), onNotFound()
   }
   Returns { close() }. Tracks the log index internally so each page just
   renders the new lines however it likes. */
function subscribeJob(jobId, token, hooks) {
  const h = hooks || {};
  let n = 0, closed = false;
  const es = new EventSource(
    "/api/jobs/" + encodeURIComponent(jobId) + "/stream?t=" + encodeURIComponent(token)
  );
  const close = () => { if (closed) return; closed = true; try { es.close(); } catch (e) {} };
  es.addEventListener("job", (e) => {
    let job; try { job = JSON.parse(e.data); } catch (err) { return; }
    const lines = job.log || [];
    const newLines = lines.slice(n);
    n = lines.length;
    if (h.onJob) h.onJob(job, newLines);
    if (job.status === "done") { close(); if (h.onDone) h.onDone(job); }
    else if (job.status === "error") { close(); if (h.onError) h.onError(job); }
  });
  es.addEventListener("not-found", () => { close(); if (h.onNotFound) h.onNotFound(); });
  // EventSource auto-reconnects on transient network errors — surface optionally.
  es.addEventListener("error", () => { if (h.onStreamError) h.onStreamError(); });
  return { close };
}

/* Post a set of answers. `answers` = [{ questionId, answer }]. */
async function postAnswers(jobId, token, answers) {
  for (const a of answers) {
    await fetch("/api/jobs/" + encodeURIComponent(jobId) + "/answer", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, "X-CSRF": token },
      body: JSON.stringify({ questionId: a.questionId, answer: a.answer }),
    });
  }
}

window.DokFlow = { logLine, subscribeJob, postAnswers };
})();
