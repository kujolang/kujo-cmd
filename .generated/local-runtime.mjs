import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const PROFILE_SCHEMA = "kujo.ability-profile/v1";
const RECEIPT_SCHEMA = "kujo.ability.receipt/v1";
const SAFE_EFFECTS = new Set(["read"]);
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_RECEIPT_BYTES = 384 * 1024;
const MAX_RECEIPT_LOG_BYTES = 8 * 1024 * 1024;
const RECEIPT_ARCHIVES = 3;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
const MAX_PENDING_APPROVALS = 1024;
const MAX_IDEMPOTENCY_RECORDS_PER_SHARD = 32;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function pruneApprovals(state, now = Date.now()) {
  const approvals = Object.entries(state.approvals || {});
  for (const [id, stored] of approvals) if (stored?.consumed || stored?.approval?.expires_at_ms <= now) delete state.approvals[id];
  const remaining = Object.entries(state.approvals || {}).sort((left, right) => (left[1]?.approval?.issued_at_ms || 0) - (right[1]?.approval?.issued_at_ms || 0));
  for (const [id] of remaining.slice(0, Math.max(0, remaining.length - MAX_PENDING_APPROVALS))) delete state.approvals[id];
}

export function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function validateDefinition(definition) {
  if (!definition || definition.schema !== "kujo.ability/v1") throw new Error("unsupported Ability definition schema");
  if (!/^[a-z0-9][a-z0-9.-]{2,199}$/.test(definition.id || "")) throw new Error("invalid Ability ID");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(definition.version || "")) throw new Error(`invalid Ability version for ${definition.id}`);
  if (!definition.input_schema || definition.input_schema.type !== "object") throw new Error(`invalid input schema for ${definition.id}`);
  if (!definition.output_schema || definition.output_schema.type !== "object") throw new Error(`invalid output schema for ${definition.id}`);
  if (!Array.isArray(definition.effects) || definition.effects.some((effect) => !["read", "write", "delete", "external"].includes(effect?.kind))) throw new Error(`invalid effects for ${definition.id}`);
  if (!definition.idempotency || !["intrinsic", "keyed", "none"].includes(definition.idempotency.mode)) throw new Error(`invalid idempotency for ${definition.id}`);
  return definition;
}

