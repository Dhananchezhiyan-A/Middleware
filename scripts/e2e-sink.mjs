/**
 * Local test destination ("adapter") for E2E + failure testing.
 * Real HTTP server; behaviour selected by URL path:
 *
 *   /ok        -> 200 { ok: true }
 *   /fail500   -> always 500
 *   /rate429   -> always 429 with Retry-After: 1
 *   /hang      -> never responds (client must hit its own timeout)
 *   /refuse    -> (handled by pointing the destination at a closed port)
 *   /flaky/N   -> 500 for the first N requests, then 200 (retry-until-success)
 *   /multi/<x> -> alias of /ok (distinct paths for multi-destination tests)
 *
 * Every request is appended to sink-log.ndjson (timestamp, path, headers, body)
 * so tests can assert exactly what the middleware sent.
 */
import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.env.SINK_PORT ?? 4010);
const LOG = new URL("./sink-log.ndjson", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const counters = new Map();

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const parts = url.pathname.split("/").filter(Boolean); // e.g. ['flaky','2']
    const line = JSON.stringify({
      at: new Date().toISOString(),
      ts: Date.now(),
      method: req.method,
      path: url.pathname,
      idempotencyKey: req.headers["idempotency-key"] ?? null,
      contentType: req.headers["content-type"] ?? null,
      bodyBytes: Buffer.byteLength(body),
      body: (() => { try { return JSON.parse(body); } catch { return body.slice(0, 500); } })(),
    });
    fs.appendFileSync(LOG, line + "\n");

    let status = 200;
    let payload = { ok: true, sink: true };
    const head = parts[0] ?? "";

    if (head === "fail500") {
      status = 500; payload = { ok: false, sink: "forced-500" };
    } else if (head === "rate429") {
      status = 429; payload = { ok: false, sink: "forced-429" };
      res.setHeader("Retry-After", "6"); // > backoff(1)=2s → proves the hint is honored
    } else if (head === "hang") {
      return; // hold the socket open; client times out
    } else if (head === "flaky") {
      const n = Number(parts[1] ?? 1);
      const seen = (counters.get(url.pathname) ?? 0) + 1;
      counters.set(url.pathname, seen);
      if (seen <= n) { status = 500; payload = { ok: false, sink: "flaky", attempt: seen }; }
      else payload = { ok: true, sink: "flaky-recovered", attempt: seen };
    }

    const out = JSON.stringify(payload);
    res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(out) });
    res.end(out);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`SINK listening on http://127.0.0.1:${PORT} (log: ${LOG})`);
});
