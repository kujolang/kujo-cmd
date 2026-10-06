# Command Code gap analysis

## Works now

| Capability | Status |
| --- | --- |
| One-command project setup | `npx @kujolang/kujo-cmd setup`; installs sources, runtime, MCP, skills, and smoke-checks discovery. |
| Local execution | STDIO MCP and canonical Kujo CLIs; no Kujo-hosted service. |
| Dynamic discovery | Profile-filtered catalog with exact schemas, effects, versions, and digests. |
| Profiles | Portable `kujo.ability-profile/v1`; all sources remain installed while exposure changes. |
| Skills | Generated/symlinked from one pinned `kujo-skills` source into `.agents/skills`. |
| Policy and approval | Read allowed; write/delete/external require input-bound, expiring, one-time approval. |
| Receipts | Local append-only JSONL with policy, approval, idempotency, timing, and host/run/session/agent/model correlation. |
| Restart and retry | Persistent approvals/idempotency/receipts survive MCP and host restarts; keyed retries replay receipts. |
| Cancellation/concurrency | MCP cancellation terminates child work; calls run concurrently; state mutation is serialized. |
| Optional Watchdog | Explicit local loopback service start/stop/status and health Ability. |

## Partial or explicit degradation

- MCP still supplies no trustworthy standard session/model/agent envelope.
  `_kujo` correlation fields are preserved but caller-asserted. Command Code
  now exposes session, tool, subagent, and lifecycle events to host-specific
  hooks and mods, which creates a viable optional correlation adapter without
  changing the portable MCP contract.
- Process termination is best-effort. A killed tool may have completed an
  external effect before cancellation; inspect receipts/artifacts before retry.
- Command Code tool permissions do not mint Kujo approvals. Approval remains a
  separate CLI action so a model cannot approve itself.
- Profiles select tools and corresponding skills, but Command Code currently
  needs a restart/tool refresh after profile changes.
- Watchdog health is integrated. Native turn/tool telemetry is not yet wired,
  although current Command Code mods now expose the lifecycle events needed for
  an explicit host adapter.
- Dispatch validation is exposed. Dispatch execution remains authoritative in
  Dispatch and should be added only with its provider and worker dependencies
  expressed as a canonical Ability pack.
- RAG query expects a local index. No remote index is substituted.

## Deliberately not implemented

- Host-named copies of Kujo primitives or skills.
- A managed/hybrid Kujo execution service.
- In-band self-approval.
- Experimental mod hooks as an authorization boundary.
- Command Code agents masquerading as Kujo Chain-of-Command workers without an
  explicit identity and delegation adapter.
- Jidoka completion gating without an installed, reviewed Stop hook or mod.

## Remaining worthwhile generic work

A separately versioned, optional Command Code host adapter is now worthwhile.
Its mod can correlate session and subagent events, forward bounded telemetry to
Watchdog/RunLedger, and implement reviewed Stop gates while the MCP projection
remains portable and authoritative for Kujo Abilities. The adapter must not
turn Command Code permission prompts into Kujo approvals or treat host agent
IDs as Kujo Chain-of-Command identities without an explicit mapping contract.
