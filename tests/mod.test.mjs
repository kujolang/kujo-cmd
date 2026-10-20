import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";
import { projectCommandCodeAssets, removeCommandCodeAssets } from "../lib/install.mjs";

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
  assert.match(guide, /npx @kujolang\/kujo-cmd@0\.3\.0 setup/);
  assert.match(guide, /first run cmd mods add/);
});
