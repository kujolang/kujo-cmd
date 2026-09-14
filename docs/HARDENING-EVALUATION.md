# Kujo CMD Before/After Hardening Evaluation

## Executive summary

This evaluation compares `a15a28cc74dd9685389f65dbac3b9240eae4036f`, the merge immediately before the dedicated Kujo CMD prepublication hardening sequence, with `d627d4eaa23ade89784d14dfe069c9b098ab654b`, the tracked `main` revision at evaluation start. The functional hardening shipped in `v0.1.0` at `2291683`; later commits through `CURRENT` change only the Command Code demonstration and documentation. Both revisions were exported into isolated trees, so unrelated untracked video work in the source checkout did not enter either measurement.

The hardening did not primarily optimize the ordinary read-call hot path. It changed the failure, trust, concurrency, and large-state behavior of the local Ability host:

- project files can no longer select executable or source paths;
- nested symbolic-link escapes are rejected;
- keyed execution is reserved under a filesystem lock before effects run;
- approvals, receipts, results, diagnostics, command output, and MCP requests are bounded;
- idempotency records are sharded and pruned instead of accumulating in one hot JSON object;
- receipt listing reads only a bounded tail and omits full results unless requested;
- destructive cleanup and Watchdog process signaling receive stronger identity/path checks;
- the publication workflow is pinned and idempotent.

The strongest measured improvement is receipt retrieval on a 25.1 MiB receipt log: median operation latency fell from **83.493 ms to 5.926 ms** (**92.9% lower**), median process peak RSS fell from **178.2 MiB to 161.5 MiB** (**9.4% lower**), and the returned JSON fell from **43,993 bytes to 3,098 bytes** (**93.0% lower**) while preserving the requested 20 receipt summaries. At 512 unique keyed calls, median time fell from **8,722.8 ms to 2,843.7 ms** (**67.4% lower**), and the monolithic hot state file fell from **1,070,968 bytes to zero** because keyed records moved to bounded shards.

The most important reliability result is not a speed number. With 32 concurrent runtime instances and one idempotency key, the baseline executed the handler **32 times**. Current executed it **once**, with the other calls receiving a replay or explicit in-progress outcome. This eliminates 31 duplicate effect executions in the test, at the cost of serialized coordination: median workload latency rose from **91.083 ms to 264.476 ms**. That trade is operationally favorable for effectful work, but it is a real latency regression.

Ordinary sequential read calls also became slower. Twenty-five local calls rose from a median **35.904 ms to 83.253 ms**, an absolute increase of **47.349 ms**, or about **1.89 ms per call**. The likely cause is the new filesystem lock around receipt persistence. Minimal catalog loading was neutral (89.992 ms to 88.417 ms), and the release build was also neutral (115.311 ms to 114.347 ms). The package became larger: packed size rose **20,709 to 26,583 bytes** (+28.4%), unpacked size **77,294 to 101,307 bytes** (+31.1%), and the targeted lexical source count rose from 1,053 to 1,500 nonblank, non-comment lines (+42.5%). Direct and lockfile dependency counts did not change.

The live agent workload used Command Code 1.53.1 and `ollama/glm-5.3:cloud`. Both revisions completed all three runs, called exactly the two requested Kujo tools, and returned the required proof. The current median was faster (22.73 s to 19.59 s), but current input tokens varied from 41,374 to 62,305 while baseline remained near 41,755. With only three stochastic provider runs, neither the latency reduction nor the 49.2% higher median input-token count is a defensible performance claim. This is an **inconclusive regression signal**, not a demonstrated token improvement.

The Kujo Eval suite passed **11/11 deterministic checks**, and each repository-defined package suite passed **10/10 repeated runs** at both revisions. Current's suite is broader (10 tests versus 4), so suite timing is not compared. No correctness regressions were found within the deterministic workloads. Two production-readiness issues remain: the read-only hot path pays measurable lock overhead, and `npm ci` fails at both revisions under npm 11.19.0 with a lockfile synchronization error even though `npm test` and package creation pass.

**Conclusion:** the hardening is empirically successful as a security, boundedness, concurrency, and large-state pass. It is not a universal speed, size, complexity, or token-efficiency win.

## Before/after scorecard

