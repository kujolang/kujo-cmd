#!/usr/bin/env node
import { once } from "node:events";
import { createApp } from "../lib/app.mjs";
import { VERSION } from "../lib/version.mjs";

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_INFLIGHT = 32;
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
  if (method.startsWith("notifications/")) return;
  if (method === "initialize") {
    const supported = new Set(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
    const requested = params.protocolVersion || "2025-11-25";
    if (!supported.has(requested)) return fail(id, -32602, "unsupported MCP protocol version");
    return reply(id, { protocolVersion: requested, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "kujo-cmd", version: VERSION } });
  }
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: [...tools.values()].map((item) => ({ name: item.tool.name, title: item.definition.title, description: item.tool.description, inputSchema: inputSchema(item.definition.input_schema), outputSchema: item.definition.output_schema, annotations: { readOnlyHint: item.definition.effects.every((effect) => effect.kind === "read") }, _meta: { "kujo/abilityId": item.definition.id, "kujo/abilityVersion": item.definition.version, "kujo/abilityDigest": item.definitionDigest, "kujo/effects": item.definition.effects } })) });
  if (method === "tools/call") {
    const item = tools.get(params.name); if (!item) return reply(id, mcpResult({ ok: false, error: { code: "ability_not_found", message: `Unknown tool: ${params.name}` } }, true));
    if (inflight.has(id)) return fail(null, -32600, "duplicate in-flight request id");
    if (inflight.size >= MAX_INFLIGHT) return fail(id, -32000, "too many in-flight tool calls");
    const controller = new AbortController();
    inflight.set(id, controller);
    try {
      const input = { ...(params.arguments || {}) }; const controls = input._kujo || {}; delete input._kujo;
      const result = await app.runtime.execute({ abilityId: item.definition.id, input, controls: { ...controls, host: "command-code", surface: "mcp" }, signal: controller.signal });
      return reply(id, mcpResult(result, !result.ok));
    } finally { inflight.delete(id); }
  }
  return fail(id, -32601, "method not found");
}

function acceptFrame(frame) {
  const text = frame.toString("utf8");
  if (!text.trim()) return;
  let request;
  try { request = JSON.parse(text); }
  catch { fail(null, -32700, "parse error"); return; }
  if (!request || typeof request !== "object" || Array.isArray(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    fail(null, -32600, "invalid JSON-RPC request");
    return;
  }
  const hasId = Object.hasOwn(request, "id");
  const { id, method, params } = request;
  if (hasId && id !== null && typeof id !== "string" && !Number.isFinite(id)) {
    fail(null, -32600, "invalid JSON-RPC request id");
    return;
  }
  const notification = method.startsWith("notifications/");
  if (notification && hasId) { fail(id, -32600, "notifications must omit the request id"); return; }
  if (!hasId && !notification) return;
  if (params !== undefined && (!params || typeof params !== "object" || Array.isArray(params))) {
    if (hasId) fail(id, -32602, "invalid MCP params");
    return;
  }
  handle(request).catch((error) => {
    if (hasId) reply(id, mcpResult({ ok: false, error: { code: error.code || "internal_error", message: String(error.message || error) } }, true));
  });
}

// Retain one bounded frame. Once over limit, drain through its newline so its
// suffix cannot be reinterpreted as a second request.
const frame = Buffer.allocUnsafe(MAX_REQUEST_BYTES);
let used = 0;
let discarding = false;
for await (const chunk of process.stdin) {
  let offset = 0;
  while (offset < chunk.length) {
    const delimiter = chunk.indexOf(10, offset);
    const end = delimiter === -1 ? chunk.length : delimiter;
    const length = end - offset;
    if (!discarding && used + length > frame.length) {
      fail(null, -32600, "MCP request exceeded safety limit");
      discarding = true;
    }
    if (!discarding) {
      chunk.copy(frame, used, offset, end);
      used += length;
    }
    if (delimiter === -1) break;
    if (!discarding) acceptFrame(frame.subarray(0, used));
    if (process.stdout.writableNeedDrain) await once(process.stdout, "drain");
    used = 0;
    discarding = false;
    offset = delimiter + 1;
  }
}
