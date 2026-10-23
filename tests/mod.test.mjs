import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";
import { configureWatchdogIgnore, projectCommandCodeAssets, removeCommandCodeAssets } from "../lib/install.mjs";

const entry = resolve("assets/command-code/mods/kujo-command-bridge.ts");
// Invalid delivery URL prevents network activity while exercising hook behavior.
process.env.KUJO_CMD_WATCHDOG_URL = "invalid:";
const { default: mod } = await createJiti(import.meta.url).import(entry);

function host(cwd, tools = [], factory = mod) {
  const commands = new Map(); const events = new Map(); const hooks = [];
  const disposable = { dispose() {} };
  factory({ cwd, addCommand(command) { commands.set(command.name, command); return disposable; },
    getActiveTools() { return tools; }, on(name, handler) { events.set(name, handler); return disposable; },
    hooks(value) { hooks.push(value); return disposable; } });
  return { commands, events, hooks, call: (args) => commands.get("kujo").handler({ args }) };
}

test("mod-only install provides onboarding without creating configuration or calling a model", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "kujo-mod-onboarding-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const h = host(project);
  assert.match((await h.call("")).message, /\/kujo status/);
  assert.match((await h.call("setup")).message, /setup --mod-mode package/);
  assert.match((await h.call("status")).message, /not configured/);
  assert.match((await h.call("setup --force")).message, /Unknown Kujo command/);
  assert.deepEqual(await readdir(project), []);
});

test("status uses host workspace and actual session tools, and reports malformed configuration", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "kujo-mod-status-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(join(project, ".kujo"));
  const config = join(project, ".kujo", "cmd.json");
  await writeFile(config, JSON.stringify({ schema: "kujo.cmd.config/v1", version: "0.3.0", profile: "kujo.profile.review", mod_mode: "package" }));
  const h = host(project, ["shell_command", "mcp__kujo__kujo_ability_catalog"]);
  const status = (await h.call("status")).message;
  assert.ok(status.includes(project)); assert.match(status, /profile: kujo.profile.review/);
  assert.match(status, /Active Kujo MCP tools in this session: 1/);
  assert.match((await host(project).call("status")).message, /Tools are not active/);
  await writeFile(config, "invalid JSON");
  assert.match((await h.call("status")).message, /Cannot read/);
});

test("failed Kujo calls continue only once per run, without reacting to other tools", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "kujo-mod-hooks-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const h = host(project); const lifecycle = h.hooks[0];
  h.events.get("run_start")({ type: "run_start", sessionId: "fixture" });
  await lifecycle.afterToolCall({ toolCallId: "1", toolName: "shell_command", isError: true });
  assert.equal(await lifecycle.onStop(), undefined);
  await lifecycle.afterToolCall({ toolCallId: "2", toolName: "mcp__kujo__kujo_shipcheck_scan", isError: true });
  assert.equal((await lifecycle.onStop()).continue, true);
  assert.equal(await lifecycle.onStop(), undefined);
  await lifecycle.onRunEnd();
  h.events.get("run_start")({ type: "run_start", sessionId: "next-run" });
  assert.equal(await lifecycle.onStop(), undefined);
  await lifecycle.onRunEnd();
});

test("package migration removes only the owned bridge and retains agents and unrelated mods", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "kujo-mod-migration-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  assert.equal((await projectCommandCodeAssets(project)).length, 8);
  const bridge = join(project, ".commandcode", "mods", "kujo-command-bridge.ts");
  const unrelated = join(project, ".commandcode", "mods", "other.ts");
  await writeFile(unrelated, "keep");
  assert.equal((await projectCommandCodeAssets(project, "package")).length, 7);
  await assert.rejects(readFile(bridge), { code: "ENOENT" });
  assert.equal((await projectCommandCodeAssets(project, "package")).length, 7);
  assert.match(await readFile(join(project, ".commandcode", "agents", "kujo-reviewer.md"), "utf8"), /mcp__kujo__/);
  await removeCommandCodeAssets(project);
  assert.equal(await readFile(unrelated, "utf8"), "keep");
});

test("package mode refuses unowned bridge conflicts and invalid modes before writes", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "kujo-mod-conflict-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(join(project, ".commandcode", "mods"), { recursive: true });
  const bridge = join(project, ".commandcode", "mods", "kujo-command-bridge.ts");
  await writeFile(bridge, "user code");
  await assert.rejects(projectCommandCodeAssets(project, "package"), { code: "kujo_host_asset_conflict" });
  await assert.rejects(projectCommandCodeAssets(project, "invalid"), /mod mode/);
  assert.equal(await readFile(bridge, "utf8"), "user code");
});


test("standalone projected bridge keeps the legacy setup path", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "kujo-mod-projected-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await projectCommandCodeAssets(project);
  const { default: projected } = await createJiti(import.meta.url).import(join(project, ".commandcode", "mods", "kujo-command-bridge.ts"));
  const guide = (await host(project, [], projected).call("setup")).message;
  assert.match(guide, /npx @kujolang\/kujo-cmd@0\.3\.1 setup/);
  assert.match(guide, /first run cmd mods add/);
});