export function resolveProfile(profiles, profileId) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const selected = byId.get(profileId);
  if (!selected || selected.schema !== PROFILE_SCHEMA) throw new Error(`unknown Ability profile: ${profileId}`);
  const included = new Set([profileId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...included]) {
      const profile = byId.get(id);
      if (!profile) throw new Error(`missing Ability profile parent: ${id}`);
      for (const parent of profile.extends || []) if (!included.has(parent)) { included.add(parent); changed = true; }
    }
  }
  return { profile: selected, abilityIds: [...new Set(profiles.filter((profile) => included.has(profile.id)).flatMap((profile) => profile.ability_ids || []))] };
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export class FileAbilityState {
  #queue = Promise.resolve();
  constructor({ statePath, receiptsPath }) { this.statePath = statePath; this.receiptsPath = receiptsPath; this.lockPath = `${statePath}.lock`; this.idempotencyDir = `${statePath}.d/idempotency`; }
  async transaction(operation) {
    return this.#enqueue(async () => {
      const state = await readJson(this.statePath, { schema: "kujo.ability.local-state/v1", approvals: {}, idempotency: {} });
      pruneApprovals(state);
      const result = await operation(state);
      await atomicJson(this.statePath, state);
      return result;
    });
  }
  async idempotencyTransaction(scope, operation) {
    return this.#enqueue(async () => {
      const path = this.#idempotencyPath(scope);
      await mkdir(dirname(path), { recursive: true });
      const record = await readJson(path, null);
      const outcome = await operation(record);
      if (outcome?.record === null) await rm(path, { force: true });
      else if (outcome && Object.hasOwn(outcome, "record")) await atomicJson(path, outcome.record);
      await this.#pruneIdempotencyShard(dirname(path), `${scope}.json`);
      return outcome?.value;
    });
  }
  async executionGate({ scope, requestDigest, approvalId, approvalRequired, validateApproval, reservation }) {
    return this.#enqueue(async () => {
      const recordPath = this.#idempotencyPath(scope);
      await mkdir(dirname(recordPath), { recursive: true });
      const previous = await readJson(recordPath, null);
      if (previous && previous.requestDigest !== requestDigest) return { state: "conflict" };
      if (previous?.state === "completed" && previous.receipt) return { state: "replay", receipt: previous.receipt };
      if (previous?.state === "in_progress") return { state: "in_progress", invocationId: previous.invocationId };

      if (approvalRequired) {
        if (!approvalId) return { state: "approval_required" };
        const state = await readJson(this.statePath, { schema: "kujo.ability.local-state/v1", approvals: {}, idempotency: {} });
        pruneApprovals(state);
        const stored = state.approvals[approvalId];
        if (!stored || !validateApproval(stored)) return { state: "approval_invalid" };
        stored.consumed = true;
        await atomicJson(this.statePath, state);
      }
      await atomicJson(recordPath, { requestDigest, state: "in_progress", ...reservation });
      return { state: "proceed" };
    });
  }
  async completeIdempotency(scope, requestDigest, receipt) {
    await this.idempotencyTransaction(scope, () => ({ value: true, record: { requestDigest, state: "completed", receipt } }));
  }
  async appendReceipt(receipt) {
    const line = `${JSON.stringify(receipt)}\n`;
    if (Buffer.byteLength(line) > MAX_RECEIPT_BYTES) throw Object.assign(new Error("Ability receipt exceeded safety limit"), { code: "ability_receipt_limit" });
    await this.#enqueue(async () => {
      await mkdir(dirname(this.receiptsPath), { recursive: true });
      let currentSize = 0;
      try { currentSize = (await stat(this.receiptsPath)).size; } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (currentSize + Buffer.byteLength(line) > MAX_RECEIPT_LOG_BYTES) await this.#rotateReceipts();
      const file = await open(this.receiptsPath, "a", 0o600);
      try { await file.chmod(0o600); await file.write(line); } finally { await file.close(); }
    });
  }
  async reset() { await this.#enqueue(async () => { await rm(this.statePath, { force: true }); await rm(`${this.statePath}.d`, { recursive: true, force: true }); }); }

  #enqueue(operation) {
    const run = this.#queue.then(() => this.#withLock(operation));
    this.#queue = run.catch(() => {});
    return run;
  }

  async #withLock(operation) {
    await mkdir(dirname(this.lockPath), { recursive: true });
    const deadline = Date.now() + LOCK_WAIT_MS;
    let lock;
    const owner = randomUUID();
    while (!lock) {
      try {
        lock = await open(this.lockPath, "wx", 0o600);
        await lock.writeFile(JSON.stringify({ owner, pid: process.pid, created_at_ms: Date.now() }));
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try { if (Date.now() - (await stat(this.lockPath)).mtimeMs > LOCK_STALE_MS) await rm(this.lockPath, { force: true }); }
        catch (statError) { if (statError.code !== "ENOENT") throw statError; }
        if (Date.now() >= deadline) throw Object.assign(new Error("timed out waiting for Ability state lock"), { code: "ability_state_lock_timeout" });
        await new Promise((resolveWait) => setTimeout(resolveWait, 20 + Math.floor(Math.random() * 30)));
      }
    }
    try { return await operation(); }
    finally {
      await lock.close();
      try {
        const current = JSON.parse(await readFile(this.lockPath, "utf8"));
        if (current.owner === owner) await rm(this.lockPath, { force: true });
      } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
    }
  }

  async #rotateReceipts() {
    await rm(`${this.receiptsPath}.${RECEIPT_ARCHIVES}`, { force: true });
    for (let index = RECEIPT_ARCHIVES - 1; index >= 1; index -= 1) {
      try { await rename(`${this.receiptsPath}.${index}`, `${this.receiptsPath}.${index + 1}`); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    try { await rename(this.receiptsPath, `${this.receiptsPath}.1`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }

  #idempotencyPath(scope) {
    return join(this.idempotencyDir, scope.slice(0, 2), `${scope}.json`);
  }

  async #pruneIdempotencyShard(shard, preserveName) {
    const names = (await readdir(shard)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
    if (names.length <= MAX_IDEMPOTENCY_RECORDS_PER_SHARD) return;
    const records = (await Promise.all(names.map(async (name) => {
      const path = join(shard, name);
      const record = await readJson(path, null);
      return record?.state === "completed" ? { name, mtimeMs: (await stat(path)).mtimeMs } : null;
    }))).filter(Boolean);
    if (records.length <= MAX_IDEMPOTENCY_RECORDS_PER_SHARD) return;
    records.sort((left, right) => left.name === preserveName ? -1 : right.name === preserveName ? 1 : right.mtimeMs - left.mtimeMs);
    await Promise.all(records.slice(MAX_IDEMPOTENCY_RECORDS_PER_SHARD).map(({ name }) => rm(join(shard, name), { force: true })));
  }
}

function principal(input = {}) {
  return {
    type: typeof input.type === "string" ? input.type : "workload",
    id: typeof input.id === "string" ? input.id : "command-code",
    tenant_id: typeof input.tenant_id === "string" ? input.tenant_id : "local",
    claims: input.claims && typeof input.claims === "object" ? input.claims : {},
  };
}

function decisionFor(definition) {
  const approvalRequired = definition.effects.some((effect) => !SAFE_EFFECTS.has(effect.kind));
  return {
    schema: "kujo.ability.policy-decision/v1",
    decision_id: `decision-${randomUUID()}`,
    outcome: approvalRequired ? "approval_required" : "allow",
    reason: approvalRequired ? "Local non-read effects require explicit one-time human approval." : "Read-only local Ability is allowed.",
    requirements: approvalRequired ? ["human"] : [],
    policy_id: "kujo.ability.local-default",
    policy_version: "1.0.0",
  };
}

function approvalBinding({ definition, input, invocationId, principalValue }) {
  return digest({ ability_id: definition.id, ability_version: definition.version, definition_digest: digest(definition), input, invocation_id: invocationId, principal: principalValue });
}

function schemaErrors(value, schema, path = "$") {
  const errors = [];
  const type = Array.isArray(value) ? "array" : value === null ? "null" : Number.isInteger(value) ? "integer" : typeof value === "number" ? "number" : typeof value;
  if (schema.type && type !== schema.type && !(schema.type === "number" && type === "integer")) errors.push(`${path} must be ${schema.type}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
  if (typeof value === "string") { if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is too short`); if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is too long`); }
  if (typeof value === "number") { if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} is below minimum`); if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} is above maximum`); }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required || []) if (!(required in value)) errors.push(`${path}.${required} is required`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in (schema.properties || {}))) errors.push(`${path}.${key} is not allowed`);
    for (const [key, child] of Object.entries(schema.properties || {})) if (key in value) errors.push(...schemaErrors(value[key], child, `${path}.${key}`));
  }
  return errors;
}

function jsonBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value)); } catch { return Number.POSITIVE_INFINITY; }
}

function boundedDetails(value) {
  return jsonBytes(value) <= 64 * 1024 ? value : { omitted: true, reason: "error details exceeded safety limit" };
}

export class LocalAbilityRuntime {
  constructor({ abilities, profiles, profileId, state, clock = () => Date.now(), approvalTtlMs = 300_000 }) {
    this.abilities = new Map();
    for (const ability of abilities) {
      validateDefinition(ability.definition);
      if (this.abilities.has(ability.definition.id)) throw new Error(`duplicate Ability ID: ${ability.definition.id}`);
      this.abilities.set(ability.definition.id, { ...ability, digest: digest(ability.definition) });
    }
    this.profiles = profiles;
    this.profileId = profileId;
    this.state = state;
    this.clock = clock;
    this.approvalTtlMs = approvalTtlMs;
  }

  visible() {
    const resolved = resolveProfile(this.profiles, this.profileId);
    return resolved.abilityIds.map((id) => this.abilities.get(id)).filter(Boolean);
  }

  setProfile(profileId) { resolveProfile(this.profiles, profileId); this.profileId = profileId; }

  describe() {
    return this.visible().map(({ definition, digest: definitionDigest, tool }) => ({ definition, definitionDigest, tool }));
  }

  async requestApproval({ abilityId, input, invocationId, principal: principalInput }) {
    const item = this.abilities.get(abilityId);
    if (!item) throw new Error(`unknown Ability: ${abilityId}`);
    if (item.definition.effects.every((effect) => SAFE_EFFECTS.has(effect.kind))) throw new Error("approval is not required for a read-only Ability");
    const principalValue = principal(principalInput);
    const now = this.clock();
    const approval = {
      schema: "kujo.ability.approval/v1",
      approval_id: `approval-${randomUUID()}`,
      binding_digest: approvalBinding({ definition: item.definition, input, invocationId, principalValue }),
      approved_by: { type: "human", id: process.env.USER || "local-user", tenant_id: principalValue.tenant_id, claims: {} },
      issued_at_ms: now,
      expires_at_ms: now + this.approvalTtlMs,
      nonce: randomUUID(),
      evidence: { surface: "local-cli" },
    };
    await this.state.transaction((stateValue) => { stateValue.approvals[approval.approval_id] = { approval, consumed: false }; });
    return approval;
  }

  async execute({ abilityId, input = {}, controls = {}, signal }) {
    const item = this.abilities.get(abilityId);
    if (!item || !this.visible().includes(item)) return this.#failureWithoutReceipt("ability_not_exposed", "Ability is not exposed by the active profile");
    const definition = item.definition;
    const started = this.clock();
    const invocationId = controls.invocationId || `invocation-${randomUUID()}`;
    const principalValue = principal(controls.principal);
    const decision = decisionFor(definition);
    const inputErrors = schemaErrors(input, definition.input_schema);
    if (inputErrors.length) return this.#receipt({ item, invocationId, principalValue, decision, started, status: "rejected", input, error: { code: "ability_input_invalid", message: "Ability input does not satisfy its schema", details: { errors: inputErrors } }, idempotency: { mode: definition.idempotency.mode, state: "not_started" }, controls });
    const idempotencyKey = controls.idempotencyKey || "";
    const requestDigest = digest({ ability_id: abilityId, input, principal: principalValue });
    let approvalId = "";
    if (definition.idempotency.mode === "keyed" && !idempotencyKey) return this.#receipt({ item, invocationId, principalValue, decision, started, status: "rejected", input, error: { code: "ability_idempotency_key_required", message: "This Ability requires an idempotency key", details: {} }, idempotency: { mode: "keyed", state: "not_started" }, controls });
    const approvalRequired = decision.outcome === "approval_required";
    const suppliedApproval = controls.approvalId || "";
    if (approvalRequired && definition.idempotency.mode !== "keyed" && !suppliedApproval) return this.#receipt({ item, invocationId, principalValue, decision, started, status: "approval_required", input, error: { code: "ability_approval_required", message: decision.reason, details: { approval_cli: "kujo-cmd approve", ability_id: abilityId, invocation_id: invocationId, input } }, idempotency: { mode: definition.idempotency.mode, state: "not_started" }, controls });

    const scope = definition.idempotency.mode === "keyed" ? digest({ principal: principalValue, ability_id: abilityId, idempotency_key: idempotencyKey }) : "";
    const validApproval = (stored) => !stored.consumed && stored.approval.expires_at_ms > this.clock() && stored.approval.binding_digest === approvalBinding({ definition, input, invocationId, principalValue });
    if (definition.idempotency.mode === "keyed") {
      const gate = await this.state.executionGate({ scope, requestDigest, approvalId: suppliedApproval, approvalRequired, validateApproval: validApproval, reservation: { invocationId, startedAtMs: started } });
      if (gate.state === "conflict") return this.#receipt({ item, invocationId, principalValue, decision, started, status: "rejected", input, error: { code: "ability_idempotency_conflict", message: "Idempotency key was used for different input", details: {} }, idempotency: { mode: "keyed", state: "conflict" }, controls });
      if (gate.state === "replay") return { ok: gate.receipt.status === "succeeded", receipt: gate.receipt, replayed: true };
      if (gate.state === "in_progress") return this.#receipt({ item, invocationId, principalValue, decision, started, status: "rejected", input, error: { code: "ability_idempotency_in_progress", message: "An invocation with this idempotency key is already running or has an unresolved outcome", details: { invocation_id: gate.invocationId } }, idempotency: { mode: "keyed", state: "in_progress" }, controls });
      if (gate.state === "approval_required") return this.#receipt({ item, invocationId, principalValue, decision, started, status: "approval_required", input, error: { code: "ability_approval_required", message: decision.reason, details: { approval_cli: "kujo-cmd approve", ability_id: abilityId, invocation_id: invocationId, input } }, idempotency: { mode: "keyed", state: "not_started" }, controls });
      if (gate.state === "approval_invalid") return this.#receipt({ item, invocationId, principalValue, decision, started, status: "rejected", input, error: { code: "ability_approval_invalid", message: "Approval is missing, expired, replayed, or bound to another request", details: {} }, idempotency: { mode: "keyed", state: "not_started" }, controls });
      approvalId = approvalRequired ? suppliedApproval : "";
    } else if (approvalRequired) {
      const consumed = await this.state.transaction((stateValue) => {
        const stored = stateValue.approvals[suppliedApproval];
        if (!stored || !validApproval(stored)) return false;
        stored.consumed = true;
        return true;
      });
      if (!consumed) return this.#receipt({ item, invocationId, principalValue, decision, started, status: "rejected", input, error: { code: "ability_approval_invalid", message: "Approval is missing, expired, replayed, or bound to another request", details: {} }, idempotency: { mode: definition.idempotency.mode, state: "not_started" }, controls });
      approvalId = suppliedApproval;
    }
    if (signal?.aborted) {
      const response = await this.#receipt({ item, invocationId, principalValue, decision, started, status: "cancelled", input, error: { code: "ability_cancelled", message: "Invocation was cancelled before execution", details: {} }, idempotency: { mode: definition.idempotency.mode, state: definition.idempotency.mode === "keyed" ? "completed" : "not_started" }, controls, approvalId });
      if (definition.idempotency.mode === "keyed") await this.state.completeIdempotency(scope, requestDigest, response.receipt);
      return response;
    }
    let status = "succeeded";
    let result = null;
    let error = null;
    try {
      result = await item.handler(input, { invocationId, principal: principalValue, signal, controls, definition });
      const outputErrors = schemaErrors(result, definition.output_schema);
      if (outputErrors.length) {
        status = "failed";
        result = null;
        error = { code: "ability_output_invalid", message: "Ability output does not satisfy its schema", details: { errors: outputErrors } };
      }
      else if (jsonBytes(result) > MAX_RESULT_BYTES) {
        status = "failed";
        result = null;
        error = { code: "ability_output_limit", message: "Ability output exceeded safety limit", details: { max_bytes: MAX_RESULT_BYTES } };
      }
    }
    catch (cause) {
      status = cause?.name === "AbortError" ? "cancelled" : "failed";
      error = { code: status === "cancelled" ? "ability_cancelled" : (cause.code || "ability_handler_failed"), message: String(cause.message || cause), details: boundedDetails(cause.details || {}) };
    }
    const response = await this.#receipt({ item, invocationId, principalValue, decision, started, status, input, result, error, idempotency: { mode: definition.idempotency.mode, state: definition.idempotency.mode === "keyed" ? "completed" : "not_applicable" }, controls, approvalId });
    if (definition.idempotency.mode === "keyed") await this.state.completeIdempotency(scope, requestDigest, response.receipt);
    return response;
  }

  #failureWithoutReceipt(code, message) { return { ok: false, code, error: { code, message, details: {} } }; }

  async #receipt({ item, invocationId, principalValue, decision, started, status, result = null, error = null, idempotency, controls, approvalId = "" }) {
    const completed = this.clock();
    const receipt = {
      schema: RECEIPT_SCHEMA,
      receipt_id: `receipt-${randomUUID()}`,
      invocation_id: invocationId,
      ability_id: item.definition.id,
      ability_version: item.definition.version,
      definition_digest: item.digest,
      handler_id: item.handlerId || `${item.definition.id}.local`,
      handler_version: item.handlerVersion || "1.0.0",
      status,
      result,
      error,
      policy_decision: decision,
      approval_id: approvalId,
      idempotency,
      request_id: controls.requestId || invocationId,
      trace_id: controls.traceId || invocationId,
      surface: controls.surface || "mcp",
      principal: principalValue,
      started_at_ms: started,
      completed_at_ms: completed,
      duration_ms: completed - started,
      audit: { ok: true, written: true, sink: this.state.receiptsPath },
      metadata: { host: controls.host || "command-code", session_id: controls.sessionId || "", run_id: controls.runId || "", agent_id: controls.agentId || "", model_id: controls.modelId || "", tool_id: item.tool?.name || "", effects: item.definition.effects },
    };
    await this.state.appendReceipt(receipt);
    return { ok: status === "succeeded", receipt, ...(status === "succeeded" ? {} : { code: error?.code || status }) };
  }
}
