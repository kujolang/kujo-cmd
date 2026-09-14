# ADR: local Ability host plus thin Command Code projection

Status: accepted, supersedes the configuration-only decision, 2026-09-13.

## Decision

Choose Option C: extend the generic Ability host boundary, then ship Command
Code as a thin local projection in `@kujolang/kujo-cmd`.

```text
Command Code
  ├─ canonical Agent Skills projection
  └─ STDIO MCP
       ↓
generic local Ability host
       ↓
canonical Kujo product CLIs and artifacts
```

The npm package installs all supported, version-pinned Kujo sources and the
official cross-platform runtime locally. Portable Ability profiles control
what MCP exposes; they do not control installation or authorization. The
generic host owns schema validation, policy, one-time approval, idempotency,
cancellation, audit, and receipts. Product repositories remain authoritative
for Scout, Scent, PatchBrief, ChangeBucket, ShipCheck, Fence, Spec, Eval,
RunLedger, Dispatch, RAG, and Watchdog behavior.

No managed or hybrid execution mode is part of this product. Optional
Watchdog is a loopback local service. The earlier remote/application-gateway
bridge remains available separately for applications that already own such a
gateway.

## Why

The original zero-adapter experiment proved Command Code's MCP compatibility,
but did not deliver a self-contained user product: it still required a running
gateway and an already registered Ability catalog. Kujo Pi showed that profiles,
skills, diagnostics, and local tools matter to adoption, while also showing why
host-specific primitive implementations should not be copied.

This design keeps the standard MCP seam and dynamic discovery while adding the
missing reusable local Ability host. Adding a catalog Ability changes data and
its canonical handler source; it does not require a Command Code tool release.

## Rejected alternatives

- Managed Ability service: rejected by the local ownership requirement.
- Command Code mod: unnecessary for tools/skills and too experimental for
  authorization or completion gating.
- Per-tool native Command Code code: duplicates Kujo and creates release lockstep.
- Copy Kujo Pi: retains historical direct adapters and host-specific state.
- Map Command Code permission prompts to Kujo approvals: unsafe; host consent is
  defense in depth, not request-bound Kujo authorization evidence.

## Consequences

The projection can be removed if Command Code later consumes local Ability
packs directly. The local source acquisition step needs GitHub only during
installation/update; execution is offline afterward. Native host lifecycle,
verified Command Code session/model identity, agent delegation, and Jidoka
completion gating remain outside Ability v1 until a stable, multi-host contract
exists.
