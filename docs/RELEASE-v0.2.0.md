# Kujo CMD 0.2.0

Kujo CMD 0.2.0 expands the Command Code integration from the original core
catalog to 25 pinned Kujo sources, 38 portable Abilities, four exposure
profiles, seven scoped agents, and one trust-gated correlation mod.

## Highlights

- Add CaseFile, Concord, Muzzle, Kennel, Redact, VersionSeal, PackWrite,
  Tribunal, Dossier, Howl, and Lens integrations.
- Add approval-gated workflow execution, dependency installation, RAG ingest,
  failure capture, telemetry, browser checks, rendering, and pack generation.
- Add explicit RunLedger start and finish operations plus optional automatic
  Command Code correlation.
- Add Lens flow validation and an explicit `kujo-cmd browser install|status`
  lifecycle for real Chromium checks.
- Add seven task-scoped Command Code agents with explicit MCP allowlists.
- Add a metadata-only Watchdog bridge with bounded spooling and a one-shot
  Jidoka stop gate.
- Verify setup, MCP discovery, projected skills and agents, and host
  compatibility against Command Code 1.75.1.

## Install

```bash
cd /path/to/your/project
npx @kujolang/kujo-cmd@0.2.0 setup
command-code
```

Existing installations can run `kujo-cmd update`, then restart Command Code.
Run `kujo-cmd doctor --json` to verify the projected configuration. Lens flow
validation is immediately available; install its optional browser runtime with
`kujo-cmd browser install` before using real-page checks.

## Exposure profiles

| Profile | Exposed tools |
| --- | ---: |
| Essentials | 5 |
| Review | 18 |
| Ship | 29 |
| Full | 38 |

Profiles change exposure, not authorization. Command Code permission prompts
and Kujo's request-bound approvals remain independent enforcement layers.
