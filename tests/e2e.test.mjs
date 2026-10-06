import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(".");
const packageRoot = root;
const cli = join(packageRoot, "bin", "kujo-cmd.mjs");
const server = join(packageRoot, "bin", "kujo-cmd-mcp.mjs");
const sourceRoot = process.env.KUJO_SOURCE_ROOT ? resolve(process.env.KUJO_SOURCE_ROOT) : resolve(root, "..");
const kujo = process.env.KUJO_BIN
  ? resolve(process.env.KUJO_BIN)
  : (await import("@kujolang/kujo-runtime")).resolveKujoBinary();

function rpcProcess(env) {
  const child = spawn(process.execPath, [server], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map(); let next = 1; let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
  createInterface({ input: child.stdout }).on("line", (line) => { const message = JSON.parse(line); pending.get(message.id)?.(message); pending.delete(message.id); });
  return {
    request(method, params = {}) { const id = next++; child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); return new Promise((resolveMessage, reject) => { pending.set(id, resolveMessage); setTimeout(() => reject(new Error(`RPC timeout: ${method}; ${stderr}`)), 30_000).unref(); }); },
    close() { child.stdin.end(); child.kill("SIGTERM"); },
  };
}

const temporary = await mkdtemp(join(tmpdir(), "kujo-cmd-real-"));
const project = join(temporary, "project"); const home = join(temporary, "home"); await mkdir(project); await mkdir(home);
await writeFile(join(project, "README.md"), "# Fixture\n"); await writeFile(join(project, "LICENSE"), "MIT\n"); await writeFile(join(project, "VERSION"), "0.1.0\n"); await writeFile(join(project, "CHANGELOG.md"), "# Changelog\n"); await mkdir(join(project, "tests")); await writeFile(join(project, "tests", "smoke.test.js"), "// test\n");
await exec("git", ["init", "-q"], { cwd: project }); await exec("git", ["add", "."], { cwd: project }); await exec("git", ["-c", "user.name=Kujo", "-c", "user.email=kujo@example.invalid", "commit", "-qm", "fixture"], { cwd: project }); await writeFile(join(project, "README.md"), "# Fixture\n\nChanged.\n");
await exec(process.execPath, [join(packageRoot, "scripts", "build-release.mjs")]);
const env = { KUJO_CMD_HOME: home, KUJO_CMD_PROJECT: project, KUJO_BIN: kujo };
const localCatalogAvailable = ["ability", "scout", "scent", "patchbrief", "changebucket", "shipcheck", "dispatch", "runledger", "watchdog", "rag", "fence", "spec", "eval", "kujo-skills", "casefile", "concord", "muzzle", "kennel", "redact", "versionseal", "packwrite", "tribunal", "dossier", "howl"]
  .every((source) => existsSync(join(sourceRoot, source)));
const setupArgs = [cli, "setup", "--project", project, ...(localCatalogAvailable ? ["--source-root", sourceRoot] : []), "--json"];
const setup = JSON.parse((await exec(process.execPath, setupArgs, { env: { ...process.env, ...env }, timeout: 180_000 })).stdout);
assert.equal(setup.ok, true); assert.equal(setup.hosted_service_required, false); assert.equal(setup.abilities, 5);
const installation = JSON.parse(await readFile(join(home, "installation.json"), "utf8"));
await exec(kujo, ["run", join(installation.sources.dossier.path, "dossier.kujo"), "--interpreter", "--", "init", "--state", join(project, ".dossier-e2e"), "--json"], { cwd: project });

let rpc = rpcProcess(env);
let message = await rpc.request("initialize", { protocolVersion: "1900-01-01" }); assert.equal(message.error.code, -32602);
message = await rpc.request("initialize", { protocolVersion: "2025-11-25" }); assert.equal(message.result.serverInfo.name, "kujo-cmd");
message = await rpc.request("tools/list"); assert.equal(message.result.tools.length, 5); assert.ok(message.result.tools.every((tool) => tool._meta["kujo/abilityId"]));
const [catalog, patchbrief] = await Promise.all([
  rpc.request("tools/call", { name: "kujo_ability_catalog", arguments: { _kujo: { sessionId: "session-a", runId: "run-a", modelId: "ollama/glm-5.3:cloud" } } }),
  rpc.request("tools/call", { name: "kujo_patchbrief_summarize", arguments: { path: ".", format: "json", _kujo: { traceId: "trace-patchbrief" } } }),
]);
assert.equal(catalog.result.structuredContent.ok, true); assert.equal(catalog.result.structuredContent.receipt.metadata.model_id, "ollama/glm-5.3:cloud");
assert.equal(patchbrief.result.structuredContent.ok, true, JSON.stringify(patchbrief.result.structuredContent)); assert.equal(patchbrief.result.structuredContent.receipt.result.exit_code, 0);

