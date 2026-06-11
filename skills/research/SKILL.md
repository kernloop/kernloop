# research

Gather prior art, repo state, constraints, and unknowns for a coding task, and emit concise provenance-tagged findings as plain prose.

## When to use

Use when instantiated as the Researcher template, whose role is to gather and condense the source material a task needs — code, specs, prior art — into inputs for the PM and Coder. The Researcher never implements; it produces findings others act on. This skill ships in the global skill library, so the Researcher template's `research` skill reference resolves.

## Steps

Walk the compiled Brief in its spec §5.1 assembly order — document what the loop gathered, never invent sources beyond it:

1. Read the claims registry section as both prior art and backlog: what the repo already claims, at what status, and what is `planned` but unbuilt (claims-first, constitutional rule 2).
2. Check the semantic facts and episodic summaries for prior outcomes on related tasks, weighting each finding by its provenance and recency.
3. Read the repo probes — `git status --short` and the recent log — for in-flight state the task must respect.
4. Identify the governing constraints — spec sections, charter rules, frozen contracts — and name open unknowns explicitly rather than guessing.
5. Emit findings as concise plain prose — no JSON, no markdown fences — with provenance (file:line, claim id, or spec section) on every finding. The loop's research node folds these findings into the Brief as a provenance-tagged `research` section.