| Metric | Baseline | Current | Change | Classification |
| --- | ---: | ---: | ---: | --- |
| Receipt-tail median latency, 25.1 MiB log | 83.493 ms | 5.926 ms | -77.566 ms / -92.9% | **CLEAR IMPROVEMENT** |
| Receipt response size, 20 items | 43,993 B | 3,098 B | -40,895 B / -93.0% | **CLEAR IMPROVEMENT** |
| Receipt workload median peak RSS | 186,826,752 B | 169,304,064 B | -17,522,688 B / -9.4% | **CLEAR IMPROVEMENT** |
| 512 keyed calls, median | 8,722.8 ms | 2,843.7 ms | -5,879.1 ms / -67.4% | **CLEAR IMPROVEMENT** |
| Root idempotency hot file after 512 calls | 1,070,968 B | 0 B | moved to shards | **CLEAR IMPROVEMENT** |
| Duplicate handler executions, 32 concurrent callers | 32 | 1 | -31 / -96.9% | **CLEAR IMPROVEMENT** |
| Concurrent workload median latency | 91.083 ms | 264.476 ms | +173.393 ms / +190.4% | **REGRESSION / correctness tradeoff** |
| 25 sequential read calls, median | 35.904 ms | 83.253 ms | +47.349 ms / +131.9% | **REGRESSION** |
| Minimal catalog workload, median | 89.992 ms | 88.417 ms | -1.576 ms / -1.8% | **NEUTRAL** |
| Release-build median | 115.311 ms | 114.347 ms | -0.963 ms / -0.8% | **NEUTRAL** |
| Oversized Ability result | 308,487 B success | 1,412 B structured failure | bounded at 256 KiB | **CLEAR IMPROVEMENT** |
| Oversized command output | 1,048,868 B accepted | `ability_output_limit` | bounded at 512 KiB | **CLEAR IMPROVEMENT** |
| Nested symlink escape | allowed | rejected | fail-closed | **CLEAR IMPROVEMENT** |
| Package size | 20,709 B | 26,583 B | +5,874 B / +28.4% | **REGRESSION** |
| Unpacked package size | 77,294 B | 101,307 B | +24,013 B / +31.1% | **REGRESSION** |
| Direct dependencies | 1 | 1 | none | **NEUTRAL** |
| Lockfile packages | 6 | 6 | none | **NEUTRAL** |
| Repeated package-suite runs | 10/10 pass | 10/10 pass | current suite 4 → 10 tests | **IMPROVED COVERAGE** |
| Live Command Code task success | 3/3 | 3/3 | none | **NEUTRAL** |
| Live Command Code Kujo tool calls | 2/run | 2/run | none | **NEUTRAL** |
| Live median input tokens (`n=3`) | 41,755 | 62,300 | +49.2% observed | **INCONCLUSIVE REGRESSION SIGNAL** |

All byte and latency claims above are measured. The hot-file statement is observed from the resulting on-disk layout. No dollar-cost claim is made.

## Evaluation boundary

### Baseline

- SHA: `a15a28cc74dd9685389f65dbac3b9240eae4036f`
- Timestamp: 2026-09-13 16:04:51 -04:00
- Subject: `Merge pull request #2 from kujolang/codex/kujo-cmd-release-proof`
- Reason: this is the merge immediately preceding the contiguous hardening sequence beginning with `182f601`.

### Current

- SHA: `d627d4eaa23ade89784d14dfe069c9b098ab654b`
- Timestamp: 2026-09-13 18:49:44 -04:00
- Branch at start: `main`
- Tag context: functional hardening is included in `v0.1.0` (`2291683`); four subsequent commits are demo/documentation changes.
- Worktree at start: tracked files matched `HEAD`; two unrelated untracked demo paths were present and excluded by archive isolation.

Alternative boundaries considered were `544efa6` (the last prepublication hardening branch commit) and `2291683` (the release tag). They contain the same functional Kujo CMD hardening as current. `CURRENT` was selected because the requested comparison explicitly asks for repository current state; `a15a28c` remains the least arbitrary pre-hardening boundary.

## What changed and why

### Trusted installation state

Before hardening, project-controlled `.kujo/cmd.json` carried source paths, the Kujo executable, and the projection root. Current stores those executable locations in user-owned installation metadata and accepts only a narrow project configuration allowlist. `loadInstallation` verifies expected locations, source revisions, and file types. This removes a confused-deputy path in which a repository could redirect a nominal Kujo Ability to an arbitrary executable.

Expected metric: primarily security and failure correctness, not speed. Measured result: the nested-symlink fixture was accepted by baseline and rejected by current. Repository security tests additionally cover forged projection manifests, executable/source override attempts, and unsafe purge roots.

### Filesystem boundaries and destructive operations

