#!/usr/bin/env node
import { access, mkdir, rm } from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { createApp, loadProjectConfig } from "../lib/app.mjs";
import { loadCatalog, profileAbilities } from "../lib/catalog.mjs";
import { configureMcp, installProjection, installSources, projectSkills, removeMcp, removeProjectedSkills } from "../lib/install.mjs";
import { loadInstallation, writeInstallation } from "../lib/installation.mjs";
import { readJson, writeJson } from "../lib/io.mjs";
import { assertSafePurgeRoot, homePaths, packageRoot, projectPaths } from "../lib/paths.mjs";
import { run } from "../lib/process.mjs";

const VERSION = "0.1.0";
const command = process.argv[2] || "help";

function options(values) {
  const result = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) { result._.push(value); continue; }
    const [key, inline] = value.slice(2).split("=", 2);
    if (["json", "force", "purge", "dry-run"].includes(key)) result[key] = true;
    else { const next = inline ?? values[++index]; if (!next || next.startsWith("--")) throw new Error(`missing value for --${key}`); result[key] = next; }
  }
  return result;
}

function output(value, json = false) {
  if (json) return process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.stdout.write(`${value.message || "OK"}\n`);
  for (const [key, item] of Object.entries(value)) if (!["ok", "message"].includes(key)) process.stdout.write(`${key}: ${Array.isArray(item) ? item.join(", ") : typeof item === "object" ? JSON.stringify(item) : item}\n`);
}

async function exists(path) { try { await access(path); return true; } catch { return false; } }

async function setup(opts) {
  const catalog = await loadCatalog(); const project = resolve(opts.project || process.cwd());
  const profile = opts.profile || "kujo.profile.essentials";
  profileAbilities(catalog, profile);
  if (opts["dry-run"]) return output({ ok: true, message: "Kujo CMD setup validated (dry run).", project, profile, source_count: catalog.sources.length }, opts.json);
  const sources = await installSources(catalog, { sourceRoot: opts["source-root"], force: opts.force });
  const kujoBin = process.env.KUJO_BIN || (await import("@kujolang/kujo-runtime")).resolveKujoBinary();
  const projection = await installProjection(VERSION, kujoBin);
  const installedAt = new Date().toISOString();
  const installation = await writeInstallation({ version: VERSION, sources, projection_root: projection.root, kujo_bin: projection.kujo, installed_at: installedAt });
  const paths = projectPaths(project); const config = { schema: "kujo.cmd.config/v1", version: VERSION, installation_version: VERSION, profile, enabled: [], disabled: [], installed_at: installedAt };
  await writeJson(paths.config, config);
  const trustedConfig = { ...config, ...installation };
  const skills = await projectSkills(catalog, trustedConfig, project); const mcp = await configureMcp(trustedConfig, project);
  const app = await createApp(project); const smoke = await app.runtime.execute({ abilityId: "kujo.ability.catalog.list", input: {}, controls: { host: "command-code", surface: "mcp", invocationId: `setup-${Date.now()}` } });
  if (!smoke.ok) throw new Error("local Ability smoke test failed");
  return output({ ok: true, message: "Kujo is ready in Command Code.", project, profile, abilities: app.runtime.describe().length, skills: skills.length, mcp, execution: "local-stdio", hosted_service_required: false }, opts.json);
}

async function status(opts) {
  const project = resolve(opts.project || process.cwd()); const paths = projectPaths(project);
  if (!await exists(paths.config)) return output({ ok: false, message: "Kujo CMD is not configured in this project.", project }, opts.json);
  const { config } = await loadProjectConfig(project);
  const app = await createApp(project);
  return output({ ok: true, message: "Kujo CMD is configured.", version: config.version, profile: config.profile, abilities: app.runtime.describe().length, sources: Object.keys(config.sources).length, mcp_configured: await exists(paths.mcp), receipts: homePaths().receipts }, opts.json);
}

