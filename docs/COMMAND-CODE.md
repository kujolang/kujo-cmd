# Using Kujo from Command Code

## Install

```bash
cd /path/to/your/project
npx @kujolang/kujo-cmd setup
command-code
```

That installs the full supported Kujo source catalog and official Kujo runtime
under the user's local data directory, adds one project STDIO MCP server, links
the relevant canonical Agent Skills, and performs a real discovery call. No
Kujo account, public server, managed gateway, manual repository clone, or
per-tool wiring is required. GitHub/npm are needed for initial acquisition and
updates; normal execution is local and works offline.

To pin a project to this release, include the version:

```bash
npx @kujolang/kujo-cmd@0.1.1 setup
```

## What appears in Command Code

The default Essentials profile exposes catalog and receipt inspection plus
Scout, PatchBrief, and ShipCheck. Review adds ChangeBucket, Fence, Spec, and
Scent. Ship adds Eval and RunLedger. Full adds Dispatch validation, local RAG
query, and optional Watchdog health. Every source is already local, so changing
profiles is instant:

```bash
kujo-cmd profiles
kujo-cmd profile kujo.profile.review
kujo-cmd abilities
kujo-cmd enable kujo.rag.knowledge.query
```

Restart Command Code after changing profile exposure. New catalog entries are
projected dynamically; no per-tool host registration code is needed.

## Approvals and receipts

Read-only calls execute under local policy. Write/delete/external calls return
`ability_approval_required` with the exact Ability ID, invocation ID, and input.
Copy those values into:

```bash
kujo-cmd approve \
  --ability kujo.scout.repository.inspect \
  --invocation scout-1 \
  --input '{"path":".","quick":true,"output_dir":".kujo/scout"}'
```

Retry the identical call with the returned value in `_kujo.approvalId`, the
same `_kujo.invocationId`, and an `_kujo.idempotencyKey`. The approval expires,
is input/principal/digest-bound, and can be consumed once. Command Code's own
tool prompt remains an independent outer permission boundary.

Receipts live at `~/.local/share/kujo/cmd/receipts.jsonl` by default and are
also returned as MCP structured content. Use `kujo_ability_receipts` or
`kujo-cmd status` to locate them. `_kujo.sessionId`, `runId`, `agentId`, and
`modelId` are retained for correlation but are caller-asserted because MCP does
not provide verified Command Code host identity. Receipt listings omit prior
result bodies by default to save context; set `include_result: true` when a full
result is specifically needed. The active log rotates at 8 MiB and retains
three archives. Keyed replay storage is bounded to the newest 32 completed
records per digest shard (256 shards), so idempotency keys are retry controls,
not permanent records.

## Local models

Kujo CMD does not choose or proxy the model. Command Code can use its supported
Ollama provider, including `ollama/glm-5.3:cloud`, independently of Kujo.
Command Code 1.53.1 still checks that an auth value exists before entering its
documented local-only/BYOK path. The verified local launcher sets
`CMD_LOCAL_ONLY=1` and the non-secret sentinel
`COMMAND_CODE_API_KEY=local-only-placeholder`; it is not a Command Code
credential and must never be used without local-only mode. With that host
workaround, `ollama/glm-5.3:cloud` completed a real model-driven Kujo CMD tool
call without a Command Code account session.

## Operations and troubleshooting

```bash
kujo-cmd doctor --json
kujo-cmd status
kujo-cmd repair
kujo-cmd update
kujo-cmd services start watchdog   # optional, loopback only
kujo-cmd services status watchdog
kujo-cmd uninstall                 # keep shared sources and receipts
kujo-cmd uninstall --purge         # remove shared local data too
```

If tools do not appear, run `kujo-cmd doctor`, inspect `.mcp.json`, and restart
Command Code. Plan mode hides MCP tools. If a command fails, inspect the
structured error and receipt rather than retrying a mutating call blindly.
`KUJO_CMD_HOME` relocates shared state. `KUJO_BIN` selects a compatible runtime
only during an explicit setup/update; project files cannot redirect execution
to another binary or source tree.

## Example workflow

Ask Command Code:

> Use the Kujo Ability catalog. Summarize my current changes with PatchBrief,
> measure their footprint with ChangeBucket, validate the task Spec, and run a
> ShipCheck scan. Cite the receipt IDs and do not claim success for any failed
> check.

The host discovers these through one MCP connection. Each call runs the
canonical product locally and returns a correlated Ability receipt.
