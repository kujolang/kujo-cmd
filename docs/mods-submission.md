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

- All 21 automated package, runtime, approval, security, setup/migration and mod tests
  pass, including tarball file/entrypoint checks and no-postinstall packaging.
- Command Code 1.85.0: MCP enabled, three active skills discovered, five
  Essentials Abilities, seven scoped agents; TypeScript factory and one-shot
  stop hook exercised by the compatibility check.
- The registry entry validates against the upstream JSON schema (2026-10-20).
- Command Code’s mod installer accepts the packed package as a local source;
  its source inspector identifies the slash command and lifecycle hooks.
- A production-only install of the packed tarball with `--ignore-scripts`
  succeeds. No Kujo source checkout or build script is needed to load the mod.

Interactive startup on this machine stops at Command Code authentication;
no interactive slash-command or actual session-loader pass is claimed.
The model-driven optional host test was not run. Desktop behavior and other
operating systems require their own host checks; the CI package suite covers
Linux, macOS, and Windows on Node 20 and 22.

This document prepares the submission; it does not claim that the directory
PR has been opened, accepted, or that version 0.3.0 has been published to npm.
