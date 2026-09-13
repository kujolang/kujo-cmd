# Changelog

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
