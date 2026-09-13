import { join } from "node:path";
import { run } from "./process.mjs";
import { readLastLines } from "./io.mjs";
import { safeExistingDirectory, safeExistingFile, safeOutputPath } from "./paths.mjs";

const MAX_COMMAND_OUTPUT_BYTES = 512 * 1024;
const MAX_DIAGNOSTIC_CHARS = 32 * 1024;

function parsedOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  const lines = trimmed.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) try { return JSON.parse(lines[index]); } catch {}
  return null;
}

async function executeCommand(binary, args, cwd, context, env = {}) {
  const outcome = await run(binary, args, { cwd, signal: context.signal, timeoutMs: 240_000, maxBytes: MAX_COMMAND_OUTPUT_BYTES, env: { ...process.env, ...env } });
  const structured = parsedOutput(outcome.stdout);
  const diagnostics = { exit_code: outcome.exitCode, stdout: outcome.stdout.slice(-MAX_DIAGNOSTIC_CHARS), stderr: outcome.stderr.slice(-MAX_DIAGNOSTIC_CHARS) };
  if (outcome.exitCode !== 0) throw Object.assign(new Error(`canonical Kujo command exited ${outcome.exitCode}`), { code: "kujo_command_failed", details: diagnostics });
  return { exit_code: outcome.exitCode, ...(structured === null ? { stdout: diagnostics.stdout } : { structured }), ...(diagnostics.stderr ? { stderr: diagnostics.stderr } : {}) };
}

function receiptView(receipt, includeResult) {
  if (includeResult) return receipt;
  const { result, error, ...summary } = receipt;
  return { ...summary, result: result === null ? null : { omitted: true }, error: error ? { code: error.code, message: error.message } : null };
}

export function handlers({ config, project, runtime }) {
  const kujoBinary = config.kujo_bin;
  const source = (id) => {
    const path = config.sources[id]?.path;
    if (!path) throw Object.assign(new Error(`Kujo source '${id}' is not installed`), { code: "ability_source_missing" });
    return path;
  };
  return {
    catalog: async () => ({ profile: config.profile, abilities: runtime.describe().map((item) => ({ id: item.definition.id, version: item.definition.version, title: item.definition.title, effects: item.definition.effects, digest: item.definitionDigest, tool: item.tool.name })) }),
    receipts: async (input) => {
      const limit = input.limit || 20;
      const lines = await readLastLines(config.receiptsPath, limit, 1024 * 1024);
      return { receipts: lines.map((line) => receiptView(JSON.parse(line), input.include_result === true)).reverse(), total_visible: lines.length, results_included: input.include_result === true };
    },
    scout: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); const artifact = await safeOutputPath(cwd, input.output_dir || ".kujo/scout"); const result = await executeCommand(kujoBinary, ["run", join(source("scout"), "scout.kujo"), "--interpreter", "--", cwd, "-o", artifact, ...(input.quick !== false ? ["--quick"] : [])], cwd, context); return { ...result, artifacts: [artifact] }; },
    scent: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); const artifact = await safeOutputPath(cwd, ".kujo/scent"); const result = await executeCommand(kujoBinary, ["run", join(source("scent"), "scent.kujo"), "--interpreter", "--", "pack", "--task", input.task, "--budget", String(input.budget || 12000), "--target", "generic", "--json", ...(input.dry_run ? ["--dry-run"] : ["--out", artifact, "--format", "both"])], cwd, context); return { ...result, artifacts: input.dry_run ? [] : [artifact] }; },
    patchbrief: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); return executeCommand(kujoBinary, ["run", join(source("patchbrief"), "patchbrief.kujo"), "--", "summarize", "--format", input.format || "json", ...(input.format === "markdown" ? [] : ["--pretty"])], cwd, context); },
    changebucket: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); const args = ["run", join(source("changebucket"), "changebucket.kujo"), "--", "--json", "--repo", cwd, "--base", input.base || "HEAD"]; if (input.max_files) args.push("--max-files", String(input.max_files)); if (input.max_churn) args.push("--max-churn", String(input.max_churn)); return executeCommand(kujoBinary, args, cwd, context); },
    shipcheck: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); return executeCommand(kujoBinary, ["run", join(source("shipcheck"), "shipcheck.kujo"), "--interpreter", "--", "scan", "--dir", cwd, "--format", "json"], cwd, context); },
    fence: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); return executeCommand(kujoBinary, ["run", join(source("fence"), "fence.kujo"), "--", "check", "--format", "json", ...(input.changed_only ? ["--changed-only"] : []), ...(input.baseline ? ["--baseline"] : [])], cwd, context); },
    spec: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); const file = await safeExistingFile(cwd, input.file); return executeCommand("bash", [join(source("spec"), "scripts", "spec"), "validate", file, "--json", ...(input.strict ? ["--strict"] : [])], cwd, context, { KUJO_BIN: kujoBinary }); },
    eval: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); const artifact = await safeOutputPath(cwd, input.output_dir || ".kujo/eval"); const configPath = await safeExistingFile(cwd, input.config); const result = await executeCommand(kujoBinary, ["run", join(source("eval"), "main.kujo"), "--interpreter", "--", "run", configPath, "--output-dir", artifact, "--json"], cwd, context); return { ...result, artifacts: [artifact] }; },
    runledger: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); return executeCommand(kujoBinary, ["run", join(source("runledger"), "runledger.kujo"), "--interpreter", "--", "report", ...(input.task ? ["--task", input.task] : [])], cwd, context); },
    dispatch: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); const workflow = await safeExistingFile(cwd, input.workflow_file); return executeCommand(kujoBinary, ["run", join(source("dispatch"), "dispatch.kujo"), "--interpreter", "--", "validate", "--workflow-file", workflow, "--json"], cwd, context); },
    rag: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); return executeCommand(kujoBinary, ["run", join(source("rag"), "main.kujo"), "--interpreter", "--", "query", "--question", input.question, "--namespace", input.namespace || "default"], cwd, context); },
    watchdog: async (input) => {
      const url = new URL(input.url || "http://127.0.0.1:7700");
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) || url.username || url.password) throw Object.assign(new Error("Watchdog URL must be unauthenticated loopback HTTP"), { code: "ability_url_forbidden" });
      const response = await fetch(new URL("/healthz", url), { signal: AbortSignal.timeout(5000), redirect: "error" });
      const text = await response.text(); return { url: url.origin, status: response.status, ok: response.ok, body: parsedOutput(text) || text };
    },
  };
}
