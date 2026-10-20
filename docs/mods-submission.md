# Suggested directory PR

Title: Add Kujo CMD lifecycle and status mod

Kujo CMD adds `/kujo` help, setup instructions, and session MCP status, plus
metadata-only Watchdog correlation and a one-shot continuation after failed
Kujo calls. The existing local MCP integration supplies repository checks,
request-bound approvals, and receipts after an explicit setup step.

This entry uses the existing `kujolang/kujo-cmd` GitHub package. Its manifest
points to the shipped TypeScript factory; no build or postinstall is needed
when installing the mod. `setup --mod-mode package` configures the tools and
migrates an owned projected bridge without registering a second copy.

Append the object from `mods-registry-entry.json` to the upstream registry.
The registered surfaces are `command` and `hook`. Do not mark this as an
official Command Code mod. npm metadata can be added after 0.3.0 is published.

## Verification record

Verified 2026-10-20 on macOS 26.6.2 x86_64, Node 26.7.0. The globally installed
`command-code` and `cmd` were upgraded from 1.75.1 to 1.85.0 (npm latest at the
time of verification).

- All 22 automated package, runtime, approval, security, setup/migration and mod tests
  pass, including tarball file/entrypoint checks and no-postinstall packaging.
- Command Code 1.85.0: MCP enabled, three active skills discovered, five
  Essentials Abilities, seven scoped agents; TypeScript factory and one-shot
  stop hook exercised by the compatibility check.
- The registry entry validates against the upstream JSON schema (2026-10-20).
- Command Code’s mod installer accepts the packed package as a local source;
  its source inspector identifies the slash command and lifecycle hooks.
- Direct GitHub install of the submitted source succeeds via `cmd mods add`.
- Fresh default setup acquires all 25 pinned source repositories; doctor passes
  with the Ship profile and a working headless browser.
- Real MCP end-to-end checks pass against those pinned sources: inventories of
  5/18/29/38 tools for Essentials/Review/Ship/Full; 19 distinct tools exercised,
  including actual browser capture, approval-gated writes, receipts and restart.
  All 38 Full-profile tools have input/output schemas and Ability identities.
  This is representative execution coverage, not an assertion that every one
  of the 38 tools and every provider combination was executed.
- Testing found and fixed a false Lens dependency failure: its installer uses
  Playwright's headless shell, so readiness now probes a real headless launch.
- A production-only install of the packed tarball with `--ignore-scripts`
  succeeds. No Kujo source checkout or build script is needed to load the mod.

Interactive startup on this machine stops at Command Code authentication;
no interactive slash-command or actual session-loader pass is claimed.
The model-driven test was attempted with `ollama/glm-5.3:cloud`, but Command
Code rejected it before model execution with exit code 3, `Not authenticated`.
Run `cmd login`, then rerun the live verification before calling this a complete
submission check. Desktop behavior and other
operating systems require their own host checks; the CI package suite covers
Linux, macOS, and Windows on Node 20 and 22.

This document prepares the submission; it does not claim that the directory
PR has been opened, accepted, or that version 0.3.0 has been published to npm.
