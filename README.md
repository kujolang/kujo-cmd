# `@kujolang/kujo-cmd`

Local-first Kujo for Command Code.

```bash
npx @kujolang/kujo-cmd setup
command-code
```

Setup acquires the version-pinned Kujo tool catalog, the cross-platform Kujo
runtime, and canonical Agent Skills; stores them locally; writes one `kujo`
STDIO MCP entry; projects only the skills relevant to the selected profile;
and runs a real Ability discovery smoke test. It does not require a Command
Code account when Command Code is running in BYOK/local-only mode, and it does
not require a Kujo cloud account or Kujo-hosted execution service.

## What users get

- Dynamic MCP discovery: a new catalog Ability appears without new host code.
- Canonical Scout, Scent, PatchBrief, ChangeBucket, ShipCheck, Fence, Spec,
  Eval, RunLedger, Dispatch, RAG, and optional Watchdog surfaces.
- Effect metadata and independent fail-closed approval for non-read work.
- Structured output, errors, cancellation, idempotency, and restart-safe local
  receipts with run/model/session correlation.
- Canonical Kujo Agent Skills projected from one pinned source rather than
  maintained Command Code copies.

The default `kujo.profile.essentials` profile keeps discovery compact. Every
supported source is still installed locally. Change exposure without another
download:

```bash
kujo-cmd profiles
kujo-cmd profile kujo.profile.review
kujo-cmd enable kujo.rag.knowledge.query
kujo-cmd disable kujo.scout.repository.inspect
```

Profiles control exposure only. They never grant authority or alter an
Ability's effect declaration.

## Approval flow

Read-only calls execute locally. An Ability with `write`, `delete`, or
`external` effects first returns `ability_approval_required` with the exact
approval command. The human runs that command, then retries the same input and
invocation ID with `_kujo.approvalId`. Approvals expire after five minutes,
are bound to the principal, Ability digest, invocation, and input, and are
consumed once.

## Operations

```bash
kujo-cmd doctor --json
kujo-cmd status
kujo-cmd abilities
kujo-cmd services status watchdog
kujo-cmd services start watchdog   # optional local loopback dashboard
kujo-cmd repair
kujo-cmd update
kujo-cmd uninstall                 # keeps shared sources and receipts
kujo-cmd uninstall --purge         # removes shared local Kujo CMD data
```

Declarative project configuration lives in `.kujo/cmd.json`; executable and
source locations are trusted installation metadata under the user-owned Kujo
CMD data root. Command Code reads `.mcp.json`; the standard skills projection
is `.agents/skills`; shared sources and receipts default to
`~/.local/share/kujo/cmd`. `KUJO_CMD_HOME` changes that root. `KUJO_BIN` may
select a compatible runtime during an explicit `setup` or `update`; projects
cannot override the installed executable.

Receipt logs rotate at 8 MiB with three local archives. Receipt-list calls
return summaries by default; pass `include_result: true` only when full prior
results are needed. Command output, MCP requests, structured results, and
error details have explicit size limits. Keyed replay records are sharded and
retain the newest 32 completed calls in each of 256 digest shards; callers must
not treat an idempotency key as permanent storage.

## Development and offline setup

The normal npm install acquires pinned public sources once and then runs
offline. Repository development can use existing checkouts without network:

```bash
npm run build
node bin/kujo-cmd.mjs setup --source-root /path/to/kujo-repos
```

The release build copies the generic local Ability host runtime from the
portable `kujo-ability` integration. Command Code-specific code owns setup,
configuration, profiles, skills, diagnostics, and projection only; canonical
Kujo tools retain their business logic.
