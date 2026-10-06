import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
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

function loopbackUrl(value) {
  const url = new URL(value || "http://127.0.0.1:7700");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw Object.assign(new Error("Watchdog URL must be unauthenticated loopback HTTP"), { code: "ability_url_forbidden" });
  }
  return url;
}

function watchdogId(value, length) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
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
      const url = loopbackUrl(input.url);
      const response = await fetch(new URL("/healthz", url), { signal: AbortSignal.timeout(5000), redirect: "error" });
      const text = await response.text(); return { url: url.origin, status: response.status, ok: response.ok, body: parsedOutput(text) || text };
    },
    concord: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); return executeCommand(kujoBinary, ["run", join(source("concord"), "concord.kujo"), "--interpreter", "--", "scan", "--dir", cwd, "--format", "json"], cwd, context); },
    casefile: async (input, context) => {
      const cwd = await safeExistingDirectory(project, input.path); const log = await safeExistingFile(cwd, input.log_file); const artifact = await safeOutputPath(cwd, input.output_dir || ".casefile/cases");
      const result = await executeCommand(kujoBinary, ["run", join(source("casefile"), "casefile.kujo"), "--interpreter", "--", "capture", "--name", input.name || "command-code-failure", "--from-log", log, "--output-dir", artifact, "--format", "json", ...(input.notes ? ["--notes", input.notes] : [])], cwd, context);
      return { ...result, artifacts: [artifact] };
    },
    muzzle: async (input, context) => {
      const cwd = await safeExistingDirectory(project, input.path); const args = ["run", join(source("muzzle"), "muzzle.kujo"), "--interpreter", "--", "run", input.workflow, ...(input.args || []), "--json", "--policy", "enforce", "--validate-args"];
      if (input.approve_network) args.push("--approve");
      return executeCommand(kujoBinary, args, cwd, context);
    },
    kennel_validate: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); return executeCommand(kujoBinary, ["run", join(source("kennel"), "kennel.kujo"), "--interpreter", "--", "validate", "--project-dir", cwd], cwd, context); },
    kennel_install: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); return executeCommand(kujoBinary, ["run", join(source("kennel"), "kennel.kujo"), "--interpreter", "--", "install", "--project-dir", cwd, ...(input.allow_mutable_ref ? ["--allow-mutable-ref"] : [])], cwd, context); },
    dispatch_run: async (input, context) => {
      const cwd = await safeExistingDirectory(project, input.path); const workflow = await safeExistingFile(cwd, input.workflow_file); const artifact = await safeOutputPath(cwd, input.output_dir || ".kujo/dispatch");
      let runInput; try { runInput = JSON.parse(input.input_json || "{}"); } catch { throw Object.assign(new Error("input_json must contain valid JSON"), { code: "ability_input_invalid" }); }
      if (!runInput || Array.isArray(runInput) || typeof runInput !== "object") throw Object.assign(new Error("input_json must contain a JSON object"), { code: "ability_input_invalid" });
      const result = await executeCommand(kujoBinary, ["run", join(source("dispatch"), "dispatch.kujo"), "--interpreter", "--", "run", input.topic, "--workflow-file", workflow, "--input-json", JSON.stringify(runInput), "--output-root", artifact, "--yes", "--non-interactive"], cwd, context);
      return { ...result, artifacts: [artifact] };
    },
    rag_ingest: async (input, context) => { const cwd = await safeExistingDirectory(project, input.path); const ingest = await safeExistingDirectory(cwd, input.ingest_path); return executeCommand(kujoBinary, ["run", join(source("rag"), "main.kujo"), "--interpreter", "--", "ingest", "--path", ingest, "--namespace", input.namespace || "default", "--recursive", input.recursive === false ? "false" : "true"], cwd, context); },
    watchdog_record: async (input) => {
      const url = loopbackUrl(input.url); const observedAt = new Date().toISOString(); const recordId = randomUUID(); const correlation = input.run_id || input.session_id || recordId;
      const references = [["session", input.session_id], ["run", input.run_id], ["agent", input.agent_id], ["tool_call", input.tool_call_id]].filter(([, id]) => id).map(([type, id]) => ({ type, id }));
      const status = input.status || "ok"; const outcome = status === "ok" ? "success" : status === "unset" ? "unknown" : status;
      const batch = { schema_version: "watchdog.telemetry.v2", batch_id: `kujo-cmd:${recordId}`, sent_at: observedAt, producer: { name: "kujo-cmd", version: config.version || "unknown", adapter_id: "kujo.cmd.mcp", adapter_version: "1.0.0", original_schema: "kujo.ability/v1" }, records: [{ record_id: recordId, record_type: "event", trace_id: watchdogId(correlation, 32), observed_at: observedAt, kind: "internal", name: input.name, status, source: { "watchdog.semantic_profile": "watchdog.observability.v1", "application.name": "kujo-cmd", "harness.name": "command-code", "instrumentation.name": "kujo.cmd.mcp", "instrumentation.version": "1.0.0" }, references, attributes: { "watchdog.outcome.code": outcome, "watchdog.outcome.terminal": true }, content: [], privacy: { content_mode: "off", policy_version: "watchdog.privacy.v1", transformations: ["metadata_only"] } }] };
      const headers = { "Content-Type": "application/json", ...(process.env.WDG_API_AUTH_TOKEN ? { Authorization: `Bearer ${process.env.WDG_API_AUTH_TOKEN}` } : {}) };
      const response = await fetch(new URL("/telemetry/v2/batches", url), { method: "POST", headers, body: JSON.stringify(batch), signal: AbortSignal.timeout(5000), redirect: "error" });
      const text = await response.text(); if (!response.ok) throw Object.assign(new Error(`Watchdog rejected telemetry with HTTP ${response.status}`), { code: "kujo_command_failed", details: { status: response.status, body: text.slice(0, 4096) } });
      return { url: url.origin, status: response.status, accepted: true, record_id: recordId, response: parsedOutput(text) || text };
    },
  };
}
