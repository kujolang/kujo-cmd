# Command Code mods directory

Kujo CMD is both a native Command Code mod and a local MCP integration. The
mod adds `/kujo` help/setup/status and lifecycle hooks. The existing MCP server
supplies the Ability tools, request-bound approvals, and receipts. Installing
only the mod does not configure MCP or download the Kujo tool sources.

## Install from GitHub

From the project you want to use with Kujo:

```sh
cmd mods add kujolang/kujo-cmd
```

For a reproducible installation, append `@<commit-or-tag>` to that source.
Start Command Code, trust the project, and use `/kujo` or `/kujo status`.
The bridge is listed as `kujo-command-bridge` by `cmd mods list`.

Configure the tools using the CLI shipped in the installed package. Run
`/kujo setup` inside Command Code: it prints the exact command for that package.
Run that command in your project terminal; its form is:

```sh
node /absolute/path/to/installed/kujo-cmd/bin/kujo-cmd.mjs setup --mod-mode package
```

This uses the same version as the installed mod without requiring an npm
release. Node 20+, Git, and the platform's optional Kujo runtime dependency are
required. Setup downloads pinned sources on first use, writes `.mcp.json`,
links the active skills, and projects seven scoped agents. Restart Command Code
after setup. Run `/kujo status` and ask it to call `kujo_ability_catalog` to
verify tool discovery. `kujo-cmd doctor` provides fuller local diagnostics.

## Install from npm after 0.3.0 is published

```sh
cmd mods add @kujolang/kujo-cmd@0.3.0
npx @kujolang/kujo-cmd@0.3.0 setup --mod-mode package
```

Do not use an older npm version: it has no mod manifest. The `/kujo setup`
command prints the installed CLI’s exact path; it does not run installation, modify the project,
spend model tokens, or grant approvals. There is no postinstall script.
Command Code installs mod packages with npm lifecycle scripts disabled.

## Existing Kujo CMD users

Install the package through `cmd mods add`, then run its setup with
`--mod-mode package`. Setup removes its owned project bridge while retaining
the agents, selected profile, and Ability overrides. It refuses an unowned
bridge with the same filename; move or remove that file yourself first.
`repair`, `update`, and subsequent `setup` calls retain package mode.

Without this option, the existing standalone `kujo-cmd setup` flow continues
to project a bridge. Both copies use the same name, so the host shadows a
collision, but migrate rather than relying on a potentially stale copy.

The mod can also be installed globally with `cmd mods add -g`. Configure MCP
separately in each project using package mode. Project mods require workspace
trust; global mods load for every project. `/kujo status` uses the host's
workspace, not the process's initial working directory.

To remove the entire integration, run `kujo-cmd uninstall` in the project,
then `cmd mods remove kujolang/kujo-cmd` (or the npm source you installed).
Removing the mod alone leaves the independently configured MCP tools, skills,
and agents. Uninstall preserves shared sources and receipts unless `--purge`
is explicitly requested. Do not purge shared data still used by other projects.

## Behavior and boundaries

- Hooks record metadata-only session, subagent, and Kujo tool events to local
  Watchdog, with bounded on-disk spooling while it is unavailable.
- A failed Kujo MCP call permits one continuation per run. `KUJO_CMD_JIDOKA=0`
  disables it; it does not approve or automatically retry a mutating Ability.
- RunLedger start/finish recording remains opt-in with `KUJO_CMD_RUNLEDGER=1`.
- The mod registers commands and hooks, not duplicate native Ability tools.
  MCP policy, effect declarations, and human approval requirements remain intact.
- Canonical skills are selected and installed by setup, not falsely declared as
  bundled `commandcode.skills` entries.
- The ModApi is experimental. Recheck host compatibility before each release.
  CLI verification is not proof of Desktop end-to-end compatibility.

## Submit to the directory