async function doctor(opts) {
  const project = resolve(opts.project || process.cwd());
  let config = null; let configurationError = "";
  try { ({ config } = await loadProjectConfig(project)); } catch (error) { configurationError = error.message; }
  const checks = [];
  checks.push({ name: "configuration", ok: Boolean(config), ...(configurationError ? { error: configurationError } : {}) });
  checks.push({ name: "generated-runtime", ok: await exists(join(packageRoot, ".generated", "local-runtime.mjs")) });
  if (config) for (const [id, source] of Object.entries(config.sources)) {
    let ok = await exists(source.path); let actual = null;
    if (ok && source.mode === "pinned") { try { actual = (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"], { cwd: source.path, encoding: "utf8" }).trim(); ok = actual === source.commit; } catch { ok = false; } }
    checks.push({ name: `source:${id}`, ok, commit: source.commit, ...(actual ? { actual_commit: actual } : {}) });
  }
  try { const runtime = config?.kujo_bin || process.env.KUJO_BIN || (await import("@kujolang/kujo-runtime")).resolveKujoBinary(); checks.push({ name: "kujo-runtime", ok: await exists(runtime), path: runtime }); } catch (error) { checks.push({ name: "kujo-runtime", ok: false, error: error.message }); }
  checks.push({ name: "command-code", ok: await commandAvailable("command-code") || await commandAvailable("cmd") });
  const ok = checks.every((check) => check.ok);
  output({ ok, message: ok ? "Kujo CMD diagnostics passed." : "Kujo CMD diagnostics found problems.", checks }, opts.json);
  if (!ok) process.exitCode = 1;
}

async function commandAvailable(name) { const path = (process.env.PATH || "").split(process.platform === "win32" ? ";" : ":"); return (await Promise.all(path.map((part) => exists(join(part, process.platform === "win32" ? `${name}.exe` : name))))).some(Boolean); }

async function profiles(opts) {
  const catalog = await loadCatalog(); const project = resolve(opts.project || process.cwd()); const current = await exists(projectPaths(project).config) ? (await loadProjectConfig(project, catalog)).projectConfig : null;
  output({ ok: true, message: "Portable Kujo Ability profiles.", current: current?.profile || null, profiles: catalog.profiles.map((profile) => ({ id: profile.id, label: profile.metadata.label, description: profile.description, default: profile.default })) }, opts.json);
}

async function abilities(opts) {
  const catalog = await loadCatalog(); const project = resolve(opts.project || process.cwd()); const config = await exists(projectPaths(project).config) ? (await loadProjectConfig(project, catalog)).projectConfig : null;
  const active = config ? new Set(profileAbilities(catalog, config.profile, config.enabled, config.disabled).map((item) => item.definition.id)) : new Set();
  output({ ok: true, message: "Kujo Ability catalog.", abilities: catalog.abilities.map((item) => ({ id: item.definition.id, tool: item.tool.name, effects: item.definition.effects.map((effect) => effect.kind), active: active.has(item.definition.id) })) }, opts.json);
}

async function select(opts, enable) {
  const id = opts._[0]; if (!id) throw new Error(`usage: kujo-cmd ${enable ? "enable" : "disable"} <ability-id>`);
  const project = resolve(opts.project || process.cwd()); const { config, projectConfig, paths } = await loadProjectConfig(project);
  const catalog = await loadCatalog(); if (!catalog.abilities.some((item) => item.definition.id === id)) throw new Error(`unknown Ability: ${id}`);
  projectConfig.enabled = (projectConfig.enabled || []).filter((value) => value !== id); projectConfig.disabled = (projectConfig.disabled || []).filter((value) => value !== id);
  (enable ? projectConfig.enabled : projectConfig.disabled).push(id); await writeJson(paths.config, projectConfig);
  const next = { ...config, ...projectConfig }; const skills = await projectSkills(catalog, next, project);
  output({ ok: true, message: `${id} ${enable ? "enabled" : "disabled"}.`, profile: next.profile, skills }, opts.json);
}

async function setProfile(opts) {
  const id = opts._[0]; if (!id) throw new Error("usage: kujo-cmd profile <profile-id>");
  const project = resolve(opts.project || process.cwd()); const { config, projectConfig, paths } = await loadProjectConfig(project);
  const catalog = await loadCatalog(); profileAbilities(catalog, id); projectConfig.profile = id; await writeJson(paths.config, projectConfig); const next = { ...config, ...projectConfig }; const skills = await projectSkills(catalog, next, project);
  output({ ok: true, message: `Active profile changed to ${id}.`, abilities: profileAbilities(catalog, id, next.enabled, next.disabled).length, skills }, opts.json);
}

async function approve(opts) {
  if (!opts.ability || !opts.invocation || !opts.input) throw new Error("approve requires --ability, --invocation, and --input JSON");
  const input = JSON.parse(opts.input); const app = await createApp(resolve(opts.project || process.cwd()));
  const approval = await app.runtime.requestApproval({ abilityId: opts.ability, input, invocationId: opts.invocation, principal: { type: "workload", id: "command-code", tenant_id: "local", claims: {} } });
  output({ ok: true, message: "One-time approval issued. Pass its ID in _kujo.approvalId with the same invocation ID and input.", approval_id: approval.approval_id, expires_at_ms: approval.expires_at_ms }, opts.json);
}

async function services(opts) {
  const action = opts._[0] || "status"; const name = opts._[1] || "watchdog"; if (name !== "watchdog") throw new Error("only the optional watchdog service is supported");
  const home = homePaths(); const state = await readJson(home.services, {}); const current = state.watchdog;
  if (action === "status") { const running = await watchdogProcessMatches(current); return output({ ok: true, message: running ? "Watchdog is running." : "Watchdog is stopped.", service: "watchdog", running, pid: running ? current.pid : null, stale_state: Boolean(current && !running), url: "http://127.0.0.1:7700" }, opts.json); }
  if (action === "stop") { const running = await watchdogProcessMatches(current); if (running) process.kill(current.pid, "SIGTERM"); delete state.watchdog; await writeJson(home.services, state); return output({ ok: true, message: running ? "Watchdog stop requested." : "Stale Watchdog state cleared without signaling another process." }, opts.json); }
  if (action !== "start") throw new Error("services action must be status, start, or stop");
  if (await watchdogProcessMatches(current)) return output({ ok: true, message: "Watchdog is already running.", pid: current.pid, url: "http://127.0.0.1:7700" }, opts.json);
  const { config } = await loadProjectConfig(resolve(opts.project || process.cwd())); if (!config?.sources?.watchdog) throw new Error("Watchdog source is not installed");
  const runtime = config.kujo_bin; const serviceRoot = join(home.root, "watchdog"); await mkdir(join(serviceRoot, "data", "backups"), { recursive: true });
  const log = join(home.root, "watchdog.log"); const out = openSync(log, "a");
  const watchdogRoot = config.sources.watchdog.path;
  const script = join(watchdogRoot, "dashboard_server.kujo");
  const child = spawn(runtime, ["run", "--interpreter", script], { cwd: watchdogRoot, detached: true, stdio: ["ignore", out, out], env: { ...process.env, WDG_HOST: "127.0.0.1", WDG_PORT: "7700", WDG_DB_PATH: join(serviceRoot, "data", "watchdog.db"), WDG_PROXY_CONFIG_PATH: join(serviceRoot, "proxy.json"), WDG_SOURCES_CONFIG_PATH: join(serviceRoot, "sources.json"), WDG_EXPORTERS_CONFIG_PATH: join(serviceRoot, "exporters.json"), WDG_BACKUP_DIR: join(serviceRoot, "data", "backups"), WDG_BACKUP_SCRIPT_PATH: join(watchdogRoot, "scripts", "watchdog_backup.js"), WDG_DITHER_CHARTS_JS_PATH: join(watchdogRoot, "vendor", "dither-charts.js"), WDG_DITHER_CHARTS_CSS_PATH: join(watchdogRoot, "vendor", "dither-charts.css"), WDG_DEPARTURE_MONO_PATH: join(watchdogRoot, "vendor", "fonts", "DepartureMono-Regular.woff2"), WDG_CONTEXT_LIMIT_CATALOG_PATH: join(watchdogRoot, "config", "context_limit_catalog.json") } }); closeSync(out); child.unref();
  let spawnError = null; child.once("error", (error) => { spawnError = error; });
  let healthy = false;
  for (let attempt = 0; attempt < 30 && !spawnError; attempt += 1) { try { const response = await fetch("http://127.0.0.1:7700/healthz", { signal: AbortSignal.timeout(500) }); if (response.ok) { healthy = true; break; } } catch {} await new Promise((resolveWait) => setTimeout(resolveWait, 250)); }
  if (!healthy) { try { process.kill(child.pid, "SIGTERM"); } catch {} throw new Error(spawnError ? `Watchdog failed to start: ${spawnError.message}` : `Watchdog did not become healthy; inspect ${log}`); }
  state.watchdog = { pid: child.pid, started_at: new Date().toISOString(), log, script }; await writeJson(home.services, state);
  output({ ok: true, message: "Optional local Watchdog started.", pid: child.pid, url: "http://127.0.0.1:7700", log }, opts.json);
}

async function watchdogProcessMatches(current) {
  if (!Number.isSafeInteger(current?.pid) || current.pid <= 0 || typeof current.script !== "string") return false;
  try { process.kill(current.pid, 0); } catch { return false; }
  const outcome = process.platform === "win32"
    ? await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${current.pid}').CommandLine`], { timeoutMs: 5_000, maxBytes: 64 * 1024 })
    : await run("ps", ["-p", String(current.pid), "-o", "command="], { timeoutMs: 5_000, maxBytes: 64 * 1024 });
  return outcome.exitCode === 0 && outcome.stdout.includes(current.script);
}

async function repair(opts) { const project = resolve(opts.project || process.cwd()); const catalog = await loadCatalog(); const { config } = await loadProjectConfig(project, catalog); const skills = await projectSkills(catalog, config, project); const mcp = await configureMcp(config, project); output({ ok: true, message: "Kujo CMD projections repaired.", skills, mcp }, opts.json); }

async function update(opts) {
  const catalog = await loadCatalog();
  const project = resolve(opts.project || process.cwd()); const { projectConfig, installation, paths } = await loadProjectConfig(project, catalog);
  const localSources = Object.values(installation.sources || {}).every((source) => source.mode === "local");
  const sources = localSources && !opts["source-root"] ? installation.sources : await installSources(catalog, { sourceRoot: opts["source-root"], force: !opts["source-root"] });
  let runtime = process.env.KUJO_BIN;
  if (!runtime) {
    try { runtime = (await import("@kujolang/kujo-runtime")).resolveKujoBinary(); }
    catch { runtime = installation.kujo_bin; }
  }
  const projection = await installProjection(VERSION, runtime);
  const updatedAt = new Date().toISOString();
  const nextInstallation = await writeInstallation({ version: VERSION, sources, projection_root: projection.root, kujo_bin: projection.kujo, installed_at: installation.installed_at, updated_at: updatedAt });
  const nextProject = { ...projectConfig, version: VERSION, installation_version: VERSION, updated_at: updatedAt }; await writeJson(paths.config, nextProject);
  const config = { ...nextProject, ...nextInstallation };
  const skills = await projectSkills(catalog, config, project); const mcp = await configureMcp(config, project);
  output({ ok: true, message: "Kujo CMD updated without changing profile exposure.", profile: config.profile, enabled: config.enabled, disabled: config.disabled, skills, mcp }, opts.json);
}

async function uninstall(opts) {
  const project = resolve(opts.project || process.cwd()); const paths = projectPaths(project); const catalog = await loadCatalog();
  if (opts.purge) await loadInstallation(catalog);
  await removeMcp(project); await removeProjectedSkills(catalog, project); await rm(paths.config, { force: true }); await rm(paths.projectionManifest, { force: true });
  if (opts.purge) await rm(assertSafePurgeRoot(homePaths().root), { recursive: true, force: true });
  output({ ok: true, message: `Kujo CMD removed from ${project}.${opts.purge ? " Shared local sources and receipts were purged." : " Shared local sources and receipts were preserved."}` }, opts.json);
}

function help() { process.stdout.write(`Kujo CMD ${VERSION}\n\nUsage: kujo-cmd <command> [options]\n\nCommands:\n  setup       Install every supported Kujo source locally and configure Command Code\n  doctor      Verify runtime, source, configuration, and host readiness\n  status      Show the active local installation\n  profiles    List portable Ability profiles\n  profile ID  Select the active profile\n  abilities   List installed and active Abilities\n  enable ID   Add one Ability to the active exposure\n  disable ID  Hide one Ability from the active exposure\n  approve     Issue a request-bound, one-time approval\n  services    status|start|stop [watchdog]\n  update      Refresh all pinned local sources\n  repair      Restore MCP and skill projections\n  uninstall   Remove project projections; add --purge for shared data\n\nOptions:\n  --project DIR      Target project (default current directory)\n  --profile ID       Setup profile (default kujo.profile.essentials)\n  --source-root DIR  Use local Kujo checkouts (development/offline setup)\n  --force            Reacquire pinned sources\n  --json             Machine-readable output\n`); }

try {
  const opts = options(process.argv.slice(3));
  if (command === "setup") await setup(opts); else if (command === "doctor") await doctor(opts); else if (command === "status") await status(opts); else if (command === "profiles") await profiles(opts); else if (command === "profile") await setProfile(opts); else if (command === "abilities") await abilities(opts); else if (command === "enable") await select(opts, true); else if (command === "disable") await select(opts, false); else if (command === "approve") await approve(opts); else if (command === "services") await services(opts); else if (command === "update") await update(opts); else if (command === "repair") await repair(opts); else if (command === "uninstall") await uninstall(opts); else if (["help", "--help", "-h"].includes(command)) help(); else if (["version", "--version", "-v"].includes(command)) process.stdout.write(`kujo-cmd ${VERSION}\n`); else throw new Error(`unknown command: ${command}`);
} catch (error) { process.stderr.write(`error: ${error.message}\n`); process.exitCode = 1; }
