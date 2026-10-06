# Changelog

## Unreleased

- Repin the supported Kujo source set and add CaseFile, Concord, Muzzle, and
  Kennel to the coordinated local installation.
- Add approval-gated CaseFile capture, Muzzle execution, Kennel install,
  Dispatch execution, RAG ingest, and Watchdog telemetry Abilities, plus
  read-only Concord and Kennel validation.
- Project a Command Code mod for metadata-only Watchdog correlation, optional
  RunLedger recording, subagent correlation, and a one-shot Jidoka stop gate.
- Project four scoped Command Code agents with explicit Kujo MCP allowlists and
  documented identity and approval boundaries.
- Verify setup, MCP discovery, skills discovery, and an optional live Kujo tool
  call against an installed Command Code host.
- Update the bundled Kujo runtime to 1.8.0 and copy the resolved native runtime
  rather than preserving an external executable symlink.

## 0.1.4 - 2026-09-14

- Match the monochrome README badge system used across Kujo repositories.

## 0.1.3 - 2026-09-14

- Derive CLI, installation, and MCP server versions from the package manifest
  so runtime identity cannot drift from the published package version.

## 0.1.2 - 2026-09-14

- Move Kujo CMD into its own GitHub repository with preserved package history.
- Point npm metadata, issues, CI, and releases at `kujolang/kujo-cmd`.
- Make release builds standalone by verifying a committed, digest-pinned
  snapshot of the canonical Ability host runtime.
- Move Command Code research, architecture, security, and release documents
  with the product.

## 0.1.1 - 2026-09-13

- Rewrite the npm README around installation, available tools, profiles,
  approvals, receipts, local models, and real Command Code examples.
- Link the live Command Code launch demo and Ability walkthrough.
- Publish the documentation and demo updates made since 0.1.0.

## 0.1.0 - 2026-09-13

- Add one-command local setup for Command Code.
- Add portable, profile-filtered Ability discovery over STDIO MCP.
- Add pinned local acquisition for the supported Kujo tool and skill catalog.
- Preserve effects, approvals, idempotency, identities, receipts, cancellation,
  and restart-safe local state.
- Add optional loopback-only Watchdog service management.
- Harden project boundaries against intermediate symlink escapes, forged skill
  manifests, project-controlled executable paths, unsafe purge roots, and stale
  Watchdog PID reuse.
- Add cross-process approval/idempotency locking, sharded idempotency records,
  bounded and rotated receipts, bounded MCP/command output, and compact receipt
  summaries.
- Pin release workflow actions and npm tooling to immutable versions.