Current walks every path component with `lstat`, rejects symbolic links, compares real paths against the real project root, constrains skill names to direct children, and refuses purge roots that are `/`, contain the user home, or contain the working directory. Baseline checked only lexical containment and the final directory node, allowing an intermediate symlink to escape.

Measured result: baseline ran the controlled command from `nested/link/subdir` outside the fixture root; current returned `ability_path_invalid` before execution.

### Single-flight idempotency and bounded state

Baseline performed a read transaction to check idempotency, executed the handler, then wrote the completion record. Independent runtime instances could all observe an empty record and execute the same effect. It also placed every completed receipt in one JSON state file.

Current uses an owner-tagged filesystem lock, writes an `in_progress` reservation before execution, returns explicit in-progress/replay/conflict states, stores one record per digest, and prunes completed records to 32 per two-hex-character shard. Expired and consumed approvals are also pruned and pending approvals are capped at 1,024.

Measured result: handler executions fell from 32 to 1 under the concurrent same-key workload. At small state sizes, filesystem coordination is slower; at 512 calls, avoiding repeated parse/rewrite of the monolith produces the 67.4% median reduction.

### Bounded output and receipts

Current caps results at 256 KiB, receipts at 384 KiB, receipt logs at 8 MiB with three archives, error details at 64 KiB, canonical command output at 512 KiB, MCP request lines at 1 MiB, and MCP text projections at 32 KiB. Receipt listing scans at most 1 MiB from the tail and returns result summaries by default.

Measured result: the 300 KiB result changed from a 308,487-byte success to a 1,412-byte `ability_output_limit` receipt. A 1 MiB command result changed from accepted output to `ability_output_limit`. The large receipt workload improved latency, RSS, and response bytes as shown in the scorecard.

### Release automation

The release workflow pins action revisions, checks whether `0.1.0` already exists, and compares published package contents instead of failing or overwriting blindly. These changes improve supply-chain determinism and publication idempotency. They were inspected and covered by repository tests; no meaningful local runtime metric applies.

## Runtime and scaling analysis

Each primary local workload used three warmups and 15 measured process-isolated samples in alternating baseline/current order.

| Workload | Baseline median | Current median | Baseline p95 | Current p95 | Baseline SD | Current SD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Minimal catalog | 89.992 ms | 88.417 ms | 122.384 ms | 155.054 ms | 11.501 ms | 19.329 ms |
| Typical: 25 read calls | 35.904 ms | 83.253 ms | 52.109 ms | 158.551 ms | 5.633 ms | 23.718 ms |
| Large receipt tail | 83.493 ms | 5.926 ms | 112.364 ms | 8.432 ms | 10.958 ms | 0.784 ms |
| Stress: 32 same-key calls | 91.083 ms | 264.476 ms | 135.320 ms | 354.029 ms | 13.329 ms | 38.850 ms |
| Oversized result | 30.977 ms | 35.360 ms | 46.802 ms | 41.697 ms | 4.864 ms | 3.988 ms |
| Oversized command | 146.941 ms | 138.322 ms | 240.218 ms | 216.083 ms | 28.725 ms | 23.160 ms |

Observed maxima are preserved in the JSON, but `p99_observed` for 15 samples is not treated as a population p99 claim.

The idempotency sweep used five samples per point:

| Unique keyed calls | Baseline median | Current median | Change |
| ---: | ---: | ---: | ---: |
| 8 | 58.3 ms | 74.0 ms | +26.9% |
| 32 | 179.5 ms | 296.4 ms | +65.1% |
| 128 | 1,096.0 ms | 1,044.4 ms | -4.7% |
| 512 | 8,722.8 ms | 2,843.7 ms | -67.4% |

Baseline growth is consistent with repeated parse/serialization of an expanding monolithic state object. Current has higher fixed filesystem overhead but a materially better large-state curve. Four points and five samples per point are insufficient to assign a formal complexity class; the evidence supports a crossover and improved scaling, not a theorem about asymptotic order.

## Token, context, and agent efficiency

The deterministic receipt projection reduced tool-result bytes by 40,895 per 20-item call without removing identity, status, or error summaries. At 1,000 equivalent calls, that is **40,895,000 fewer returned bytes**. This is a byte-volume model, not a measured token or dollar estimate.

The live Command Code workload used the same fixture, prompt, model, local source tree, and two-tool constraint at both revisions:

