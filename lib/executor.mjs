import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { run } from "./process.mjs";
import { readLines } from "./io.mjs";

async function kujoBinary() {
  if (process.env.KUJO_BIN) return process.env.KUJO_BIN;
  try { return (await import("@kujolang/kujo-runtime")).resolveKujoBinary(); }
  catch { return "kujo"; }
}

async function safeWorkspace(project, requested = ".") {
  const path = resolve(project, requested);
  const rel = relative(project, path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw Object.assign(new Error("path must stay within the configured project"), { code: "ability_path_forbidden" });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Object.assign(new Error("path must be a real directory"), { code: "ability_path_invalid" });
  return path;
}

function contained(workspace, requested) {
  const path = resolve(workspace, requested);
  const rel = relative(workspace, path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw Object.assign(new Error("file path must stay inside the workspace"), { code: "ability_path_forbidden" });
  return path;
}

function parsedOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  const lines = trimmed.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) try { return JSON.parse(lines[index]); } catch {}
  return null;
}

async function executeCommand(binary, args, cwd, context, env = {}) {
  const outcome = await run(binary, args, { cwd, signal: context.signal, timeoutMs: 240_000, env: { ...process.env, ...env } });
  const result = { command: [binary, ...args], exit_code: outcome.exitCode, stdout: outcome.stdout, stderr: outcome.stderr, structured: parsedOutput(outcome.stdout) };
  if (outcome.exitCode !== 0) throw Object.assign(new Error(`canonical Kujo command exited ${outcome.exitCode}`), { code: "kujo_command_failed", details: result });
  return result;
}

export function handlers({ config, project, runtime }) {
  const source = (id) => {
    const path = config.sources[id]?.path;
    if (!path) throw Object.assign(new Error(`Kujo source '${id}' is not installed`), { code: "ability_source_missing" });
    return path;
  };
  const kujo = () => config.kujo_bin || kujoBinary();
  return {
    catalog: async () => ({ profile: config.profile, abilities: runtime.describe().map((item) => ({ id: item.definition.id, version: item.definition.version, title: item.definition.title, effects: item.definition.effects, digest: item.definitionDigest, tool: item.tool.name })) }),
    receipts: async (input) => {
      const lines = await readLines(config.receiptsPath); const limit = input.limit || 20;
      return { receipts: lines.slice(-limit).map((line) => JSON.parse(line)).reverse(), total_visible: Math.min(lines.length, limit) };
    },
    scout: async (input, context) => { const cwd = await safeWorkspace(project, input.path); const artifact = contained(cwd, input.output_dir || ".kujo/scout"); const result = await executeCommand(await kujo(), ["run", join(source("scout"), "scout.kujo"), "--interpreter", "--", cwd, "-o", artifact, ...(input.quick !== false ? ["--quick"] : [])], cwd, context); return { ...result, artifacts: [artifact] }; },
    scent: async (input, context) => { const cwd = await safeWorkspace(project, input.path); const artifact = contained(cwd, ".kujo/scent"); const result = await executeCommand(await kujo(), ["run", join(source("scent"), "scent.kujo"), "--interpreter", "--", "pack", "--task", input.task, "--budget", String(input.budget || 12000), "--target", "generic", "--json", ...(input.dry_run ? ["--dry-run"] : ["--out", artifact, "--format", "both"])], cwd, context); return { ...result, artifacts: input.dry_run ? [] : [artifact] }; },
    patchbrief: async (input, context) => { const cwd = await safeWorkspace(project, input.path); return executeCommand(await kujo(), ["run", join(source("patchbrief"), "patchbrief.kujo"), "--", "summarize", "--format", input.format || "json", ...(input.format === "markdown" ? [] : ["--pretty"])], cwd, context); },
    changebucket: async (input, context) => { const cwd = await safeWorkspace(project, input.path); const args = ["run", join(source("changebucket"), "changebucket.kujo"), "--", "--json", "--repo", cwd, "--base", input.base || "HEAD"]; if (input.max_files) args.push("--max-files", String(input.max_files)); if (input.max_churn) args.push("--max-churn", String(input.max_churn)); return executeCommand(await kujo(), args, cwd, context); },
    shipcheck: async (input, context) => { const cwd = await safeWorkspace(project, input.path); return executeCommand(await kujo(), ["run", join(source("shipcheck"), "shipcheck.kujo"), "--interpreter", "--", "scan", "--dir", cwd, "--format", "json"], cwd, context); },
    fence: async (input, context) => { const cwd = await safeWorkspace(project, input.path); return executeCommand(await kujo(), ["run", join(source("fence"), "fence.kujo"), "--", "check", "--format", "json", ...(input.changed_only ? ["--changed-only"] : []), ...(input.baseline ? ["--baseline"] : [])], cwd, context); },
    spec: async (input, context) => { const cwd = await safeWorkspace(project, input.path); return executeCommand("bash", [join(source("spec"), "scripts", "spec"), "validate", contained(cwd, input.file), "--json", ...(input.strict ? ["--strict"] : [])], cwd, context, { KUJO_BIN: await kujo() }); },
    eval: async (input, context) => { const cwd = await safeWorkspace(project, input.path); const artifact = contained(cwd, input.output_dir || ".kujo/eval"); const result = await executeCommand(await kujo(), ["run", join(source("eval"), "main.kujo"), "--interpreter", "--", "run", contained(cwd, input.config), "--output-dir", artifact, "--json"], cwd, context); return { ...result, artifacts: [artifact] }; },
    runledger: async (input, context) => { const cwd = await safeWorkspace(project, input.path); return executeCommand(await kujo(), ["run", join(source("runledger"), "runledger.kujo"), "--interpreter", "--", "report", ...(input.task ? ["--task", input.task] : [])], cwd, context); },
    dispatch: async (input, context) => { const cwd = await safeWorkspace(project, input.path); return executeCommand(await kujo(), ["run", join(source("dispatch"), "dispatch.kujo"), "--interpreter", "--", "validate", "--workflow-file", contained(cwd, input.workflow_file), "--json"], cwd, context); },
    rag: async (input, context) => { const cwd = await safeWorkspace(project, input.path); return executeCommand(await kujo(), ["run", join(source("rag"), "main.kujo"), "--interpreter", "--", "query", "--question", input.question, "--namespace", input.namespace || "default"], cwd, context); },
    watchdog: async (input) => {
      const url = new URL(input.url || "http://127.0.0.1:7700");
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) || url.username || url.password) throw Object.assign(new Error("Watchdog URL must be unauthenticated loopback HTTP"), { code: "ability_url_forbidden" });
      const response = await fetch(new URL("/healthz", url), { signal: AbortSignal.timeout(5000), redirect: "error" });
      const text = await response.text(); return { url: url.origin, status: response.status, ok: response.ok, body: parsedOutput(text) || text };
    },
  };
}
