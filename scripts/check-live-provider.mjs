import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { resolveKujoBinary } from "@kujolang/kujo-runtime";

// Provider-level evidence only: this does not exercise Command Code's mod loader.
const base = new URL(process.env.KUJO_CMD_PROVIDER_URL || "http://127.0.0.1:8645/v1/");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "use a loopback provider proxy");
assert.ok(["http:", "https:"].includes(base.protocol));
assert.ok(!base.username && !base.password && !base.search && !base.hash);
base.pathname = base.pathname.replace(/\/?$/, "/");
const model = process.env.KUJO_CMD_PROVIDER_MODEL;
assert.ok(model, "set KUJO_CMD_PROVIDER_MODEL to an available tool-capable model");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exec = promisify(execFile);
const temporary = await mkdtemp(join(tmpdir(), "kujo-cmd-provider-"));
const project = join(temporary, "project");
const env = { ...process.env, KUJO_CMD_HOME: join(temporary, "home"), KUJO_CMD_PROJECT: project, KUJO_BIN: resolveKujoBinary() };
let child;
const pending = new Map();
let nextId = 0;
function request(method, params = {}) {
  return new Promise((resolveResult, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 60_000);
    pending.set(id, { resolve: resolveResult, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}
async function completion(messages, tools, toolChoice) {
  const response = await fetch(new URL("chat/completions", base), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(120_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.KUJO_CMD_PROVIDER_TOKEN || "ai-chat-local"}` },
    body: JSON.stringify({ model, messages, tools, tool_choice: toolChoice, max_tokens: 4096, stream: false }),
  });
  assert.equal(response.status, 200, `provider HTTP ${response.status}`);
  const body = await response.json();
  assert.ok(body.choices?.[0]?.message, "provider returned no assistant message");
  return body.choices[0].message;
}
try {
  await mkdir(project);
  await writeFile(join(project, "README.md"), "# Kujo provider fixture\n");
  await exec("git", ["init", "-q"], { cwd: project });
  await exec("git", ["add", "README.md"], { cwd: project });
  await exec("git", ["-c", "user.name=Kujo", "-c", "user.email=kujo@example.invalid", "commit", "-qm", "fixture"], { cwd: project });
  await writeFile(join(project, "README.md"), "# Kujo provider fixture\n\nProvider smoke change.\n");
  await exec(process.execPath, [join(root, "bin/kujo-cmd.mjs"), "setup", "--project", project,
    ...(process.env.KUJO_SOURCE_ROOT ? ["--source-root", resolve(process.env.KUJO_SOURCE_ROOT)] : []), "--json"], { env, timeout: 300_000 });
  child = spawn(process.execPath, [join(root, "bin/kujo-cmd-mcp.mjs")], { cwd: project, env, stdio: ["pipe", "pipe", "ignore"] });
  const failPending = () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("MCP process stopped")); } pending.clear(); };
  child.on("error", failPending); child.on("exit", failPending);
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line); const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    if (message.error) item.reject(new Error(`MCP error ${message.error.code}`)); else item.resolve(message.result);
  });
  await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "kujo-provider-check", version: "1" } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const inventory = (await request("tools/list")).tools;
  const names = ["kujo_ability_catalog", "kujo_patchbrief_summarize", "kujo_shipcheck_scan"];
  const tools = names.map((name) => {
    const tool = inventory.find((item) => item.name === name);
    assert.ok(tool?.annotations.readOnlyHint, `${name} must be read-only`);
    return { type: "function", function: { name, description: tool.description, parameters: tool.inputSchema } };
  });
  const checks = [];
  for (const name of names) {
    const messages = [{ role: "user", content: `Call ${name} exactly once, using path '.' if required. Use only this disposable fixture. Then report the tool's ok value as exactly OK=true or OK=false.` }];
    const assistant = await completion(messages, tools, { type: "function", function: { name } });
    assert.equal(assistant.tool_calls?.length, 1, "expected exactly one model-generated call");
    const call = assistant.tool_calls[0]; assert.equal(call.function.name, name);
    const args = JSON.parse(call.function.arguments);
    const result = await request("tools/call", { name, arguments: args });
    assert.equal(result.isError, undefined, `${name} returned MCP error`);
    assert.equal(result.structuredContent.ok, true, `${name} failed`);
    assert.ok(result.structuredContent.receipt?.receipt_id, `${name} missing receipt`);
    messages.push(assistant, { role: "tool", tool_call_id: call.id, content: JSON.stringify(result.structuredContent) });
    const final = await completion(messages, tools, "none");
    assert.ok(!final.tool_calls?.length);
    assert.equal(final.content?.trim(), "OK=true");
    checks.push({ tool: name, ok: true, model_generated_call: true, receipt: true, result_consumed: true });
  }
  console.log(JSON.stringify({ ok: true, scope: "provider-to-MCP (not Command Code session)", model, discovered_tools: inventory.length, checks }, null, 2));
} finally {
  child?.kill("SIGTERM");
  if (child && child.exitCode === null && child.signalCode === null) await new Promise((done) => child.once("exit", done));
  await rm(temporary, { recursive: true, force: true });
}
