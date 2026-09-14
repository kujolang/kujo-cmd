# Kujo CMD

[![Version](https://img.shields.io/badge/version-0.1.4-black)](https://github.com/kujolang/kujo-cmd/releases/tag/v0.1.4)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)
[![built with Kujo](https://img.shields.io/badge/built%20with-Kujo-white.svg)](https://github.com/kujolang/kujo)

Run Kujo tools and Agent Skills inside [Command Code](https://commandcode.ai/).
Kujo CMD installs everything in your own environment and connects it to the
current project through one local MCP server.

```bash
cd /path/to/your/project
npx @kujolang/kujo-cmd setup
command-code
```

No Kujo account or hosted Kujo service is required. The first setup downloads
the pinned Kujo tools and runtime. After that, normal use is local and works
offline.

## What it adds to Command Code

Kujo CMD exposes canonical Kujo products as portable Abilities. Command Code
discovers them as MCP tools, so a new Ability can appear without a new host
adapter or another npm package.

| Kujo product | What Command Code can do |
|---|---|
| Ability | Discover the active catalog and inspect receipts |
| Scout | Inspect a repository and create a bounded context report |
| Scent | Build a redacted, token-budgeted handoff pack |
| PatchBrief | Summarize changed files, risk, and review guidance |
| ChangeBucket | Measure change size and blast-radius signals |
| ShipCheck | Scan release readiness |
| Fence | Check architecture boundaries |
| Spec | Validate a task contract |
| Eval | Run a deterministic evaluation suite |
| RunLedger | Read and report local agent-run evidence |
| Dispatch | Validate an agent workflow without running it |
| RAG | Query a local Kujo index with citations |
| Watchdog | Check an optional local Watchdog service |

Each call keeps its Ability identity, declared effects, policy decision,
invocation ID, receipt ID, and any supplied session, run, agent, or model IDs.
Kujo still owns the tool logic; Kujo CMD only installs and projects it.

## Choose how much Command Code sees

Setup installs the full supported catalog, but the active profile controls what
Command Code sees. The default **Essentials** profile exposes five tools.

| Profile | Tools | Adds |
|---|---:|---|
| Essentials | 5 | Catalog, receipts, Scout, PatchBrief, ShipCheck |
| Review | 9 | ChangeBucket, Fence, Spec, Scent |
| Ship | 11 | Eval, RunLedger |
| Full | 14 | Dispatch, RAG, Watchdog |

```bash
kujo-cmd profiles
kujo-cmd profile kujo.profile.review
kujo-cmd abilities
kujo-cmd enable kujo.rag.knowledge.query
kujo-cmd disable kujo.scout.repository.inspect
```

Profiles change exposure, not permissions. Restart Command Code after changing
the active profile.

## Use it

Ask Command Code to use Kujo by name:

> Use Kujo PatchBrief to summarize my current changes, then run Kujo
> ShipCheck. Report the policy decision and receipt ID for each call.

For a broader release review:

> Use the Kujo Ability catalog. Measure this change with ChangeBucket,
> validate the task Spec, run ShipCheck, and cite every receipt ID. Do not
> report success if any check fails.

- [Watch the 26-second Command Code launch demo](https://github.com/kujolang/mcp/blob/main/demos/command-code-ollama-live-proof/command-code-ollama-kujo-live-polished.mp4)
- [Watch the 56-second Ability walkthrough](https://github.com/kujolang/mcp/blob/main/demos/command-code-ability-walkthrough/renders/command-code-ability-walkthrough_2026-09-13_19-28-55.mp4)

## Approvals and receipts

Read-only Abilities run under local policy. An Ability with `write`, `delete`,
or `external` effects stops first and returns `ability_approval_required` plus
an exact approval command. Run that command, then retry the same input and
invocation ID with the returned `_kujo.approvalId`.

Approvals expire after five minutes. Each approval is bound to the principal,
Ability digest, invocation, and input, and can be used once. Command Code's own
tool permission prompt remains a separate outer check.

Receipts are returned as structured MCP content and stored at
`~/.local/share/kujo/cmd/receipts.jsonl` by default. Use
`kujo_ability_receipts` or `kujo-cmd status` to find and inspect them.

## Manage the installation

```bash
kujo-cmd doctor --json
kujo-cmd status
kujo-cmd repair
kujo-cmd update
kujo-cmd services start watchdog   # optional; loopback only
kujo-cmd services status watchdog
kujo-cmd uninstall                 # keep shared sources and receipts
kujo-cmd uninstall --purge         # remove shared Kujo CMD data
```

Setup writes `.mcp.json`, `.kujo/cmd.json`, and the relevant links under
`.agents/skills`. Shared sources and receipts default to
`~/.local/share/kujo/cmd`. Set `KUJO_CMD_HOME` to move that data root.

Kujo CMD does not choose or proxy your model. Command Code can use any provider
it supports, including Ollama. The live demos use `ollama/glm-5.3:cloud`.

## Troubleshooting

If the tools do not appear, run `kujo-cmd doctor`, check `.mcp.json`, and
restart Command Code. Plan mode hides MCP tools. When a call fails, read its
structured error and receipt before retrying a mutating operation.

The active receipt log rotates at 8 MiB and keeps three archives. Receipt
queries return summaries unless `include_result: true` is set. Idempotency keys
are bounded retry controls, not permanent storage.

## Development

Repository development can use existing Kujo checkouts without a download:

```bash
npm run build
node bin/kujo-cmd.mjs setup --source-root /path/to/kujo-repos
npm test
```

The release contains a generated snapshot of the generic Ability host runtime.
`.generated/BUILD.json` pins its canonical source commit, path, and SHA-256
digest. `npm run build` verifies that snapshot before tests or publication.
Command Code-specific code handles setup, configuration, profiles, skills,
diagnostics, and projection only.
