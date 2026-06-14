# MCP-sampling Phase 2 — live architecture validation (#135)

Recorded evidence from the FIRST live end-to-end run of kernloop's production
model-access architecture: **kernloop runs as an MCP server and the HOST provides
models via MCP `sampling/createMessage`** (kernloop holds no model key/CLI).

Produced by `scripts/sampling-host-harness.mjs` — an MCP host that spawns
`kernloop serve`, declares the `sampling` capability, fulfils each
`sampling/createMessage` by running `opencode run` (OpenRouter free tier,
`cost: 0`), and calls the `run` tool for `workflow.canonical` on a tiny task in a
throwaway workspace with a REAL `node --check` quality gate.

## What this run PROVES (architecture, validated)

- `kernloop serve` is driveable as an MCP server; the host called its `run` tool.
- **Sampling-during-the-tool-call works**: kernloop sent **17** `sampling/createMessage`
  requests UP to the host _while the `run` tool call was in flight_ — the full
  canonical loop (research → plan → 3-voter vote → decompose → implement → quality
  → review) ran on the host's model. See `sampling-calls.log`.
- **opencode was the sole model provider**; kernloop spawned no model CLI and held
  no key. Cost metered honest-zero (the host owns usage).
- The loop produced an **honest terminal Outcome** (`run-outcome.json`,
  `audit.jsonl`): `status: partial`, **escalated** after the vote gate rejected the
  plan K times — the reject → re-vote → escalate routing fired correctly (it never
  faked success; a persistently-rejected plan escalates to the human, per the
  no-auto-merge design). `audit.jsonl` ends `cli.run.outcome partial` →
  `cli.job.finished done`.

## What it does NOT prove (and the finding)

The run did not reach `success` — but **not** for an architecture reason. The small
free model (`north-mini-code-free`) HALLUCINATED that it was working on the kernloop
monorepo ("packages/cli/src/index.ts", "AGENTS.md", "protected paths") and the
voters rejected the trivial task as misaligned. That is a model-QUALITY finding (the
host's model choice matters; small models confabulate repo conventions) — tracked
separately — not a defect in the sampling architecture.

## Safety note (#138)

This run also revealed that the opencode sampling-fulfiller — an autonomous agent —
WROTE a file into the kernloop repo root, escaping its spawn `cwd`. Run the harness
only in a DISPOSABLE environment. This is a property of using an agentic CLI as a
stand-in; the production fulfiller (a pure completion endpoint) has no such side
effect. kernloop's own file-writing stayed correctly inside the temp workspace.

## Reproduce

```sh
pnpm build
node scripts/sampling-host-harness.mjs [opencode/<model>]   # default: opencode/north-mini-code-free
```

Not a CI test (it makes real model calls). The CI-safe proof of the same path is
the in-process mocked round-trip + sampling-during-tool-call tests in
`packages/cli/src/loop/mcp-sampling.test.ts` (CLM-0108).

> Note: the committed harness adds a `--` end-of-options separator on the opencode
> call (an argument-injection hardening from the security round) that post-dates
> this recorded run; it is behaviorally identical for normal prompts, so the
> recorded Outcome remains representative.
