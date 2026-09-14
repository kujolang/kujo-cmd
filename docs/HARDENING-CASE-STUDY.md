# Hardening Kujo CMD

## Why we did it

Kujo CMD gives Command Code a local projection of portable Kujo Abilities. That boundary handles executable paths, repository files, approvals, receipts, subprocesses, and idempotent effects. Before publishing `0.1.0`, we hardened the boundary and then measured the result against the last pre-hardening commit.

This is not a claim that every operation became faster. It is a measured account of what improved, what became slower, and why.

## What changed

The hardened version separates trusted installation metadata from project-controlled configuration, rejects intermediate symlink escapes, reserves keyed work before executing effects, shards idempotency records, rotates receipt logs, bounds results and subprocess output, and returns compact receipt summaries by default.

Release automation was also pinned and made idempotent. The Ability contract and canonical Kujo tools remained authoritative; Command Code-specific code still handles only installation and projection.

The final repository-wide test gate passed, Kujo Eval passed 11/11 comparison checks, and ShipCheck passed 16/16 release-readiness checks with no warnings.

## How we measured it

We compared:

- baseline: `a15a28cc74dd9685389f65dbac3b9240eae4036f`
- current: `d627d4eaa23ade89784d14dfe069c9b098ab654b`

Both revisions ran from isolated Git archives on the same Intel Mac, using the same Node runtime, inputs, and benchmark worker. Primary local workloads used three warmups and 15 measured runs in alternating order. A scaling sweep covered 8, 32, 128, and 512 keyed calls. Kujo Eval validated 11 preserved comparison invariants.

## Before vs after

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Read 20 receipts from a 25.1 MiB log | 83.493 ms | 5.926 ms | -92.9% |
| Returned receipt JSON | 43,993 B | 3,098 B | -93.0% |
| Receipt workload peak RSS | 178.2 MiB | 161.5 MiB | -9.4% |
| 512 keyed calls | 8,722.8 ms | 2,843.7 ms | -67.4% |
| Same-key concurrent handler executions | 32 | 1 | -96.9% |
| 25 ordinary read calls | 35.904 ms | 83.253 ms | +131.9% |
| Packed package | 20,709 B | 26,583 B | +28.4% |

## Biggest improvements

The largest speed improvement came from bounded receipt-tail reads. The baseline loaded the full log, while current reads at most one MiB from the end and omits full results unless requested. That reduced both I/O and agent-facing output.

The largest engineering improvement was single-flight idempotency. Thirty-two independent callers using one key caused 32 baseline handler executions. Current ran the handler once and returned replay or explicit in-progress outcomes to the rest. The hardened version is slower in that synthetic concurrent batch because it coordinates correctly; duplicate effects are the more serious failure.

Sharded idempotency has a crossover. It is slower at 8 and 32 records, approximately even at 128, and 67.4% faster at 512. The hardened design pays fixed filesystem overhead to avoid repeatedly parsing and rewriting one expanding state file.

## What surprised us

The ordinary local read path became materially slower: about 1.89 ms of additional median overhead per call in the 25-call workload. The new receipt-state lock is the likely cause. This is the clearest optimization target that does not require weakening the safety model.

A three-run live test with Command Code 1.53.1 and Ollama GLM 5.3 succeeded at both revisions with exactly two Kujo tool calls. Current's median wall time was lower, but its input-token count varied widely and produced a 49.2% higher median. Three stochastic runs are not enough to attribute that change to Kujo CMD, so the result is recorded as inconclusive rather than promoted as either a win or regression.

## What did not improve

Build time was neutral. Dependency count was unchanged. Package size increased 28.4%, unpacked size increased 31.1%, and targeted source lines increased 42.5%. The added code implements previously missing invariants, but it still increases review and maintenance cost.

`npm ci` also failed at both revisions under npm 11.19.0 with a lockfile identity/synchronization error. Package tests and packaging pass, but clean-install developer experience needs correction and a CI gate.

## What remains

The next high-value work is to restore `npm ci`, reduce receipt-write lock overhead without reopening races, and repeat the live-agent comparison with at least 20 classified trials. Cross-platform filesystem measurements should follow on Linux and Windows.

## Reproducing the results

```bash
bash benchmarks/kujo-cmd-hardening/run.sh # from a kujolang/mcp checkout
cd benchmarks/kujo-cmd-hardening
kujo run ../../eval/main.kujo run eval.json --output-dir results/eval --artifact-checksums --json
kujo run ../../eval/main.kujo verify-manifest --output-dir results/eval --json
```

Raw samples, environment details, statistical summaries, and evidence hashes remain in the historical [`kujolang/mcp` benchmark archive](https://github.com/kujolang/mcp/tree/main/benchmarks/kujo-cmd-hardening). The full engineering analysis is in [`HARDENING-EVALUATION.md`](HARDENING-EVALUATION.md).
