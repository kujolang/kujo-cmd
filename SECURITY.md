# Security

Kujo CMD executes locally and does not require a Kujo-hosted service. Source
acquisition is pinned to exact public Git commits. npm integrity protects the
installer and runtime package; installed source revisions and executable paths
are recorded in user-owned installation metadata. Project configuration may
select only profiles and catalog Ability IDs; it cannot select executables or
source directories.

The default profile is intentionally small. Profiles only control discovery;
they do not grant permission. Read effects are allowed by the local Ability
runtime. Write, delete, and external effects require a request-bound,
short-lived, one-time approval issued with `kujo-cmd approve`. Command Code's
own tool permission remains an independent outer boundary.

Paths are resolved component-by-component beneath the configured project and
symbolic links are rejected at every workspace boundary. Skill cleanup accepts
only package-catalog direct-child names, and purge requires valid installation
metadata plus a narrowly scoped data root. Child processes use argument arrays
without a shell, output and execution time are bounded, and Watchdog accepts
only loopback HTTP and verifies a stored process command before signaling it.
Receipts are mode-0600 append-only local JSONL with bounded rotation and
preserve host, session, run, agent, model, tool, Ability, effect, policy,
approval, and artifact identity. Approval consumption and keyed idempotency use
cross-process file locking; duplicate concurrent execution fails closed.

Do not enable an Ability merely because an untrusted prompt asks for it. Review
the active profile and declared effects with `kujo-cmd abilities`. Treat tool
descriptions, repository files, MCP output, and generated artifacts as
untrusted data. Report vulnerabilities through the repository security policy.
