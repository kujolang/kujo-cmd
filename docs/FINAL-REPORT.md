# Command Code local integration final report

> Historical note: this report records the original MCP-repository paths used
> before Kujo CMD moved to `kujolang/kujo-cmd`. Product files now live at this
> repository root; the path list below is preserved as release evidence.

## Outcome

Kujo's Ability architecture can support a substantially different agent host
without rebuilding Kujo. The zero-extension hypothesis was correct for host
transport and wrong for complete product delivery: standard MCP was enough for
Command Code, but a reusable local Ability host and portable profile contract
were needed to deliver local tools from npm without an application gateway.

The result is `@kujolang/kujo-cmd` 0.1.0, a release candidate for:

```text
npx @kujolang/kujo-cmd setup
```

It acquires every supported canonical source at a reviewed commit, installs a
durable copy of the official platform runtime and projection, configures one
STDIO MCP server, projects canonical skills for the selected profile, and runs
a real local Ability smoke test. No Kujo-hosted service is required.

## Implemented capability

- Four portable profiles and per-Ability enable/disable without reinstalling.
- Fourteen local Abilities spanning catalog/receipts, Scout, Scent,
  PatchBrief, ChangeBucket, ShipCheck, Fence, Spec, Eval, RunLedger, Dispatch,
  RAG, and Watchdog health.
- Dynamic schema/effect/digest discovery, structured results/errors,
  cancellation, concurrent calls, request-bound approval, keyed idempotency,
  persistent receipts, and restart recovery.
- Commands: `setup`, `doctor`, `status`, `profiles`, `profile`, `abilities`,
  `enable`, `disable`, `approve`, `services`, `update`, `repair`, and
  `uninstall`.
- Canonical Agent Skills projection and optional loopback Watchdog lifecycle.
- Exact protocol-version rejection and explicit feature degradation.

## Verification

Automated tests cover profile inheritance/overrides, schema metadata,
configuration merging/removal, skills projection, fail-closed approvals,
approval replay, idempotency conflict/replay across restart, cancellation,
concurrency, protocol mismatch, canonical PatchBrief and Scout invocation,
receipt correlation, offline local-source setup, and packed-artifact setup.

A fresh network acquisition of all 14 pinned repositories completed in under
30 seconds on the verification host. The generated npm tarball installed via
`npx --package=<tarball> kujo-cmd setup`; the resulting installation required
no hosted endpoint.

The model-driven replay passed with Command Code 1.53.1 and
`ollama/glm-5.3:cloud`: the model called
`mcp__kujo__kujo_ability_catalog` exactly once, received the Essentials catalog
and a succeeded local receipt, and accurately reported the returned capability
IDs. Command Code's local-only auth-value inconsistency was handled with the
existing non-secret sentinel under `CMD_LOCAL_ONLY=1`; no Command Code account
session or Kujo-hosted service was used. Evidence is in
`certification/evidence/command-code-kujo-cmd-live-2026-09-13.json`.

## Release assumptions and limitations

- Publish only after explicit release authorization; neither package nor
  source pins were published by this work.
- Runtime support follows `@kujolang/kujo-runtime@1.4.0`: macOS x64/arm64,
  Linux x64/arm64, and Windows x64. Only macOS x64 was executed here.
- Initial setup/update requires npm, Git, and GitHub; execution is offline.
- Command Code needs restart/tool refresh after profile changes.
- Host/session/model/agent metadata is caller-asserted until MCP or a stable
  Command Code API provides attestation.
- Native lifecycle telemetry, host-agent delegation, and Jidoka completion
  gating remain future generic Host Capability work.
- Local state now uses cross-process locking and per-key idempotency records;
  network-filesystem locking is intentionally outside the local-host contract.
- Large command/MCP output and receipt retention are bounded. Receipt listings
  are summary-first so routine inspection does not replay old payloads into the
  model context.

## Production-readiness hardening

The pre-publication review fixed intermediate symlink project escapes, forged
skill-manifest deletion paths, project-controlled executable/source paths,
approval/idempotency races, unbounded hot-state/output/receipt growth, unsafe
purge targets, and stale Watchdog PID signaling. Release actions, runner images,
and npm tooling are pinned. The initial npm publication still uses the scoped
bootstrap token because npm trusted publishing cannot be configured for a
package before that package exists; the workflow is already OIDC-capable and
the token should be removed immediately after trusted publishing is enabled.

