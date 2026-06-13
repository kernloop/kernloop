/**
 * The commented `overlay.yaml` scaffold `kernloop init` writes — spec-true
 * defaults with discoverability comments for every optional knob. Extracted
 * from overlay.ts (which sits at its LOC ceiling) so the schema and the
 * human-facing template can each grow independently.
 */
import { TRACKER_TEMPLATE_LINES } from './tracker-config.js';
import type { Overlay } from './overlay.js';

/** Render the overlay.yaml template `kernloop init` writes (spec-true defaults, commented). */
export function overlayTemplate(defaults: Overlay): string {
  return [
    '# kernloop overlay (spec §7) — per-repo identity as data',
    `id: ${defaults.id}`,
    'budgets:',
    `  tokens: ${String(defaults.budgets.tokens)}`,
    `  usd: ${String(defaults.budgets.usd)}`,
    `  wallClockMin: ${String(defaults.budgets.wallClockMin)}`,
    `briefTokens: ${String(defaults.briefTokens)}`,
    '# per-call model-invoke timeout (ms) base for generative nodes; raise past the 15-min default (#127)',
    '# invokeTimeoutMs: 900000',
    '# vote-iterate bound: rejected plans loop at most K times, then escalate to the human (spec §6)',
    `K: ${String(defaults.K)}`,
    '# child-iterate bound: a child re-runs implement at most Kc times on a quality reject, then escalates (spec §6, §8)',
    `Kc: ${String(defaults.Kc)}`,
    '# budget mode: enforce halts a run that exceeds its budget; unlimited never halts but still tracks/reports cost (spec §8)',
    `budgetMode: ${defaults.budgetMode} # enforce | unlimited (Kc still bounds child iteration in unlimited)`,
    'gates:',
    '  vote:',
    `    strategy: ${defaults.gates.vote.strategy} # simple_majority | supermajority | unanimous`,
    `    panel: ${String(defaults.gates.vote.panel)} # 3 default; 7 at plan ratification (spec §8.6)`,
    '#  quality:',
    '#    timeoutMsPerCheck: 120000',
    '# adapters:  # per-tier model adapters (spec §8.4) — which adapter serves each model tier',
    '#   frontier: claude  # any of: claude codex gemini opencode ollama, OR a registered endpoint id below',
    '#   large: claude     # unset → falls back to --adapter (so no adapters block = single-adapter behavior)',
    '#   medium: codex',
    '#   small: ollama',
    '# endpoints:  # OpenAI-compatible HTTP endpoints (spec §8.4 api adapter) — referenced by id from adapters above',
    '#   my-provider:        # an internal OpenAI-compatible provider; reference it as adapters.<tier>: my-provider',
    '#     baseUrl: https://api.example.com/v1   # https required (http allowed ONLY for localhost/private, e.g. local vLLM)',
    '#                                            # this validates YOUR configured URL (scheme/creds); it is operator-trusted, not SSRF immunity',
    '#     apiKeyEnv: MY_PROVIDER_API_KEY        # the NAME of an env var — NEVER the key itself; set it in your shell',
    '#     models: { frontier: some-frontier-model, medium: some-medium-model }  # tier → concrete model id',
    '#     metersUsd: true       # the endpoint reports per-call USD cost (usage.cost) — meter it; a 2xx with no cost then fails closed',
    '#     maxUsdPerCall: 0.50   # optional fail-closed per-call spend cap (requires metersUsd: true)',
    ...TRACKER_TEMPLATE_LINES,
    "# nodeOverrides:  # swap a gate's gate / add fanout specialists / raise a node's model (spec §6, §8.4)",
    '#  canonical node names: frame research plan vote decompose fanout integrate retrospect (children: implement quality)',
    '#   quality: { gate: security-review }',
    '#   fanout: { specialists: [researcher] }',
    '#   research: { tier: medium, effort: low }  # tier: frontier|large|medium|small; effort: low|medium|high|xhigh',
    '',
  ].join('\n');
}