const scoutInput = { path: ".", quick: true, output_dir: ".kujo/scout" };
message = await rpc.request("tools/call", { name: "kujo_scout_inspect", arguments: { ...scoutInput, _kujo: { invocationId: "scout-1", idempotencyKey: "scout-key" } } });
assert.equal(message.result.structuredContent.code, "ability_approval_required");
const approval = JSON.parse((await exec(process.execPath, [cli, "approve", "--project", project, "--ability", "kujo.scout.repository.inspect", "--invocation", "scout-1", "--input", JSON.stringify(scoutInput), "--json"], { env: { ...process.env, ...env } })).stdout);
message = await rpc.request("tools/call", { name: "kujo_scout_inspect", arguments: { ...scoutInput, _kujo: { invocationId: "scout-1", idempotencyKey: "scout-key", approvalId: approval.approval_id } } });
assert.equal(message.result.structuredContent.ok, true, JSON.stringify(message.result.structuredContent)); assert.equal(message.result.structuredContent.receipt.approval_id, approval.approval_id);
const receiptId = message.result.structuredContent.receipt.receipt_id;
rpc.close();

await writeFile(join(project, "bad.spec.yml"), "name: missing-goal\n");
await writeFile(join(project, "decision.md"), "# Adopt bounded evidence receipts\n\n## Scope\n\nAdd deterministic local receipts to agent workflows.\n\n## Non-goals\n\n- Hosted services\n- Automatic approval\n\n## Proposal\n\nStart with one repository and require explicit validation evidence.\n\n## Decision requested\n\nShould the bounded receipt contract proceed?\n");
await writeFile(join(project, "showcase.kujo"), "print(\"hello\")\n");
await writeFile(join(project, "howl.json"), JSON.stringify({ project: { name: "Fixture", tagline: "Evidence", url: "" }, theme: { name: "minimal", mode: "light" }, cards: [{ id: "fixture", title: "Fixture", tagline: "A bounded example", file: "showcase.kujo", language: "kujo", concepts: ["evidence"], expected_output: "hello", caption: "A deterministic fixture.", cta: "Review it." }] }));
const selected = JSON.parse((await exec(process.execPath, [cli, "profile", "kujo.profile.review", "--project", project, "--json"], { env: { ...process.env, ...env } })).stdout); assert.equal(selected.abilities, 17);
rpc = rpcProcess(env); await rpc.request("initialize", { protocolVersion: "2025-11-25" });
message = await rpc.request("tools/list"); assert.equal(message.result.tools.length, 17); assert.ok(message.result.tools.some((tool) => tool.name === "kujo_concord_scan")); assert.ok(message.result.tools.some((tool) => tool.name === "kujo_versionseal_validate")); assert.ok(message.result.tools.some((tool) => tool.name === "kujo_packwrite_summary")); assert.ok(message.result.tools.some((tool) => tool.name === "kujo_tribunal_validate")); assert.ok(message.result.tools.some((tool) => tool.name === "kujo_dossier_report"));
message = await rpc.request("tools/call", { name: "kujo_scout_inspect", arguments: { ...scoutInput, _kujo: { invocationId: "scout-2", idempotencyKey: "scout-key" } } });
assert.equal(message.result.structuredContent.replayed, true); assert.equal(message.result.structuredContent.receipt.receipt_id, receiptId);
message = await rpc.request("tools/call", { name: "kujo_changebucket_measure", arguments: { path: ".", base: "HEAD" } }); assert.equal(message.result.structuredContent.ok, true);
message = await rpc.request("tools/call", { name: "kujo_concord_scan", arguments: { path: "." } }); assert.equal(message.result.structuredContent.ok, true, JSON.stringify(message.result.structuredContent));
message = await rpc.request("tools/call", { name: "kujo_tribunal_validate", arguments: { path: ".", file: "decision.md" } }); assert.equal(message.result.structuredContent.ok, true, JSON.stringify(message.result.structuredContent));
message = await rpc.request("tools/call", { name: "kujo_dossier_validate", arguments: { path: ".", state_dir: ".dossier-e2e" } }); assert.equal(message.result.structuredContent.ok, true, JSON.stringify(message.result.structuredContent));
message = await rpc.request("tools/call", { name: "kujo_dossier_report", arguments: { path: ".", state_dir: ".dossier-e2e", limit: 10 } }); assert.equal(message.result.structuredContent.ok, true, JSON.stringify(message.result.structuredContent));
message = await rpc.request("tools/call", { name: "kujo_howl_validate", arguments: { path: ".", manifest: "howl.json" } }); assert.equal(message.result.structuredContent.ok, true, JSON.stringify(message.result.structuredContent));
message = await rpc.request("tools/call", { name: "kujo_spec_validate", arguments: { path: ".", file: "bad.spec.yml", strict: true } }); assert.equal(message.result.structuredContent.ok, false); assert.equal(message.result.structuredContent.receipt.error.code, "kujo_command_failed");
message = await rpc.request("tools/call", { name: "kujo_ability_receipts", arguments: { limit: 50 } });
assert.equal(message.result.structuredContent.ok, true, JSON.stringify(message.result.structuredContent));
assert.ok(message.result.structuredContent.receipt.result.receipts.some((receipt) => receipt.receipt_id === receiptId));
rpc.close();