| Metric (`n=3`) | Baseline median | Current median | Observation |
| --- | ---: | ---: | --- |
| Completion | 3/3 | 3/3 | equal |
| Kujo tools | 2/run | 2/run | equal; no redundant tool calls |
| Wall time | 22.73 s | 19.59 s | -13.8%, too noisy to claim |
| Input tokens | 41,755 | 62,300 | +49.2%, current range 41,374–62,305 |
| Output tokens | 1,546 | 1,800 | +16.4%, too noisy to claim |

Two current runs accumulated an extra context step, while one matched the baseline token range. The implementation does not itself invoke a model, and the deterministic two-tool count did not change. The evidence therefore does not establish that hardening caused the token variance. The correct classification is **inconclusive**. More provider runs with captured turn classification would be required before changing prompts or descriptors.

## Build, dependencies, and code complexity

The identical release-build script passed 15/15 times at each revision. Median build time changed by less than 1 ms and is neutral. Direct dependencies remained one and lockfile package entries remained six.

The security work increased code and package size. Across the Kujo CMD package plus the portable local runtime, targeted lexical metrics changed as follows:

| Proxy | Baseline | Current | Change |
| --- | ---: | ---: | ---: |
| Files | 19 | 21 | +2 |
| Nonblank/non-comment lines | 1,053 | 1,500 | +42.5% |
| Function syntax count | 131 | 184 | +40.5% |
| Branch syntax count | 376 | 535 | +42.3% |
| Largest file | 262 lines | 394 lines | +132 lines |
| TODO/FIXME | 0 | 0 | none |

These are lexical proxies, not formal cyclomatic-complexity or duplication scores. Complexity was added rather than removed, but it implements explicit invariants that were previously absent. Maintainability improved through centralized path/install/state contracts and six additional tests; review burden and package footprint increased. The net maintainability result is mixed, not an automatic win from either line count or test count.

## Reliability and Kujo Eval report

The baseline package suite passed all 10 repeated invocations of its four tests. Current passed all 10 repeated invocations of its ten tests. No flaky failure was observed. The current suite adds direct coverage for cross-runtime single-flight execution, bounded output, sharded state, symlink traversal, forged skill manifests, untrusted executable/source paths, and purge safety.

After adding the reproducibility package, the repository-wide `bash tests/run_all_tests.sh` gate passed, including security, endpoint, Ability projection/gateway, clean-profile Command Code 1.53.1, live Ollama evidence, package reproducibility, and host-compatibility checks. ShipCheck `scan` and `gate` both exited 0 with 16/16 checks passing, no warnings, and `gate_passed: 1`.

Kujo Eval ran the preserved comparison as 11 deterministic checks and passed 11/11:

| Eval category | Evidence | Result |
| --- | --- | --- |
| Provenance | pinned SHAs and raw-evidence digests | PASS |
| Correctness | 25/25 typical calls at both revisions | PASS |
| Runtime evidence | 15 samples per primary workload | PASS |
| Context efficiency | bounded 20-receipt summaries | PASS |
| Tool efficiency | single handler execution for one key | PASS |
| Failure behavior | result and command limits | PASS |
| Security | nested symlink rejected | PASS |
| Scaling | four keyed-state sizes preserved | PASS |
| Agent usability | 3/3 live tasks, exactly two tools | PASS |

This is an outcome scorecard. It is not a fabricated 0–10 quality rating and does not imply every performance direction improved.

## Change-to-result and commit attribution

| Commit | Change | Intended effect | Observed/measured effect |
| --- | --- | --- | --- |
| `182f601` | trusted installation metadata; path-component checks; purge and Watchdog identity guards | close local trust-boundary attacks | symlink escape changed allowed → rejected; six new security/runtime cases in current suite |
| `41e3ce0` | filesystem locking, pre-effect reservations, sharded idempotency, bounded receipts/results/requests | prevent duplicate effects and unbounded state/context | handler calls 32 → 1; 512-key median -67.4%; receipt output -93.0%; ordinary call latency regressed |
| `7576bb9` | pinned CI publication dependencies | deterministic supply chain | observed in workflow diff; no local runtime metric |
| `1c553c2` | hardening guarantees and limitations documented | operational clarity | observed documentation improvement; no runtime metric |
| `544efa6` | refreshed host certification evidence | align evidence with hardened code | repository evidence updated; current full verification remains green |
| `408fcd0` | publication checks existing version before publish | idempotent release | source/test observed; no registry mutation benchmark |
| `fa579d9` | compares published package contents | detect version/content conflict | source/test observed; no registry mutation benchmark |

