#!/usr/bin/env node
import { createApp } from "../lib/app.mjs";

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_TEXT_CONTENT_BYTES = 32 * 1024;
const project = process.env.KUJO_CMD_PROJECT || process.cwd();
const app = await createApp(project);
const inflight = new Map();
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const reply = (id, result) => write({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });
function mcpResult(value, isError = false) {
  const full = JSON.stringify(value);
  const receipt = value?.receipt;
  const summary = { ok: value?.ok === true, ...(value?.code ? { code: value.code } : {}), ...(value?.error ? { error: { code: value.error.code, message: value.error.message } } : {}), ...(receipt ? { receipt: { receipt_id: receipt.receipt_id, invocation_id: receipt.invocation_id, ability_id: receipt.ability_id, status: receipt.status, ...(receipt.error ? { error: { code: receipt.error.code, message: receipt.error.message } } : {}) } } : {}) };
  const text = Buffer.byteLength(full) <= MAX_TEXT_CONTENT_BYTES ? full : JSON.stringify(summary);
  return { content: [{ type: "text", text }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}

function inputSchema(schema) {
  return { ...schema, properties: { ...(schema.properties || {}), _kujo: { type: "object", description: "Optional Kujo identity, idempotency, and approval controls.", properties: {
    invocationId: { type: "string" }, idempotencyKey: { type: "string" }, approvalId: { type: "string" }, requestId: { type: "string" }, traceId: { type: "string" },
    sessionId: { type: "string" }, runId: { type: "string" }, agentId: { type: "string" }, modelId: { type: "string" }
  }, additionalProperties: false } } };
}

const tools = new Map(app.runtime.describe().map((item) => [item.tool.name, item]));

async function handle(request) {
  const { id, method, params = {} } = request;
  if (method === "notifications/initialized") return;
  if (method === "notifications/cancelled") { inflight.get(params.requestId)?.abort(); return; }
  if (method === "initialize") {
    const supported = new Set(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
    const requested = params.protocolVersion || "2025-11-25";
    if (!supported.has(requested)) return fail(id, -32602, `unsupported MCP protocol version: ${requested}`);
    return reply(id, { protocolVersion: requested, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "kujo-cmd", version: "0.1.0" } });
  }
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: [...tools.values()].map((item) => ({ name: item.tool.name, title: item.definition.title, description: item.tool.description, inputSchema: inputSchema(item.definition.input_schema), outputSchema: item.definition.output_schema, annotations: { readOnlyHint: item.definition.effects.every((effect) => effect.kind === "read") }, _meta: { "kujo/abilityId": item.definition.id, "kujo/abilityVersion": item.definition.version, "kujo/abilityDigest": item.definitionDigest, "kujo/effects": item.definition.effects } })) });
  if (method === "tools/call") {
    const item = tools.get(params.name); if (!item) return reply(id, mcpResult({ ok: false, error: { code: "ability_not_found", message: `Unknown tool: ${params.name}` } }, true));
    const controller = new AbortController(); inflight.set(id, controller);
    try {
      const input = { ...(params.arguments || {}) }; const controls = input._kujo || {}; delete input._kujo;
      const result = await app.runtime.execute({ abilityId: item.definition.id, input, controls: { ...controls, host: "command-code", surface: "mcp" }, signal: controller.signal });
      return reply(id, mcpResult(result, !result.ok));
    } finally { inflight.delete(id); }
  }
  return fail(id, -32601, `method not found: ${method}`);
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  if (buffer.length > MAX_REQUEST_BYTES && !buffer.includes(10)) {
    fail(null, -32600, "MCP request exceeded safety limit");
    buffer = Buffer.alloc(0);
    return;
  }
  let newline;
  while ((newline = buffer.indexOf(10)) !== -1) {
    const lineBuffer = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
    if (lineBuffer.length > MAX_REQUEST_BYTES) { fail(null, -32600, "MCP request exceeded safety limit"); continue; }
    const line = lineBuffer.toString("utf8");
    if (!line.trim()) continue;
    let request; try { request = JSON.parse(line); } catch { fail(null, -32700, "parse error"); continue; }
    Promise.resolve(handle(request)).catch((error) => { if (request.id !== undefined) reply(request.id, mcpResult({ ok: false, error: { code: error.code || "internal_error", message: String(error.message || error) } }, true)); });
  }
});