await writeFile(join(project, "redact-input.md"), "This fixture contains no sensitive data.\n");
await writeFile(join(project, "redact-policy.yaml"), "schemaVersion: redact-policy/v1\nname: command-code-e2e\nperson_names: role-preserve\ncompany_names: placeholder\ncustomer_names: placeholder\nproduct_names: placeholder\nemails: placeholder\nphone_numbers: remove\npayment_details: remove\napi_keys: remove\ndomains: placeholder\nexact_dates: date-generalize\nmoney_amounts: range\nlaunch_strategy: generalize\npreserve_task_structure: true\nwrite_entity_map: false\nai_assist: false\n");
const selectedShip = JSON.parse((await exec(process.execPath, [cli, "profile", "kujo.profile.ship", "--project", project, "--json"], { env: { ...process.env, ...env } })).stdout); assert.equal(selectedShip.abilities, 27);
rpc = rpcProcess(env); await rpc.request("initialize", { protocolVersion: "2025-11-25" });
message = await rpc.request("tools/list"); assert.equal(message.result.tools.length, 27); assert.ok(message.result.tools.some((tool) => tool.name === "kujo_redact_scan")); assert.ok(message.result.tools.some((tool) => tool.name === "kujo_runledger_finish")); assert.ok(message.result.tools.some((tool) => tool.name === "kujo_tribunal_review")); assert.ok(message.result.tools.some((tool) => tool.name === "kujo_howl_render"));
const redactInput = { path: ".", file: "redact-input.md", policy: "redact-policy.yaml", audit_dir: ".redact-e2e" };
message = await rpc.request("tools/call", { name: "kujo_redact_scan", arguments: { ...redactInput, _kujo: { invocationId: "redact-1", idempotencyKey: "redact-key" } } }); assert.equal(message.result.structuredContent.code, "ability_approval_required");
const redactApproval = JSON.parse((await exec(process.execPath, [cli, "approve", "--project", project, "--ability", "kujo.redact.document.scan", "--invocation", "redact-1", "--input", JSON.stringify(redactInput), "--json"], { env: { ...process.env, ...env } })).stdout);
message = await rpc.request("tools/call", { name: "kujo_redact_scan", arguments: { ...redactInput, _kujo: { invocationId: "redact-1", idempotencyKey: "redact-key", approvalId: redactApproval.approval_id } } }); assert.equal(message.result.structuredContent.ok, true, JSON.stringify(message.result.structuredContent));

