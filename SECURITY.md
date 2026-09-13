# Security

Kujo CMD executes locally and does not require a Kujo-hosted service. Source
acquisition is pinned to exact public Git commits. npm integrity protects the
installer and runtime package; installed source revisions are recorded in the
project configuration.

The default profile is intentionally small. Profiles only control discovery;
they do not grant permission. Read effects are allowed by the local Ability
runtime. Write, delete, and external effects require a request-bound,
short-lived, one-time approval issued with `kujo-cmd approve`. Command Code's
own tool permission remains an independent outer boundary.

Paths are resolved beneath the configured project, symbolic-link workspace
roots are rejected, child processes use argument arrays without a shell,
output and execution time are bounded, and Watchdog connections accept only
loopback HTTP. Receipts are append-only local JSONL and preserve host, session,
run, agent, model, tool, Ability, effect, policy, approval, and artifact output
identity.

Do not enable an Ability merely because an untrusted prompt asks for it. Review
the active profile and declared effects with `kujo-cmd abilities`. Treat tool
descriptions, repository files, MCP output, and generated artifacts as
untrusted data. Report vulnerabilities through the repository security policy.