test("Watchdog requires configuration or explicit opt-in, and honors opt-out", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "kujo-mod-consent-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const previous = process.env.KUJO_CMD_WATCHDOG_URL;
  const consent = process.env.KUJO_CMD_WATCHDOG;
  process.env.KUJO_CMD_WATCHDOG_URL = "http://127.0.0.1:7700";
  delete process.env.KUJO_CMD_WATCHDOG;
  t.after(() => {
    process.env.KUJO_CMD_WATCHDOG_URL = previous;
    if (consent === undefined) delete process.env.KUJO_CMD_WATCHDOG;
    else process.env.KUJO_CMD_WATCHDOG = consent;
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("offline"); });
  const h = host(project);
  const run = async () => {
    h.events.get("run_start")({ type: "run_start", sessionId: "consent-test" });
    h.events.get("subagent_start")({ type: "subagent_start", toolCallId: "agent", subagentType: "review" });
    h.events.get("subagent_stop")({ type: "subagent_stop", toolCallId: "agent", subagentType: "review", tokensUsed: 1 });
    await h.hooks[0].afterToolCall({ toolCallId: "tool", toolName: "mcp__kujo__test", isError: true });
    assert.equal((await h.hooks[0].onStop()).continue, true);
    await h.hooks[0].onRunEnd();
  };
  await run();
  assert.equal(calls, 0);
  assert.deepEqual(await readdir(project), []);
  await mkdir(join(project, ".kujo"));
  const config = join(project, ".kujo", "cmd.json");
  for (const content of ["invalid JSON", "null", "{}", JSON.stringify({ schema: "other", profile: "review" })]) {
    await writeFile(config, content);
    await run();
    assert.equal(calls, 0);
    assert.deepEqual(await readdir(join(project, ".kujo")), ["cmd.json"]);
  }
  await writeFile(config, JSON.stringify({ schema: "kujo.cmd.config/v1", profile: "kujo.profile.review" }));
  await run();
  assert.ok(calls > 0);
  const spool = join(project, ".kujo", "watchdog-spool");
  assert.equal((await readdir(spool)).length, 6);
  const before = calls;
  process.env.KUJO_CMD_WATCHDOG = "0";
  await run();
  assert.equal(calls, before, "opt-out must prevent delivery and replay");
  await rm(config);
  delete process.env.KUJO_CMD_WATCHDOG;
  await run();
  assert.equal(calls, before, "removing configuration must disable replay and recording");
  process.env.KUJO_CMD_WATCHDOG = "1";
  await run();
  assert.ok(calls > before, "explicit opt-in enables unconfigured projects");
});

test("Watchdog only creates spool on delivery failure, bounds it, and replays it", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "kujo-mod-spool-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const previousUrl = process.env.KUJO_CMD_WATCHDOG_URL;
  const previousConsent = process.env.KUJO_CMD_WATCHDOG;
  process.env.KUJO_CMD_WATCHDOG_URL = "http://127.0.0.1:7700";
  process.env.KUJO_CMD_WATCHDOG = "1";
  t.after(() => {
    process.env.KUJO_CMD_WATCHDOG_URL = previousUrl;
    if (previousConsent === undefined) delete process.env.KUJO_CMD_WATCHDOG;
    else process.env.KUJO_CMD_WATCHDOG = previousConsent;
  });
  let status = 200; const delivered = [];
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    delivered.push(JSON.parse(opts.body));
    return { ok: status === 200, status };
  });
  const h = host(project);
  const run = async () => {
    h.events.get("run_start")({ type: "run_start", sessionId: "spool-test" });
    await h.hooks[0].onRunEnd();
  };
  await run();
  assert.equal(delivered.length, 2);
  assert.deepEqual(await readdir(project), [], "successful delivery needs no spool directory");
  status = 400;
  await run();
  assert.deepEqual(await readdir(project), [], "nonretryable failures must not spool");
  status = 503;
  await run();
  const spool = join(project, ".kujo", "watchdog-spool");
  const batch = await readFile(join(spool, (await readdir(spool))[0]), "utf8");
  await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(join(spool, `000-${i}.json`), batch)));
  await run();
  assert.equal((await readdir(spool)).length, 100);
  status = 200;
  delivered.length = 0;
  await run();
  assert.equal(delivered.length, 102);
  assert.deepEqual(await readdir(spool), []);
  for (const batch of delivered) {
    assert.deepEqual(batch.records[0].content, []);
    assert.equal(batch.records[0].privacy.content_mode, "off");
  }
});

test("setup ignore rule preserves content and line endings and is idempotent", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "kujo-ignore-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const path = join(project, ".gitignore");
  for (const content of ["", "node_modules/", "# user rules\r\nnode_modules/\r\n"]) {
    await writeFile(path, content);
    await configureWatchdogIgnore(project);
    const result = await readFile(path, "utf8");
    assert.ok(result.startsWith(content));
    assert.equal(result.split(/\r?\n/).filter(line => line === "/.kujo/watchdog-spool/").length, 1);
    if (content.includes("\r\n")) assert.ok(result.endsWith("/.kujo/watchdog-spool/\r\n"));
    await configureWatchdogIgnore(project);
    assert.equal(await readFile(path, "utf8"), result);
  }
  await rm(path);
  await configureWatchdogIgnore(project);
  assert.equal(await readFile(path, "utf8"), "/.kujo/watchdog-spool/\n");
});
