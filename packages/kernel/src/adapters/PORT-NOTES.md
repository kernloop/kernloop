# Port notes — v1 cli-adapters → kernel Adapters

Port-by-evidence (spec §10 item 2, AGENTS.md "v1 as quarry") from
`nexus-substrate/nexus-agents` `packages/nexus-agents/src/cli-adapters/`
(`subprocess-adapter.ts`, `cli-detection-cache.ts`, `adapters/*`,
`parsers/*`). The v1 implementation and tests were read; nothing was copied
wholesale and no v1 package is imported. This file records the deltas.

## v1 `subprocess-adapter.ts` → `subprocess.ts`

**Kept (as evidence):**

- Spawn with `stdio: ['pipe','pipe','pipe']`, buffered stdout/stderr
  collection, resolve on `close` (streams flushed), `clearTimeout` on close.
- Prompt-via-stdin support with stdin always closed (`child.stdin.end()`).
- The 10 MiB per-stream capture cap (`MAX_BUFFER_BYTES`), here as a
  configurable `maxCaptureBytes` with per-stream `*Truncated` flags. Fixed a
  v1 latent bug: v1 only flagged truncation on the chunk _after_ the cap was
  crossed; kernloop slices the overflowing chunk at the cap.
- Wall-clock timeout enforced by a timer, with measured duration always
  reported.

**Changed:**

- v1 timed out with SIGTERM on the direct child plus a 5 s SIGKILL
  escalation (`SIGKILL_GRACE_MS`, #3026). Kernloop spawns the child
  `detached` (own POSIX process group) and SIGKILLs the **group** on
  timeout: the whole tree dies at once — v1's escalation existed precisely
  because single-pid SIGTERM left hung children and grandchildren behind.
  There is no graceful-shutdown window because a timed-out call's output is
  discarded anyway.
- v1 resolved timeouts immediately and let the child die in the background.
  Kernloop waits for `close` after the group kill, so the result carries
  everything the child produced before dying and no orphaned handles remain.
- v1 returned `Result<CliResponse, CliError>`; kernloop returns a plain
  `SubprocessResult` observation (stdout/stderr/exitCode/signal/durationMs/
  timedOut) and rejects only on spawn failure. Classification is the
  caller's job — the engine observes, it does not interpret.

**Dropped (and why):**

- Transient-error retry with backoff, timeout-extension multipliers,
  `MAX_PARSE_RETRIES`, exit-code/stderr classification tables, rate-limit
  detection, plaintext fallback, CLI error envelopes: all policy/heuristics.
  Retries-with-cleverness are explicitly NOT the adapter's job (spec §3.1
  Router row), and v1 itself documented nested-retry pathologies (#2824).
- `buildChildEnv` curated vendor-credential scoping: kernloop passes the
  caller-supplied env (default `process.env`) through. Credential scoping is
  a policy decision for the layer that owns configuration; revisit via a
  claim if needed.
- `sanitizeOutput` API-key redaction: kernel adapters do not log; raw output
  goes only to the caller, who owns redaction at its own boundary.
- AbortSignal plumbing, progress callbacks, first-byte timing breakdown,
  request-id log correlation: observability beyond the metered Cost is the
  Observer's job (spec §3.1 AuditChain row: "Analytics (Observer's job)").

## v1 `parsers/*` + `adapters/*` → `definitions.ts`

**Kept (as evidence):**

- The recorded output formats per CLI, including the exact field names v1
  verified against real CLIs: claude single-JSON (`result`, `is_error`,
  `usage.{input,output}_tokens`, `total_cost_usd`); codex NDJSON
  (`item.completed`/`agent_message`, `turn.completed.usage`); gemini
  single-JSON (`response`, `stats.models.*.tokens.{input,candidates}` with
  per-model aggregation); opencode NDJSON (`text` parts, `step_finish`
  `part.tokens.{input,output}` and `part.cost`).
