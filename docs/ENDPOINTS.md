# Using a custom OpenAI-compatible endpoint with kernloop

Kernloop can route governed work to a custom OpenAI-compatible HTTP endpoint —
an internal gateway, a self-hosted model server, or any provider that speaks the
`POST /chat/completions` wire format. There are **three verified paths**, in
decreasing order of how directly kernloop owns the call. This guide shows each
with a copy-paste `overlay.yaml` and its honest limitations.

> **"Models served via MCP" is not how this works.** An MCP server serves
> _tools_ to kernloop, not models. Routing to a custom endpoint is done through
> the `api` adapter (path 1) or an adapter's own provider config (path 2), never
> by exposing a model _through_ MCP. See issue #507 for the full analysis.

A note on secrets, common to every path: **kernloop never stores your API key.**
The overlay records only the _name_ of the environment variable the key is read
from at call time; a literal key in `overlay.yaml` is rejected at parse, and the
key appears in no log, error, output, or `raw` field [CLM-0083]. Set the key in
your shell (`export MY_PROVIDER_API_KEY=…`), never in the file.

---

## Path 1 — the `api` adapter (recommended)

Register the endpoint in the overlay's `endpoints` block and reference it by id
from `--adapter` or the per-tier `adapters` map. Kernloop makes the network call
itself — no model CLI is installed or spawned.

```yaml
# .kernloop/overlay.yaml
id: my-project
endpoints:
  my-provider: # any id; reference it as an adapter
    baseUrl: https://api.example.com/v1
    apiKeyEnv: MY_PROVIDER_API_KEY # the NAME of an env var — never the key
    models: # tier → concrete model id the endpoint serves
      frontier: some-frontier-model
      large: some-frontier-model
      medium: some-medium-model
      small: some-small-model
    metersUsd: true # endpoint reports usage.cost → meter it
    maxUsdPerCall: 0.50 # optional fail-closed per-call spend cap
    maxTokens: 8000 # optional completion ceiling (default 4096)
```

```bash
export MY_PROVIDER_API_KEY=…
kernloop run --adapter my-provider "…"     # the whole loop runs on the endpoint
```

**What kernloop guarantees here.** The adapter POSTs to the fixed
`/chat/completions` path and meters honestly from the response `usage` — tokens
plus a reported dollar cost when the endpoint returns one, never a fabricated
figure [CLM-0082]. It sends a system/user (or multi-turn) `messages` array when a
caller provides one, else a single user message, and always sends a bounded
`max_tokens` [CLM-0187]. The metered cost flows into the run budget, and the
optional per-endpoint cap fails closed [CLM-0085].

**The base-URL guard and its limits.** Before any egress the adapter validates
the operator-configured `baseUrl` — HTTPS required (HTTP only for an explicit
local host), no embedded credentials, cross-host redirects refused [CLM-0084].
On top of that lexical check, egress is guarded **at resolve time**: the DNS
lookup that validates the resolved address is the same lookup the socket connects
through, so a non-local host that resolves to a private, loopback, link-local, or
cloud-metadata address is blocked at connect — no DNS-rebinding window
[CLM-0186]. An operator-declared local host (the documented `http` escape hatch)
is still allowed to resolve to loopback.

**Discovery.** `kernloop models sync` enumerates what an endpoint serves via its
`/v1/models` contract, reusing the same guards and key hygiene [CLM-0086].

**When to use it.** This is the default: the whole loop, any tier, no CLI, full
metering and containment. **Limitation:** a vote panel served entirely by one
endpoint is a _single oracle_ — N models behind one gateway share failure modes,
so it does not provide the independent-family diversity a cross-provider panel
does (issue #509 tracks an endpoint-diverse panel that measures, and does not
oversell, this).

---

## Path 2 — opencode + `adapterModels`

If you already drive [opencode](https://github.com/sst/opencode) and it is
configured (via its own `provider` config) to reach your endpoint, kernloop can
pin the concrete model per tier and let opencode make the call.

```yaml
# .kernloop/overlay.yaml
id: my-project
adapters:
  large: opencode
adapterModels:
  opencode: # pin a model per tier; runs `opencode -m <model>`
    large: my-provider/big-model
adapterEnvAllow:
  - MY_PROVIDER_API_KEY # the key var opencode needs, explicitly allowed
```

Kernloop pins `-m <model>` per tier [CLM-0166]; unpinned tiers keep opencode's
own router. The spawned CLI receives only an explicit allowlist of env-var
names — `adapterEnvAllow` — so other providers' keys stay unexposed [CLM-0122].

**When to use it.** You already invest in opencode's provider setup and want its
routing. **Limitation:** kernloop does not see the endpoint's `usage`, so **USD
cost is unmetered** for this path — the token budget still bounds the run, but
per-call dollar metering is opencode's, not kernloop's.

---

## Path 3 — MCP sampling

Run `kernloop serve` under an MCP host that fronts the endpoint and declares the
`sampling` capability. The host, not kernloop, owns the model call; kernloop
requests a completion and routes the requested tier to the host [CLM-0108].

**When to use it.** You want the host (an IDE, an agent runtime) to own model
selection and billing. **Limitation:** the model call happens in the host, so
its **cost is unobservable** to kernloop — the run records what it can, but no
per-call token/USD metering is possible for a host-owned sample.

---

## Choosing a path

|                         | Path 1 · `api`               | Path 2 · opencode | Path 3 · sampling |
| ----------------------- | ---------------------------- | ----------------- | ----------------- |
| Kernloop makes the call | yes                          | no (CLI)          | no (host)         |
| USD metering            | yes (if endpoint reports it) | no                | no                |
| Token metering          | yes (if endpoint reports it) | yes               | no                |
| SSRF / base-URL guard   | yes [CLM-0084] [CLM-0186]    | opencode's        | host's            |
| Needs a CLI / host      | no                           | opencode          | an MCP host       |

Start with **path 1** unless you have a specific reason to delegate the call.
All three keep the key env-only; only path 1 gives you kernloop's own egress
guard and full metering.