The principal causal chain is:

`readLastLines` + default receipt redaction → bounded tail I/O and smaller return object → 92.9% lower median read latency and 93.0% fewer output bytes.

`executionGate` + filesystem lock + pre-effect `in_progress` record → one owner for a keyed invocation → 31 duplicate handler executions eliminated, with serialized-lock latency.

sharded idempotency records → no repeatedly rewritten monolithic hot file → slower small workloads but 67.4% lower median at 512 calls.

## Regressions and tradeoffs

| Metric | Baseline | Current | Severity | Likely cause | Recommended action |
| --- | ---: | ---: | --- | --- | --- |
| 25-call median | 35.904 ms | 83.253 ms | Medium | lock acquisition and filesystem metadata for each receipt | benchmark a safe in-process fast path or batched receipt sink without weakening cross-process guarantees |
| Concurrent median | 91.083 ms | 264.476 ms | Low operational / high benchmark | correct serialization and randomized lock backoff | retain correctness; consider event-driven or narrower locking |
| Packed package | 20,709 B | 26,583 B | Low | added trust/state guard code | accept unless future bundling materially grows |
| Targeted source lines | 1,053 | 1,500 | Medium maintenance | explicit validation and bounded-state machinery | split the 394-line runtime by responsibility while preserving the contract |
| Live input tokens (`n=3`) | 41,755 median | 62,300 median | Unknown | stochastic extra model/context step | rerun at `n>=20` with turn/tool-schema event classification before acting |
| `npm ci` on npm 11.19.0 | fails | fails | Medium DX | lockfile/package identity incompatibility | regenerate and verify lockfile with current npm; add `npm ci` to CI |

No statistically or operationally meaningful correctness regression was identified within the tested workloads. Performance, size, and complexity regressions were identified and are listed above.

## Remaining opportunities

- **P1:** restore `npm ci` under npm 11.x and enforce it in CI.
- **P1:** reduce ordinary receipt-write lock overhead without reintroducing cross-process races.
- **P2:** run at least 20 paired live-agent trials and classify extra context turns before making token-efficiency claims.
- **P2:** add Windows and Linux performance runs, especially filesystem locking and rename behavior.
- **P2:** split local-runtime persistence, approvals, and receipt rotation into reviewed modules.
- **P3:** add allocation profiling if the receipt path becomes a dominant production cost.

## Methodology and reproduction

Environment: macOS 26.6.2, Darwin 25.6.0, Intel Core i7-9750H, 12 logical cores, 16 GiB RAM, Node 26.7.0, npm 11.19.0, Rust/Cargo 1.96.0, Kujo 1.3.1. Tests used local files and subprocesses; network conditions do not affect the deterministic suite. The live model workload used local-only Command Code routing to Ollama cloud GLM 5.3 and is reported separately.

Reproduce deterministic measurements:

```bash
bash benchmarks/kujo-cmd-hardening/run.sh # from a kujolang/mcp checkout
cd benchmarks/kujo-cmd-hardening
kujo run ../../eval/main.kujo lint eval.json
kujo run ../../eval/main.kujo run eval.json --output-dir results/eval --artifact-checksums --json
kujo run ../../eval/main.kujo verify-manifest --output-dir results/eval --json
```

The runner archives both pinned SHAs, alternates execution order, uses identical workers and inputs, records raw JSONL samples, calculates min/max/mean/median/standard deviation, and stores SHA-256 evidence digests. The preserved results, Eval report, and runner remain in the historical [`kujolang/mcp` benchmark archive](https://github.com/kujolang/mcp/tree/main/benchmarks/kujo-cmd-hardening).

Known limitations are preserved in the machine-readable result. No allocation profiler, network benchmark, multi-platform runner, or provider pricing model was used. The idempotency sweep uses five samples per size, and the live-agent comparison uses three runs per revision.

## Final assessment

> If we erase the commit messages and ignore what the hardening work intended to accomplish, does the empirical evidence independently demonstrate that CURRENT is a better engineered version than BASELINE?

**YES.** Current independently demonstrates fail-closed path and output boundaries, one execution for a concurrent idempotency key instead of 32, substantially better large-state scaling, bounded receipt context, and broader deterministic coverage while preserving task success. It is not universally faster or leaner: the ordinary read path is slower, the package and code are larger, and live token efficiency is inconclusive. Those tradeoffs prevent a blanket “faster everywhere” claim, but they do not outweigh the demonstrated correctness and boundedness improvements for an integration that can execute Kujo effects.