const startInput = { path: ".", provider: "local", model: "fixture", task: "Kujo CMD integration verification", ledger_dir: ".runledger-e2e" };
message = await rpc.request("tools/call", { name: "kujo_runledger_start", arguments: { ...startInput, _kujo: { invocationId: "ledger-start-1", idempotencyKey: "ledger-start-key" } } }); assert.equal(message.result.structuredContent.code, "ability_approval_required");
const startApproval = JSON.parse((await exec(process.execPath, [cli, "approve", "--project", project, "--ability", "kujo.runledger.runs.start", "--invocation", "ledger-start-1", "--input", JSON.stringify(startInput), "--json"], { env: { ...process.env, ...env } })).stdout);
message = await rpc.request("tools/call", { name: "kujo_runledger_start", arguments: { ...startInput, _kujo: { invocationId: "ledger-start-1", idempotencyKey: "ledger-start-key", approvalId: startApproval.approval_id } } }); assert.equal(message.result.structuredContent.ok, true, JSON.stringify(message.result.structuredContent));
const runId = message.result.structuredContent.receipt.result.run_id; assert.ok(runId);
const finishInput = { path: ".", run_id: runId, status: "pass", verdict: "Integration verified", ledger_dir: ".runledger-e2e" };
message = await rpc.request("tools/call", { name: "kujo_runledger_finish", arguments: { ...finishInput, _kujo: { invocationId: "ledger-finish-1", idempotencyKey: "ledger-finish-key" } } }); assert.equal(message.result.structuredContent.code, "ability_approval_required");
const finishApproval = JSON.parse((await exec(process.execPath, [cli, "approve", "--project", project, "--ability", "kujo.runledger.runs.finish", "--invocation", "ledger-finish-1", "--input", JSON.stringify(finishInput), "--json"], { env: { ...process.env, ...env } })).stdout);
message = await rpc.request("tools/call", { name: "kujo_runledger_finish", arguments: { ...finishInput, _kujo: { invocationId: "ledger-finish-1", idempotencyKey: "ledger-finish-key", approvalId: finishApproval.approval_id } } }); assert.equal(message.result.structuredContent.ok, true, JSON.stringify(message.result.structuredContent));
const tribunalInput = { path: ".", file: "decision.md", panel: "executioner-only", storage_dir: ".tribunal-e2e" };
message = await rpc.request("tools/call", { name: "kujo_tribunal_review", arguments: { ...tribunalInput, _kujo: { invocationId: "tribunal-1", idempotencyKey: "tribunal-key" } } }); assert.equal(message.result.structuredContent.code, "ability_approval_required");
const tribunalApproval = JSON.parse((await exec(process.execPath, [cli, "approve", "--project", project, "--ability", "kujo.tribunal.review.mock", "--invocation", "tribunal-1", "--input", JSON.stringify(tribunalInput), "--json"], { env: { ...process.env, ...env } })).stdout);
message = await rpc.request("tools/call", { name: "kujo_tribunal_review", arguments: { ...tribunalInput, _kujo: { invocationId: "tribunal-1", idempotencyKey: "tribunal-key", approvalId: tribunalApproval.approval_id } } }); assert.equal(message.result.structuredContent.ok, true, JSON.stringify(message.result.structuredContent));
const howlInput = { path: ".", manifest: "howl.json", output_dir: "dist/howl-e2e", format: "html" };
message = await rpc.request("tools/call", { name: "kujo_howl_render", arguments: { ...howlInput, _kujo: { invocationId: "howl-1", idempotencyKey: "howl-key" } } }); assert.equal(message.result.structuredContent.code, "ability_approval_required");
const howlApproval = JSON.parse((await exec(process.execPath, [cli, "approve", "--project", project, "--ability", "kujo.howl.showcase.render", "--invocation", "howl-1", "--input", JSON.stringify(howlInput), "--json"], { env: { ...process.env, ...env } })).stdout);
message = await rpc.request("tools/call", { name: "kujo_howl_render", arguments: { ...howlInput, _kujo: { invocationId: "howl-1", idempotencyKey: "howl-key", approvalId: howlApproval.approval_id } } }); assert.equal(message.result.structuredContent.ok, true, JSON.stringify(message.result.structuredContent));
rpc.close();

const config = JSON.parse(await readFile(join(project, ".kujo", "cmd.json"), "utf8"));
assert.equal(config.sources, undefined);
assert.equal(Object.keys(installation.sources).length, 24);
console.log("Command Code local package compatibility: setup, discovery, schema metadata, canonical invocation, approvals, receipts, concurrency, and restart passed");
