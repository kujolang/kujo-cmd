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

### ChatGPT follow-up: live verification still blocked

On 2026-10-20, Command Code auto-updated to 1.85.1 while listing models.
The packed-package compatibility checks reached the live-session step, but
that step again exited with code 3, `Not authenticated`, before any model or
Kujo tool execution. ChatGPT login credentials are present under the `codex`
provider, and the selected provider is `codex`; this is not evidence that the
user omitted the ChatGPT login. Interactive startup also requests a separate
Command Code account login.

Inspection of the installed 1.85.1 CLI shows that print mode's authentication
preflight calls `getCommandAuthKey`, which checks the Command Code API key;
it does not accept the stored ChatGPT provider login at that stage. The public
BYOK documentation advertises ChatGPT subscriptions, but that login alone has
not unblocked this installed host. No workaround that bypasses authentication
or changes host code was used.

The remaining gate is an actual model-driven catalog call and real session
registration of `/kujo` and its MCP tools. Resolve the host authentication gate
(with a Command Code account or an upstream-supported provider-only startup),
then rerun `KUJO_CMD_LIVE_MODEL=<available-model-id> npm run test:command-code`.
Do not describe the submission as fully live-verified until that passes.
Ollama has been removed from this machine and is no longer a test option.
Desktop behavior and other operating systems require their own host checks;
the CI package suite covers Linux, macOS, and Windows on Node 20 and 22.

This document prepares the submission; it does not claim that the directory
PR has been opened, accepted, or that version 0.3.0 has been published to npm.
