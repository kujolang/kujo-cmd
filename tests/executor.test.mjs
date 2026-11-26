import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlers } from "../lib/executor.mjs";
import { isolatedKujoEnvironment, run } from "../lib/process.mjs";
import { readLastLines } from "../lib/io.mjs";
import { installLensBrowser, lensBrowserStatus } from "../lib/lens.mjs";

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

test("Lens browser status requires the bridge dependency and a successful headless launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "kujo-cmd-lens-")); const bridge = join(root, "bridge"); const moduleRoot = join(bridge, "node_modules", "playwright-core"); const executable = join(root, "chromium");
  await mkdir(moduleRoot, { recursive: true });
  assert.equal((await lensBrowserStatus(root)).ready, false);
  await writeFile(executable, "fixture");
  await writeFile(join(moduleRoot, "index.js"), `module.exports={chromium:{async launch(options){if(options.headless!==true || !require("node:fs").existsSync(${JSON.stringify(executable)}))throw new Error("browser unavailable");return {async close(){}}},executablePath(){return ${JSON.stringify(executable)}}}};\n`);
  const status = await lensBrowserStatus(root); assert.equal(status.ready, true); assert.equal(status.executable, executable);
  const adapter = handlers({ config: { kujo_bin: process.execPath, sources: { lens: { path: root } } }, project: root, runtime: null }).lens_check;
  await assert.rejects(() => adapter({ path: ".", url: "https://example.com", output_dir: ".lens/test" }, {}), { code: "ability_url_forbidden" });
});

test("Lens browser installer uses the locked bridge lifecycle and verifies Chromium", async () => {
  const root = await mkdtemp(join(tmpdir(), "kujo-cmd-lens-install-")); const bridge = join(root, "bridge"); const fakeNpm = join(bridge, "ci"); const executable = join(root, "chromium");
  await mkdir(bridge, { recursive: true }); await writeFile(join(bridge, "package-lock.json"), "{}\n");
  await writeFile(fakeNpm, `#!/usr/bin/env node\nconst fs=require('node:fs');const path=require('node:path');const root=process.cwd();const moduleRoot=path.join(root,'node_modules','playwright-core');fs.mkdirSync(moduleRoot,{recursive:true});fs.writeFileSync(${JSON.stringify(executable)},'fixture');fs.writeFileSync(path.join(moduleRoot,'index.js'),${JSON.stringify(`module.exports={chromium:{async launch(options){if(options.headless!==true || !require("node:fs").existsSync(${JSON.stringify(executable)}))throw new Error("browser unavailable");return {async close(){}}},executablePath(){return ${JSON.stringify(executable)}}}};\n`)});\n`);
  // Node executes these fixture scripts on every platform, including Windows.
  await writeFile(join(bridge, "run"), await readFile(fakeNpm));
  const status = await installLensBrowser(root, { npmCommand: process.execPath }); assert.equal(status.ready, true); assert.equal(status.executable, executable);
});


test("Lens accepts a headless-shell-only install but rejects a browser that cannot launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "kujo-cmd-headless-"));
  const moduleRoot = join(root, "bridge", "node_modules", "playwright-core");
  await mkdir(moduleRoot, { recursive: true });
  await writeFile(join(moduleRoot, "index.js"), `module.exports={chromium:{async launch(options){if(options.headless!==true)throw new Error('headed unavailable');return {async close(){}}},executablePath(){return ${JSON.stringify(join(root, "missing-headed-browser"))}}}};`);
  const status = await lensBrowserStatus(root);
  assert.equal(status.ready, true);
  assert.equal(status.executable, undefined);
  await writeFile(join(moduleRoot, "index.js"), "module.exports={chromium:{async launch(){throw new Error('missing system dependency')}}};");
  assert.equal((await lensBrowserStatus(root)).ready, false);
});

test("trusted child imports are isolated and a pre-cancelled command never launches", async (t) => {
  const env = isolatedKujoEnvironment({ KUJO_MODULE_PATH:"fixture-path", KUJO_ISOLATED_IMPORTS:"0", WDG_PORT:"7700" });
  assert.equal(env.KUJO_ISOLATED_IMPORTS, "1");
  assert.equal(env.KUJO_MODULE_PATH, undefined);
  assert.equal(env.WDG_PORT, "7700");

  const root = await mkdtemp(join(tmpdir(), "kujo-cmd-cancel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = join(root, "ran.txt");
  const signal = AbortSignal.abort();
  const program = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`;
  await assert.rejects(() => run(process.execPath, ["-e", program], { signal }), { name:"AbortError" });
  await assert.rejects(() => readFile(marker), { code:"ENOENT" });
  await assert.rejects(
    () => run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs:250 }),
    { code:"ability_command_timeout" }
  );
});

test("Watchdog response reads are bounded", async (t) => {
  const server = createServer((_request, response) => response.end("x".repeat(512 * 1024 + 1)));
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  t.after(() => new Promise((close) => { server.close(close); server.closeAllConnections(); }));
  const watchdog = handlers({config:{sources:{}}, project:process.cwd(), runtime:null}).watchdog;
  await assert.rejects(() => watchdog({url:`http://127.0.0.1:${server.address().port}`}), { code:"ability_output_limit" });
});

test("bounded receipt reads omit incomplete leading records", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kujo-receipt-tail-"));
  t.after(() => rm(root, {recursive:true,force:true}));
  const path = join(root, "receipts");
  await writeFile(path, "x".repeat(100));
  assert.deepEqual(await readLastLines(path, 2, 12), []);
  await writeFile(path, `${"x".repeat(100)}\n{"id":2}\n`);
  assert.deepEqual(await readLastLines(path, 2, 12), ['{"id":2}']);
});
