# Kujo Ability and Command Code research

Research and implementation were completed on 2026-09-13. The final local
implementation targets Command Code 1.53.1, Kujo runtime 1.4.0, Ability
`63d4367d677ce350bb2756dab02603170ca44cee`, and the exact product revisions in
`catalog/sources.json`.

Official Command Code material consulted: [MCP](https://commandcode.ai/docs/mcp),
[mods](https://commandcode.ai/docs/mods), [hooks](https://commandcode.ai/docs/hooks),
[agents](https://commandcode.ai/docs/agents), [skills](https://commandcode.ai/docs/skills),
[sessions](https://commandcode.ai/docs/sessions),
[permissions](https://commandcode.ai/docs/permissions),
[settings](https://commandcode.ai/docs/settings),
[tools](https://commandcode.ai/docs/reference/tools),
[release notes](https://commandcode.ai/docs/whats-new), and the
[source repository](https://github.com/CommandCodeAI/command-code). The installed
official npm distribution was treated as executable ground truth where public
source and current behavior differed.

## Ability execution architecture

The implemented contract in `ability/src/contract.kujo`, `contracts.kujo`,
`registry.kujo`, and `runtime.kujo` establishes:

1. A `kujo.ability/v1` definition owns stable ID/version, JSON input/output
   schemas, effects, and retry semantics.
2. Registration binds an exact definition digest to a handler. Exposure is a
   separate surface-scoped decision; discovery does not grant execution.
3. Invocation carries principal, invocation/request/trace identity, surface,
   input, optional approval, idempotency key, and metadata.
4. Runtime audits preflight, evaluates policy fail-closed, validates input,
   consumes request-bound approval, applies keyed idempotency, calls the
   handler, validates output, audits completion, and returns a receipt.
5. `kujo.ability.receipt/v1` records definition/handler identity, status,
   result/error, policy, approval, idempotency, principal, timing, correlation,
   audit, and metadata.
6. Applications still own identity proof, policy, approval UX, durable stores,
   handler isolation, secrets, and transport.

The investigation added `kujo.ability-profile/v1`: a versioned, inheritable
list of Ability IDs. Profiles are universal exposure metadata. They never
install code, authorize effects, or modify definitions.

```text
Host
 ↓ Command Code configuration and skills          host-specific
STDIO MCP projection                              transport-specific
 ↓ list/call/cancel
Generic local Ability host                        universal host boundary
 ↓ schema/policy/approval/idempotency/audit
Canonical product command                         Kujo-specific behavior
 ↓ result/error/artifacts
Ability receipt → MCP structuredContent           universal → transport
 ↓
Host rendering                                    host-specific
```

## Existing host integrations

| Host | Portable today | Host-specific value | Lesson |
| --- | --- | --- | --- |
| Agents SDK | Definition-to-tool and gateway execution | Run/session correlation | Preserve Ability identity while adapting host metadata. |
| Codex/Cursor/VS Code | Generic MCP bridge | Install/configuration | Standard transports avoid per-Ability releases. |
| Kujo Pi | Ability list/call plus direct local tools | UI commands, profiles, tool activation, native telemetry | A mixture: profiles and UX are reusable; direct primitive wrappers predate Ability and should not be copied. |

Pi's packs (`understand`, `review`, `ship`, `orchestrate`, `extend`, `observe`)
proved that progressive disclosure matters. The new contract extracts that
idea into host-neutral profiles and keeps source installation independent from
exposure.

## Command Code surfaces

- MCP: project/local/user configuration, STDIO and HTTP, OAuth for remote
  servers, dynamic tool discovery, structured results, cancellation, and
  annotations. MCP tools are unavailable in plan mode.
- Agent Skills: `.agents/skills`, host-specific skill paths, GitHub install,
  and explicit `--skill`. Standard `.agents/skills` is the portable choice.
- Mods/hooks: tools, commands, context/prompt transforms, before/after-tool,
  session/turn/run/stop events, and continuation. In 1.53.1 mods remain an
  experimental, unsandboxed surface and hook errors may fail open; they are not
  an authorization or completion-gating boundary.
- Agents: custom workers, parallel/background work, isolated context, selected
  models/tools, and one nested subagent level. They do not implement Kujo
  Dispatch or Chain-of-Command semantics.
- Permissions: host deny/ask rules are valuable defense in depth but cannot
  create Kujo approval evidence.
- Sessions: persisted JSONL with resume/fork/tree, but no standard MCP context
  proves native session/model/agent identity to a server.
- Providers: Ollama is a supported BYOK route, including
  `ollama/glm-5.3:cloud`. Current 1.53.1 checks for an auth value before its
  local-only path. With `CMD_LOCAL_ONLY=1`, the existing non-secret local-only
  sentinel satisfies that gate and a real GLM 5.3 MCP call succeeds without a
  Command Code account session. The sentinel is not a credential and must not
  be used outside local-only mode.

## Zero-extension experiment and correction

The first experiment succeeded at Command Code → MCP → existing Ability
Gateway: discovery, schemas, structured calls, errors, effects, approvals,
receipts, retries, cancellation, concurrency, and restart all crossed the
standard boundary. It proved no Command Code mod is needed.

It also revealed a product gap. The existing STDIO bridge expected an
application-owned HTTP gateway; the managed gateway was not a general local
catalog. A user could not get Pi-like local tools from npm alone. The correct
fix was a generic local Ability host plus a thin installer/projection, not a
second implementation of Kujo products.

## Compatibility matrix

| Command Code capability | Ability equivalent | Final status | Gap / host value |
| --- | --- | --- | --- |
| STDIO MCP | Local Ability host projection | Works | Configuration only |
| Dynamic discovery | Profile-filtered registry | Works | Host refresh/restart after changes |
| Input/output schemas | Ability schemas | Works | Command Code rendering varies |
| Effects | Definition + receipt | Works | Host UI treats metadata as advisory |
| Approval | Policy + one-time approval | Works | Human CLI step remains independent |
| Errors | Receipt error | Works | Returned as MCP `isError` + structured content |
| Idempotency | Keyed receipt replay | Works across restart | Caller supplies stable key |
| Cancellation | MCP notification + process termination | Works best-effort | External effect race is explicit |
| Sessions/models/agents | Invocation metadata | Partial | Caller-asserted, not host-attested |
| Agent Skills | Canonical `kujo-skills` projection | Works | Profile selects visible subset |
| Agents/subagents | Dispatch/host workers | Intentionally separate | No false hierarchy mapping |
| Watchdog | Optional loopback service | Health works | Native lifecycle telemetry absent |
| Stop hooks/Jidoka | Future HostCompletionGate | Not shipped | Mod API not stable/fail-closed enough |
| Remote HTTP/OAuth | Existing Ability Gateway | Still supported separately | Not part of local product |

## Chain of Command and completion gating

Command Code agents may use exposed Abilities as ordinary workers, but Kujo
Dispatch remains authoritative for Kujo orchestration, retry, approvals, and
run state. No recursion or hierarchy is inferred from an MCP call.

A portable Jidoka loop needs a negotiated `HostCompletionGate`: candidate
completion plus stable run/evidence identity in, pass/revise/deny out, bounded
re-entry, observable attempts, and explicit fail-closed recovery. Command
Code's current stop/mod hooks are useful research input but not sufficient to
make that guarantee safely. Shipping a Command Code-only hook would weaken the
architecture and was rejected.
