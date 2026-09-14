# Kujo CMD v0.1.0

Kujo CMD gives Command Code users one local installation surface for portable
Kujo Abilities and canonical Agent Skills:

```bash
npx @kujolang/kujo-cmd@0.1.0 setup
```

The release installs the supported Kujo source catalog and runtime into the
user's local data directory, configures one project STDIO MCP connection, and
exposes a profile-selected capability set. Normal execution is local and does
not require a hosted Kujo account or managed gateway.

## Included

- Four portable profiles with per-Ability enable and disable overrides.
- Fourteen local Abilities covering catalog and receipts, Scout, Scent,
  PatchBrief, ChangeBucket, ShipCheck, Fence, Spec, Eval, RunLedger, Dispatch,
  RAG, and optional Watchdog health.
- Canonical Agent Skills projection from one shared source.
- Structured effects, approvals, errors, identities, artifacts, idempotency,
  cancellation, persistent receipts, and restart recovery.
- Setup, doctor, status, profile, ability, approval, service, update, repair,
  and uninstall commands.
- Verified Command Code 1.53.1 execution with Ollama Cloud GLM 5.3.

## Requirements

- Node.js 20 or newer.
- Git and GitHub access during initial source acquisition and updates.
- Command Code with an independently configured supported model provider.

Runtime packages are available for macOS x64/arm64, Linux x64/arm64, and
Windows x64. See the [installation guide](COMMAND-CODE.md),
[security model](THREAT-MODEL.md), [hardening evaluation](HARDENING-EVALUATION.md),
and [final report](FINAL-REPORT.md) for operational details and current
limitations.