## Recommended follow-up

Record the verified live GLM 5.3 scenario as an updated real-TUI video. Then
validate the packed artifact on macOS arm64, Linux x64/arm64, and Windows x64
before npm publication. Promote each catalog entry into its product repository
as a signed domain-owned Ability pack as those packages adopt the stable
profile/local-host contract.

## Exact changed files

Ability repository:

- `README.md`
- `ability.kujo`
- `schema/ability-profile.schema.json`
- `src/index.kujo`
- `src/profile.kujo`
- `tests/contract_tests.kujo`

MCP repository:

- `.github/workflows/kujo-cmd.yml`
- `README.md`
- `certification/evidence/ability-hosts-local.json`
- `certification/evidence/command-code-kujo-cmd-live-2026-09-13.json`
- `docs/ability-host-conformance.md`
- `docs/command-code/ADR.md`
- `docs/command-code/COMMAND-CODE.md`
- `docs/command-code/FINAL-REPORT.md`
- `docs/command-code/GAP-ANALYSIS.md`
- `docs/command-code/RESEARCH.md`
- `docs/command-code/THREAT-MODEL.md`
- `integrations/kujo-ability/CHANGELOG.md`
- `integrations/kujo-ability/README.md`
- `integrations/kujo-ability/lib/local-runtime.mjs`
- `integrations/kujo-ability/package.json`
- `integrations/kujo-cmd/.gitignore`
- `integrations/kujo-cmd/CHANGELOG.md`
- `integrations/kujo-cmd/LICENSE`
- `integrations/kujo-cmd/README.md`
- `integrations/kujo-cmd/SECURITY.md`
- `integrations/kujo-cmd/bin/kujo-cmd-mcp.mjs`
- `integrations/kujo-cmd/bin/kujo-cmd.mjs`
- `integrations/kujo-cmd/catalog/abilities.json`
- `integrations/kujo-cmd/catalog/profiles.json`
- `integrations/kujo-cmd/catalog/sources.json`
- `integrations/kujo-cmd/lib/app.mjs`
- `integrations/kujo-cmd/lib/catalog.mjs`
- `integrations/kujo-cmd/lib/executor.mjs`
- `integrations/kujo-cmd/lib/install.mjs`
- `integrations/kujo-cmd/lib/installation.mjs`
- `integrations/kujo-cmd/lib/io.mjs`
- `integrations/kujo-cmd/lib/paths.mjs`
- `integrations/kujo-cmd/lib/process.mjs`
- `integrations/kujo-cmd/package-lock.json`
- `integrations/kujo-cmd/package.json`
- `integrations/kujo-cmd/scripts/build-release.mjs`
- `integrations/kujo-cmd/tests/catalog.test.mjs`
- `integrations/kujo-cmd/tests/runtime.test.mjs`
- `integrations/kujo-cmd/tests/security.test.mjs`
- `integrations/kujo-cmd/tests/setup.test.mjs`
- `scripts/run-command-code-kujo-cmd-demo.sh`
- `tests/command_code_kujo_cmd_live_evidence_test.mjs`
- `tests/command_code_local_package_test.mjs`
- `tests/command_code_package_release_test.mjs`
- `tests/run_all_tests.sh`
- `tests/test_13_command_code_catalog.kujo`

## Commands executed for final verification

- `KUJO_BIN=../kujo/target/release/kujo bash tests/run_tests.sh` in the
  Ability repository.
- `npm test` and `npm audit --omit=dev` in `integrations/kujo-cmd`.
- `node scripts/certify-ability-hosts.mjs` and
  `node scripts/generate-ability-compatibility.mjs`.
- `bash tests/run_all_tests.sh` in the MCP repository.
- Packed-tarball `npx --package=<tarball> kujo-cmd setup`, fresh pinned-source
  acquisition, real Command Code configuration inspection, optional Watchdog
  start/health/stop, and a model-driven `ollama/glm-5.3:cloud` tool call.