- Defensive parsing: malformed JSON/NDJSON lines are skipped, missing usage
  is `null`, `is_error: true` and opencode `error` events void the response
  (v1 #2821: error events must not masquerade as content).
- argv shapes: claude `-p --output-format json` + stdin prompt; codex
  `exec --json -s read-only --skip-git-repo-check` + positional prompt;
  gemini positional prompt + `-o json -m`; opencode `run --format json` +
  stdin prompt.

**Changed:**

- v1 used parser classes + adapter subclasses behind a factory; kernloop
  declares the five adapters as plain data (`AdapterDefinition` records).
  The kernel routes and records — there is nothing to subclass.
- v1's ollama adapter spoke the HTTP SDK (`ollama` npm package). Kernloop
  has a no-new-runtime-deps rule and a CLI-subprocess layer, so ollama is
  defined over `ollama run <model>` with prompt via stdin, plain-text
  output, **no usage reported** (the CLI prints none non-interactively) and
  `experimental: true` per spec §5.8. It requires an explicit model — no
  default model ships, because choosing one would be a routing decision.
- opencode `part.cost` is read as reported usd; v1 parsed tokens but ignored
  the cost field.

**Dropped (and why):**

- v1's dynamic model discovery, `resolveOpenCodeModel`, and model-not-found
  fallback: those were _runtime routing decisions_ (probe the world, pick a
  model) — explicitly NOT the adapter's job (spec §3.1). They stay dropped.
  (Note: the `tierBinding` later added to `AdapterDefinition` — see §8.4 — is
  NOT that: it is a _declarative, static_ tier→stable-alias map the loop's pure
  translation seam reads as data; the adapter still makes no routing decision
  and still passes the resolved model string through verbatim. Static
  declaration ≠ runtime routing.)
- `systemPrompt` materialization (claude `--system-prompt`, codex/gemini
  tempfile workarounds, opencode prepend): prompt assembly, explicitly NOT
  the adapter's job (spec §3.1). Adapters take one fully assembled prompt.
- `workDir`/`mcpConfigPath`/`skipPermissions`/`variant`/`thinking` task
  options, session resumption (`--resume`, thread ids): v2 faculties own
  task shaping; none of these had a kernloop claim pulling them.
- Legacy opencode event formats (`session.complete`, `message.complete`),
  plaintext/NDJSON-heuristic fallbacks: kernloop parses the one recorded
  current format honestly; unparseable output is a typed
  `AdapterOutputError` carrying the raw text, not a guess.

## v1 `cli-detection-cache.ts` / `base-adapter.ts` health checks → `invoke.ts`

**Kept (as evidence):** availability is a real probe, and an unavailable CLI
is a first-class, typed outcome.

**Changed:** v1 detected CLIs by running `<cli> --version` subprocesses and
caching results with adaptive TTLs. Kernloop probes PATH directly
(`accessSync` X_OK per PATH entry), stateless, and reports **every probed
path** in `AdapterAvailability`/`AdapterUnavailableError` — no subprocess,
no cache to go stale, nothing to invalidate.

**Dropped:** circuit breakers, capacity trackers, latency trackers, routers
(budget/cascade/topsis/linucb/zero), response caches, fallback chains:
either Router-layer concerns (spec §3.1) or v1 features no claim has pulled.

## Metering (new surface, CLM-0020)

v1 returned optional `usage`/`costUsd` on `CliResponse` and let routers
aggregate. Kernloop makes metering a per-call guarantee: every
`invokeAdapter` call returns a zod-validated contracts `Cost`
(`tokens`/`usd`/`wallClockMs` + a `byAdapter` breakdown for the calling
adapter). `wallClockMs` is always measured; `tokens`/`usd` are exactly what
the CLI reported, and when a CLI reports nothing they are `0` with
`metered.tokens`/`metered.usd` set `false`. Numbers are never estimated or
fabricated — honesty over completeness.

## Test cases brought from v1

stdout/stderr/exit capture, multi-chunk stdout, stdin write + close, stdin
close without content, timeout kill, timeout-cleared-on-fast-exit, capture
truncation; claude parse (valid/is*error/missing-usage/invalid JSON), codex
NDJSON (multi-message join, usage from `turn.completed`, malformed-line
skip), gemini per-model aggregation and missing stats, opencode
text/step_finish stream with the real recorded `ses*…` fixture shape and
error-event voiding. New kernloop-only tests: process-**tree** kill via a
real grandchild, PATH probe reporting, uniform five-adapter invocation
against fake recorded-format CLIs, and metered-flag honesty.
