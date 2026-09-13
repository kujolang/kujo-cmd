import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAbilityState, LocalAbilityRuntime } from "../.generated/local-runtime.mjs";

const definition = { schema: "kujo.ability/v1", id: "kujo.test.files.write", version: "1.0.0", title: "Write fixture", description: "Write a bounded fixture.", input_schema: { type: "object", required: ["value"], properties: { value: { type: "string", minLength: 1 } }, additionalProperties: false }, output_schema: { type: "object", additionalProperties: true }, effects: [{ kind: "write", resource: "kujo.test.files" }], idempotency: { mode: "keyed" } };
const profiles = [{ schema: "kujo.ability-profile/v1", id: "kujo.profile.test", version: "1.0.0", description: "Test", default: true, extends: [], ability_ids: [definition.id], metadata: {} }];

test("approval, idempotency, receipts, restart, and cancellation fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "kujo-cmd-runtime-")); const state = new FileAbilityState({ statePath: join(root, "state.json"), receiptsPath: join(root, "receipts.jsonl") }); let executions = 0;
  const ability = { definition, tool: { name: "fixture" }, handler: async (input) => { executions += 1; return { value: input.value }; } };
  const runtime = new LocalAbilityRuntime({ abilities: [ability], profiles, profileId: "kujo.profile.test", state });
  let result = await runtime.execute({ abilityId: definition.id, input: { value: "a" }, controls: { invocationId: "run-1" } });
  assert.equal(result.code, "ability_idempotency_key_required");
  result = await runtime.execute({ abilityId: definition.id, input: { value: "a" }, controls: { invocationId: "run-1", idempotencyKey: "key-1" } });
  assert.equal(result.code, "ability_approval_required");
  const approval = await runtime.requestApproval({ abilityId: definition.id, input: { value: "a" }, invocationId: "run-1" });
  result = await runtime.execute({ abilityId: definition.id, input: { value: "a" }, controls: { invocationId: "run-1", idempotencyKey: "key-1", approvalId: approval.approval_id, sessionId: "s", modelId: "glm-5.3" } });
  assert.equal(result.ok, true); assert.equal(executions, 1); assert.equal(result.receipt.metadata.model_id, "glm-5.3");
  const restarted = new LocalAbilityRuntime({ abilities: [ability], profiles, profileId: "kujo.profile.test", state: new FileAbilityState({ statePath: join(root, "state.json"), receiptsPath: join(root, "receipts.jsonl") }) });
  const replay = await restarted.execute({ abilityId: definition.id, input: { value: "a" }, controls: { invocationId: "run-2", idempotencyKey: "key-1" } });
  assert.equal(replay.replayed, true); assert.equal(executions, 1);
  const invalid = await restarted.execute({ abilityId: definition.id, input: {}, controls: {} }); assert.equal(invalid.code, "ability_input_invalid");
  const controller = new AbortController(); controller.abort();
  const readDefinition = { ...definition, id: "kujo.test.files.read", effects: [{ kind: "read", resource: "kujo.test.files" }], idempotency: { mode: "intrinsic" } };
  const cancelledRuntime = new LocalAbilityRuntime({ abilities: [{ definition: readDefinition, tool: { name: "read" }, handler: async () => ({}) }], profiles: [{ ...profiles[0], ability_ids: [readDefinition.id] }], profileId: "kujo.profile.test", state });
  const cancelled = await cancelledRuntime.execute({ abilityId: readDefinition.id, input: { value: "a" }, controls: {}, signal: controller.signal }); assert.equal(cancelled.receipt.status, "cancelled");
  const strictOutput = { ...readDefinition, id: "kujo.test.files.strict", output_schema: { type: "object", required: ["value"], properties: { value: { type: "string" } }, additionalProperties: false } };
  const invalidOutputRuntime = new LocalAbilityRuntime({ abilities: [{ definition: strictOutput, tool: { name: "strict" }, handler: async () => ({ unexpected: true }) }], profiles: [{ ...profiles[0], ability_ids: [strictOutput.id] }], profileId: "kujo.profile.test", state });
  const invalidOutput = await invalidOutputRuntime.execute({ abilityId: strictOutput.id, input: { value: "a" }, controls: {} });
  assert.equal(invalidOutput.code, "ability_output_invalid"); assert.equal(invalidOutput.receipt.result, null); assert.equal(invalidOutput.receipt.status, "failed");
  assert.ok((await readFile(join(root, "receipts.jsonl"), "utf8")).trim().split("\n").length >= 5);
});
