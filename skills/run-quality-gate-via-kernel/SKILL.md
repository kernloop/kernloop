# run-quality-gate-via-kernel

Run kernloop's gate.quality end-to-end through the kernel bus and router, executed by @kernloop/faculty-gates, yielding a Verdict and Outcome in the audit log.

## When to use

Use when a task needs the repository checked against the quality gate through the canonical kernel path — a TaskContract routed to the `gate.quality` capability — rather than by invoking gate logic directly. Appropriate when exactly one gate provider (`@kernloop/faculty-gates`) is registered and the gate should run at the `advisory` tier with full audit coverage.

## Steps

1. Publish a `TaskContract` on the kernel bus with the task's id (audit event `kernel.bus.publish`, contract `TaskContract`).
2. Let the kernel router route the task to capability `gate.quality` at required tier `advisory` with `execute: true`; with 1 candidate and 1 eligible, it selects `@kernloop/faculty-gates@0.1.0` without exploration and records outcome `routed` (audit event `kernel.router.route`).
3. The selected faculty executes the quality gate and publishes a `Verdict` on the bus for the same task id (audit event `kernel.bus.publish`, contract `Verdict`).
4. The CLI records the gate verdict: gate `quality`, result `pass`, 0 findings, ~7.4s wall clock (audit event `cli.gate.verdict`).
5. An `Outcome` is published on the bus and the CLI records the run outcome: capability `gate.quality`, selected `@kernloop/faculty-gates@0.1.0`, status `success` (audit events `kernel.bus.publish` contract `Outcome`, then `cli.run.outcome`).
6. Every step appends a hash-chained event to `.kernloop/audit.jsonl` (each event's `prevHash` links to the prior event's `hash`), so the run is fully reconstructable from the audit log.