The prepared entry in `docs/mods-registry-entry.json` uses the GitHub source,
so it can be submitted once this change is available on the repository's main
branch. It intentionally omits `npm` until the mod-capable release is published.
Open a PR adding that object to the `mods` array in
[CommandCodeAI/command-code/mods/registry.json](https://github.com/CommandCodeAI/command-code/blob/main/mods/registry.json).
Keep all existing entries. Maintainers review submissions; a package keyword
or npm publication alone does not create a listing.

If using npm instead, set both `source` and `npm` to `@kujolang/kujo-cmd`
after verifying the published package contains the mod entrypoint. The correct
kinds are `command` and `hook`: the mod's tools come through separate MCP setup.
A submission description is provided in `docs/mods-submission.md`.

## Verification

```sh
npm ci --ignore-scripts
npm test
npm run test:command-code
```

For real-tool and browser coverage (after installing Lens through the CLI):

```sh
KUJO_CMD_REQUIRE_BROWSER=1 npm run test:e2e
```

Use `KUJO_SOURCE_ROOT` to point the checks at verified pinned checkouts when
validating a release rather than local development repositories. The e2e
result names the tools exercised and explicitly reports browser skips.

After `cmd login`, run the optional real-session test with an available model:

```sh
KUJO_CMD_LIVE_MODEL=<available-model-id> npm run test:command-code
```

This loads the packaged mod into the actual host, calls the catalog through
MCP, and records host command/tool registration via a temporary probe mod.
It makes a real model call and requires that provider to be configured.

The host check uses a disposable project and Kujo data root. The optional
`KUJO_CMD_LIVE_MODEL` check makes a model call; omit it for local checks.
The pack test validates the published file list and manifest. Mod tests load
the TypeScript factory and exercise onboarding, status, stop hooks, and
projection migration. See the submission notes for the actual host versions
and checks verified for this change.

Sources checked 2026-10-20:
[Mod packaging and listing](https://commandcode.ai/docs/mods#packaging-and-install),
[registry schema](https://github.com/CommandCodeAI/command-code/blob/main/mods/registry.schema.json).

### Independent live provider check

When host authentication prevents a Command Code session, a local
OpenAI-compatible proxy (for example Hermes/Nous) can separately verify the
model-to-MCP path:

```sh
KUJO_CMD_PROVIDER_URL=http://127.0.0.1:8645/v1 \
KUJO_CMD_PROVIDER_MODEL=<available-tool-capable-model> npm run test:provider
```

The check uses a disposable project and Kujo data root, discovers real MCP
schemas, asks the model to generate one call each to catalog, PatchBrief and
ShipCheck, checks successful receipts, and asks the model to consume each
result. Only these read-only tools are exposed. Set `KUJO_SOURCE_ROOT` to
pinned source checkouts; otherwise setup acquires the pinned catalog.
`KUJO_CMD_PROVIDER_TOKEN` optionally supplies the local proxy bearer; the
Hermes default is a non-secret placeholder. Credentials remain in the proxy.
Only loopback proxy URLs are accepted. The proxy may forward inference to a
cloud provider; this is not an offline model test. Provider access and quota
are required. This check does not certify Command Code authentication,
interactive slash commands, or session mod loading.

### Command Code sessions through Hermes

Add this entry to the `provider` object in `~/.commandcode/providers.json`,
preserving existing entries (the local Hermes proxy manages its Nous login):

```json
"hermes": {
  "name": "Hermes (Nous local proxy)",
  "baseURL": "http://127.0.0.1:8645/v1",
  "apiKey": false,
  "models": { "poolside/laguna-s-2.1:free": {} }
}
```

Command Code 1.85.1 requires a nonempty Command Code key at startup even for
local-only BYOK. For the verified local-only test workaround:

```sh
KUJO_CMD_LOCAL_ONLY=1 \
KUJO_CMD_LIVE_MODEL=hermes/poolside/laguna-s-2.1:free \
COMMAND_CODE_EXPECTED_VERSION=1.85.1 npm run test:command-code
```

The opt-in test sets an ephemeral non-secret key placeholder and explicitly
enables local-only mode, whose transport refuses Command Code backend routes.
The default test does not inject a key or change provider settings. Do not use
the placeholder for Command Code gateway models or omit local-only mode.
To launch an interactive session with the same workaround:

```sh
CMD_LOCAL_ONLY=1 COMMAND_CODE_API_KEY=local-only-placeholder \
cmd --local-only --no-auto-update --model hermes/poolside/laguna-s-2.1:free
```

This workaround is tested against the unmodified 1.85.1 CLI, not documented
as an upstream-supported authentication method. The underlying provider-only
startup defect remains; account credentials are not overwritten. Hermes may
call a cloud provider, so this is local proxy routing, not offline inference.
