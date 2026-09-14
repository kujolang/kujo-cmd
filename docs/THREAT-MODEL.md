# Kujo CMD threat model

## Scope and boundaries

```text
untrusted prompt/repository
  ↓
Command Code model + permission UI       host boundary
  ↓ local STDIO MCP
Kujo local Ability host                  policy boundary
  ↓ canonical argument-array process
Kujo product CLI                         effect boundary
  ↓
local artifacts + append-only receipts
```

The installer and updater cross npm/GitHub acquisition boundaries. Normal
execution is local. Watchdog, when enabled, is loopback-only. A compromised
local OS user is outside the isolation promise.

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Malicious tool descriptions/schema poisoning | Catalog is package-owned, bounded, validated, versioned, and digest-addressed | Treat descriptions and results as untrusted model input |
| Capability spoofing | Exact Ability ID/version/digest in discovery and receipt; source commits pinned and recorded | Git commit trust follows reviewed upstream refs |
| Prompt injection from repository | JSON schema, profile exposure, separate policy, no shell interpolation | Read tools can still return malicious text to the model |
| Approval bypass/confused deputy | Non-read effects fail closed; approval is human CLI-only and bound to principal/digest/input/invocation/expiry | Command Code permission is not itself Kujo approval |
| Approval replay | Cross-process locked state and one-time atomic consumption | Local state deletion invalidates history, not completed effects |
| Duplicate effects | Cross-process keyed reservation, bounded sharded replay records, and fail-closed in-progress state | Evicted old keys are no longer replayable; a process killed after an external effect may leave an in-doubt reservation that requires receipt/artifact inspection and a deliberate new key |
| Path traversal/symlink escape | Every existing path component is checked beneath the real project root; output parents cannot traverse symlinks | Product-specific internal path handling remains its owner's boundary |
| Shell execution/injection | Child processes receive argument arrays; no shell; output/time bounded | Eval intentionally runs configured commands and therefore requires approval |
| Network escalation | Default catalog is local; Watchdog accepts loopback HTTP only; RAG is local | Dispatch/RAG product configuration may itself name providers when expanded |
| Forged host/model identity | Metadata is labeled caller-asserted | A future host-attestation contract is needed for trusted identity |
| Receipt tampering/exhaustion | Mode-0600 files, definition digest, append-only JSONL, per-record bounds, 8 MiB rotation with three archives | Receipts are not signed against a malicious local user |
| Restart/races | State survives restart; approval, idempotency, and receipt mutations share an OS-visible lock | Network-filesystem locking semantics are not guaranteed; Kujo CMD is a local-host integration |
| Project configuration spoofing | Project config is declarative and allowlisted; executable/source paths come from validated user-owned installation metadata | A malicious process running as the same OS user remains outside the isolation promise |
| Destructive cleanup | Skill names are catalog allowlisted/direct children; purge verifies installation ownership and rejects broad roots | A malicious same-user process can still alter local files |
| Watchdog PID reuse | Stored script identity is matched against the live command before stop signals | Process inspection depends on platform command-line reporting |
| Cancellation ambiguity | Abort terminates child and emits cancelled receipt | External effects may race termination; inspect before retry |
| Source/update compromise | Exact public commits, detached checkout, no lifecycle scripts from source repos | Commit allowlist updates require maintainer review |
| Host/mod impersonation | No mod is installed; exact local MCP command path is generated | Untrusted projects can contain competing MCP configuration |

Security rules are enforced by the local Ability host, not inferred from MCP
annotations. Profiles reduce discovery but never grant authority. New
write/delete/external catalog entries must remain approval-gated and receive
idempotency, path, concurrency, restart, and failure tests.
