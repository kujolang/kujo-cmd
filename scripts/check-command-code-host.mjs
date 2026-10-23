import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { resolveKujoBinary } from "@kujolang/kujo-runtime";
import { loadCatalog } from "../lib/catalog.mjs";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "bin", "kujo-cmd.mjs");
const commandCode = process.env.COMMAND_CODE_BIN || "command-code";
// Opt-in workaround for the 1.85.1 CLI's key-presence preflight in local-only mode.
// The placeholder is not a credential; local-only refuses all backend routes.
const localOnly = process.env.KUJO_CMD_LOCAL_ONLY === "1";
const temporary = await mkdtemp(join(tmpdir(), "kujo-cmd-command-code-"));

try {
  const { stdout: versionOutput } = await exec(commandCode, ["--version"]);
  const version = versionOutput.trim().split(/\s+/).at(-1);
  assert.match(version, /^\d+\.\d+\.\d+$/, `unexpected Command Code version: ${versionOutput.trim()}`);
  if (process.env.COMMAND_CODE_EXPECTED_VERSION) assert.equal(version, process.env.COMMAND_CODE_EXPECTED_VERSION);

  const project = join(temporary, "project");
  const home = join(temporary, "home");
  await mkdir(project);
  await writeFile(join(project, "README.md"), "# Command Code compatibility fixture\n");
  await exec("git", ["init", "-q"], { cwd: project });
  await exec("git", ["add", "README.md"], { cwd: project });
  await exec("git", ["-c", "user.name=Kujo", "-c", "user.email=kujo@example.invalid", "commit", "-qm", "fixture"], { cwd: project });

  const catalog = await loadCatalog();
  const candidateSourceRoot = resolve(root, "..");
  const sourceRoot = process.env.KUJO_SOURCE_ROOT || (await localSourcesAvailable(candidateSourceRoot, catalog) ? candidateSourceRoot : null);
  const setupArgs = [cli, "setup", "--project", project, ...(sourceRoot ? ["--source-root", sourceRoot] : []), "--json"];
  const env = { ...process.env, KUJO_CMD_HOME: home, KUJO_BIN: resolveKujoBinary() };
  if (localOnly) {
    env.CMD_LOCAL_ONLY = "1";
    env.COMMAND_CODE_API_KEY = "local-only-placeholder";
  }
  const setup = JSON.parse((await exec(process.execPath, setupArgs, { cwd: root, env, timeout: 300_000 })).stdout);
  assert.equal(setup.ok, true);
  assert.equal(setup.abilities, 5);

  const mcp = (await exec(commandCode, ["mcp", "list"], { cwd: project, env })).stdout;
  assert.match(mcp, /\bkujo\b/);
  assert.match(mcp, /\benabled\b/);
  const skills = (await exec(commandCode, ["skills", "list", "--debug"], { cwd: project, env })).stdout;
  for (const name of ["kujo-patchbrief-workflows", "kujo-scout-workflows", "kujo-shipcheck-workflows"]) assert.match(skills, new RegExp(`\\b${name}\\b`));

  const executable = (await exec(process.platform === "win32" ? "where" : "which", [commandCode])).stdout.trim().split(/\r?\n/)[0];
  const commandPackage = resolve(dirname(await realpath(executable)), "..");
  const { createJiti } = await import(pathToFileURL(createRequire(join(commandPackage, "package.json")).resolve("jiti")));
  const projectedMod = join(project, ".commandcode", "mods", "kujo-command-bridge.ts");
  process.env.KUJO_CMD_WATCHDOG_URL = "invalid:";
  const loaded = await createJiti(import.meta.url).import(projectedMod);
  delete process.env.KUJO_CMD_WATCHDOG_URL;
  const hooks = []; const events = []; const subscribers = new Map();
  loaded.default({ cwd: project, addCommand() { return { dispose() {} }; }, hooks(value) { hooks.push(value); return { dispose() {} }; }, on(name, handler) { events.push(name); subscribers.set(name, handler); return { dispose() {} }; } });
  assert.ok(hooks.some((value) => value.afterToolCall && value.onStop && value.onRunEnd));
  assert.deepEqual(events.sort(), ["model_request_start", "run_start", "subagent_start", "subagent_stop"]);
  subscribers.get("run_start")({ type: "run_start", sessionId: "host-check" });
  const lifecycle = hooks.find((value) => value.afterToolCall && value.onStop);
  await lifecycle.afterToolCall({ toolCallId: "call-1", toolName: "mcp__kujo__kujo_shipcheck_scan", isError: true });
  assert.equal((await lifecycle.onStop()).continue, true);
  assert.equal(await lifecycle.onStop(), undefined);
  for (const name of ["kujo-context-builder.md", "kujo-reviewer.md", "kujo-workflow-operator.md", "kujo-release-verifier.md", "kujo-safety-evidence.md", "kujo-decision-reviewer.md", "kujo-browser-reviewer.md"]) {
    const agent = await readFile(join(project, ".commandcode", "agents", name), "utf8");
    assert.match(agent, /mcp__kujo__kujo_/); assert.doesNotMatch(agent, /tools:\s*["']?\*/);
  }

  // Exercise the distributable, not just the checkout: no dev dependencies or lifecycle scripts.
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, "run this check through npm run test:command-code");
  const packed = JSON.parse((await exec(process.execPath, [npmCli, "pack", root, "--pack-destination", temporary, "--ignore-scripts", "--json"], { cwd: root })).stdout)[0];
  const consumer = join(temporary, "consumer");
  await exec(process.execPath, [npmCli, "install", "--prefix", consumer, join(temporary, packed.filename), "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund"], { timeout: 180_000 });
  const installedPackage = join(consumer, "node_modules", "@kujolang", "kujo-cmd");
  const manifest = JSON.parse(await readFile(join(installedPackage, "package.json"), "utf8"));
  const installedEntry = resolve(installedPackage, manifest.commandcode.mods[0]);
  const added = (await exec(commandCode, ["mods", "add", installedPackage], { cwd: project, env })).stdout;
  assert.match(added, /Installed/);
  const settings = JSON.parse(await readFile(join(project, ".commandcode", "settings.json"), "utf8"));
  assert.ok(settings.mods.sources.length > 0);
  const migrated = JSON.parse((await exec(process.execPath, [join(installedPackage, "bin", "kujo-cmd.mjs"), "setup", "--project", project, "--mod-mode", "package", ...(sourceRoot ? ["--source-root", sourceRoot] : []), "--json"], { env, timeout: 300_000 })).stdout);
  assert.equal(migrated.mod_mode, "package"); assert.equal(migrated.host_assets, 7);
  await assert.rejects(readFile(projectedMod), { code: "ENOENT" });
  const unconfigured = join(temporary, "unconfigured");
  await mkdir(unconfigured);
  const unconfiguredEvents = new Map(); const unconfiguredHooks = [];
  const unconfiguredFactory = await createJiti(import.meta.url).import(installedEntry);
  unconfiguredFactory.default({ cwd: unconfigured,
    addCommand() { return { dispose() {} }; },
    hooks(value) { unconfiguredHooks.push(value); return { dispose() {} }; },
    on(name, handler) { unconfiguredEvents.set(name, handler); return { dispose() {} }; },
    getActiveTools() { return []; } });
  const priorConsent = process.env.KUJO_CMD_WATCHDOG;
  delete process.env.KUJO_CMD_WATCHDOG;
  try {
    unconfiguredEvents.get("run_start")({ type: "run_start", sessionId: "unconfigured-package" });
    await unconfiguredHooks[0].afterToolCall({ toolCallId: "fixture", toolName: "mcp__kujo__kujo_ability_catalog", isError: false });
    await unconfiguredHooks[0].onRunEnd();
    assert.deepEqual(await readdir(unconfigured), [], "packed mod must leave unconfigured projects untouched");
  } finally {
    if (priorConsent !== undefined) process.env.KUJO_CMD_WATCHDOG = priorConsent;
  }
  const commands = new Map();
  const packaged = await createJiti(import.meta.url).import(installedEntry);
  packaged.default({ cwd: project, addCommand(value) { commands.set(value.name, value); return { dispose() {} }; },
    hooks() { return { dispose() {} }; }, on() { return { dispose() {} }; }, getActiveTools() { return []; } });
  const guide = await commands.get("kujo").handler({ args: "setup" });
  assert.ok(guide.message.includes(join(installedPackage, "bin", "kujo-cmd.mjs")));
  const sessionStatus = await commands.get("kujo").handler({ args: "status" });
  assert.match(sessionStatus.message, /mod mode: package/);
  const inspection = (await exec(commandCode, ["mods", "inspect", installedEntry], { cwd: project, env })).stdout;
  assert.match(inspection, /slash command/);
  assert.match(inspection, /onStop/);

  let live = null;
  if (process.env.KUJO_CMD_LIVE_MODEL) {
    const evidencePath = join(temporary, "session-mod-evidence.json");
    const probePath = join(temporary, "kujo-session-probe.ts");
    await writeFile(probePath, `import {writeFile} from 'node:fs/promises';
export default function(cmd) {
  cmd.hooks({onRunEnd: async () => {
    await writeFile(${JSON.stringify(evidencePath)}, JSON.stringify({commands: cmd.getCommands(), tools: cmd.getActiveTools()}));
  }});
}
`);
    const liveOutput = (await exec(commandCode, [
      "-p",
      "Call the Kujo MCP tool named kujo_ability_catalog exactly once. Do not call any other tool. Then reply with only the count of returned abilities.",
      "--model", process.env.KUJO_CMD_LIVE_MODEL,
      ...(localOnly ? ["--local-only"] : []),
      "--mod", installedPackage,
      "--mod", probePath,
      "--max-turns", "3",
      "--output-format", "json",
      "--no-session",
      "--skip-onboarding",
      "--no-auto-update",
    ], { cwd: project, env, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 })).stdout;
    const events = liveOutput.trim().split(/\n/).map((line) => JSON.parse(line));
    const result = events.at(-1);
    assert.equal(result.type, "result");
    assert.equal(result.subtype, "success");
    assert.equal(result.finalText.trim(), "5");
    const calls = events.filter((event) => event.event?.type === "tool_completed" && event.event.toolName === "mcp__kujo__kujo_ability_catalog");
    assert.equal(calls.length, 1);
    const sessionEvidence = JSON.parse(await readFile(evidencePath, "utf8"));
    assert.equal(sessionEvidence.commands.filter((command) => command.name === "kujo").length, 1, "real host must register exactly one /kujo command");
    assert.ok(sessionEvidence.tools.includes("mcp__kujo__kujo_ability_catalog"), "real host did not activate the Kujo MCP catalog");
    live = { session_mod_registered: true, local_only: localOnly, local_key_placeholder: localOnly, model: process.env.KUJO_CMD_LIVE_MODEL, final_text: result.finalText.trim(), catalog_calls: calls.length };
  }

  process.stdout.write(`${JSON.stringify({ ok: true, command_code: version, abilities: setup.abilities, skills: setup.skills, mcp: "enabled", mod: "factory-tested", packed_mod: "installed-and-migrated", unconfigured_project: "untouched", interactive_session: "not-tested", agents: 7, live }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function localSourcesAvailable(sourceRoot, catalog) {
  try {
    await Promise.all(catalog.sources.map((source) => readFile(join(sourceRoot, source.id, ".git", "HEAD"))));
    return true;
  } catch {
    return false;
  }
}
