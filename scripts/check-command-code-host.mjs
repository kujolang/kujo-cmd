import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  const { createJiti } = await import(pathToFileURL(join(commandPackage, "node_modules", "jiti", "lib", "jiti.mjs")));
  const projectedMod = join(project, ".commandcode", "mods", "kujo-command-bridge.ts");
  process.env.KUJO_CMD_WATCHDOG_URL = "invalid:";
  const loaded = await createJiti(import.meta.url).import(projectedMod);
  delete process.env.KUJO_CMD_WATCHDOG_URL;
  const hooks = []; const events = []; const subscribers = new Map();
  loaded.default({ hooks(value) { hooks.push(value); return { dispose() {} }; }, on(name, handler) { events.push(name); subscribers.set(name, handler); return { dispose() {} }; } });
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

  let live = null;
  if (process.env.KUJO_CMD_LIVE_MODEL) {
    const liveOutput = (await exec(commandCode, [
      "-p",
      "Call the Kujo MCP tool named kujo_ability_catalog exactly once. Do not call any other tool. Then reply with only the count of returned abilities.",
      "--model", process.env.KUJO_CMD_LIVE_MODEL,
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
    live = { model: process.env.KUJO_CMD_LIVE_MODEL, final_text: result.finalText.trim(), catalog_calls: calls.length };
  }

  process.stdout.write(`${JSON.stringify({ ok: true, command_code: version, abilities: setup.abilities, skills: setup.skills, mcp: "enabled", mod: "loaded", agents: 7, live }, null, 2)}\n`);
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
