import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { handlers } from "../lib/executor.mjs";

test("Watchdog telemetry adapter emits accepted metadata-only canonical v2", async () => {
  let body = null;
  const server = createServer((request, response) => {
    let text = ""; request.setEncoding("utf8"); request.on("data", (chunk) => { text += chunk; }); request.on("end", () => {
      body = JSON.parse(text); response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"ok":true}');
    });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  try {
    const port = server.address().port;
    const adapter = handlers({ config: { version: "test", kujo_bin: process.execPath, sources: {} }, project: process.cwd(), runtime: null }).watchdog_record;
    const result = await adapter({ name: "adapter.test", status: "ok", session_id: "session", run_id: "run", url: `http://127.0.0.1:${port}` });
    assert.equal(result.accepted, true); assert.equal(body.schema_version, "watchdog.telemetry.v2"); assert.equal(body.records[0].attributes["watchdog.outcome.code"], "success");
    assert.deepEqual(body.records[0].content, []); assert.equal(body.records[0].privacy.content_mode, "off"); assert.deepEqual(body.records[0].references.map((item) => item.type), ["session", "run"]);
    await assert.rejects(() => adapter({ name: "adapter.test", url: "https://example.com" }), { code: "ability_url_forbidden" });
  } finally {
    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
});
