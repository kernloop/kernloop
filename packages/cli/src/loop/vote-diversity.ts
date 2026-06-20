/**
 * Provider-DIVERSE ratification voting (#369) — the composition-root plumbing that
 * makes a panel-7 vote convene voters across DISTINCT model adapters instead of one
 * model role-playing N personas (the correlated-oracle weakness). The faculty vote
 * gate stays model-free; this module owns the per-voter adapter routing: it picks
 * the available adapters, builds a vote seam per adapter, round-robins the voters
 * across them, and degrades honestly (a visible audit) to a single oracle when
 * fewer than two adapters are available. Kept out of executors.ts for line budget.
 */
import { ADAPTER_NAMES, appendEvent, type AdapterName, type AuditStore } from '@kernloop/kernel';
import type { DiscoveredCache } from '@kernloop/faculty-models';
import { PANEL_RATIFICATION, type InvokeVoter } from '@kernloop/faculty-gates';
import { requirementForNode, type Overlay } from '../overlay.js';
import { tierCandidates } from '../overlay-schemas.js';
import { adapterInvoke, type RunTotals } from './invoke.js';
import { buildNodeSeam, resolveServed, type NodeSeam } from './node-seam.js';
import {
  DEFAULT_INVOKE_TIMEOUT_MS,
  invokeTimeoutForNode,
  isReasoningNode,
  nodeRequirement,
} from './node-model.js';
import { ballotInvoker, diverseBallotInvoker } from './seams.js';
import type { ModelFitnessWiring } from './node-bind.js';

/** The available adapters + per-adapter vote-seam builder for a diverse panel. */
export interface VoteDiversity {
  readonly adapters: readonly AdapterName[];
  readonly seamForAdapter: (name: AdapterName) => NodeSeam;
}

/**
 * The distinct CLI adapters the overlay can serve a provider-diverse vote panel
 * with (#369), STABLE-SORTED for a deterministic round-robin: the run adapter ∪
 * every CLI tier candidate the overlay declares, deduped, registered endpoints
 * excluded (a diverse panel binds CLI subprocess adapters, not the one api seam).
 * A default overlay (no `adapters` block) yields just `[runAdapter]` → the panel
 * runs single-oracle (honestly degraded + audited); real diversity only when the
 * operator configures ≥2 distinct adapters.
 */
export function diverseVoteAdapters(overlay: Overlay, runAdapter: string): AdapterName[] {
  // Seed with the run adapter ONLY when it is a CLI adapter — a registered ENDPOINT
  // run adapter (#392) cannot be a diverse-vote voter (the panel builds per-adapter
  // CLI seams); an endpoint-only run therefore yields [] → the vote runs single-
  // oracle on the node's own (api) seam, honestly degraded + audited.
  const set = new Set<string>();
  if (ADAPTER_NAMES.includes(runAdapter as AdapterName)) set.add(runAdapter);
  for (const tier of ['frontier', 'large', 'medium', 'small'] as const) {
    for (const candidate of tierCandidates(overlay.adapters, tier)) {
      if (
        overlay.endpoints[candidate] === undefined &&
        ADAPTER_NAMES.includes(candidate as AdapterName)
      ) {
        set.add(candidate);
      }
    }
  }
  return [...set].sort() as AdapterName[];
}

/**
 * Build a NodeSeam for a SPECIFIC CLI adapter serving the vote node (#369) — each
 * diverse voter is bound to a distinct adapter, so the seam's adapter is FIXED (no
 * tier resolution). Mirrors the CLI branch of the default per-node seam build; the
 * vote node is a reasoning node, so the bound invoke is tool-free (#148).
 */
export function buildVoteSeamForAdapter(
  name: AdapterName,
  overlay: Overlay,
  totals: RunTotals,
  fitness: ModelFitnessWiring = {},
): NodeSeam {
  const req = requirementForNode(overlay, 'vote', nodeRequirement('vote'));
  const timeoutMs = invokeTimeoutForNode(
    'vote',
    overlay.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS,
  );
  const hooks = {
    ...(fitness.discovered === undefined ? {} : { discovered: fitness.discovered }),
    ...(fitness.onModelCall === undefined ? {} : { onModelCall: fitness.onModelCall }),
  };
  return buildNodeSeam(
    resolveServed(req, name),
    adapterInvoke(name, undefined, undefined, overlay.adapterEnvAllow),
    totals,
    timeoutMs,
    hooks,
    isReasoningNode('vote'),
  );
}

/** Assemble the {@link VoteDiversity} for the default (non-injected) loop path. */
export function buildVoteDiversity(
  overlay: Overlay,
  runAdapter: string,
  totals: RunTotals,
  fitness: ModelFitnessWiring = {},
): VoteDiversity {
  return {
    adapters: diverseVoteAdapters(overlay, runAdapter),
    seamForAdapter: (name) => buildVoteSeamForAdapter(name, overlay, totals, fitness),
  };
}

/** What {@link voteInvokerFor} binds — the vote seam, audit store, and provenance. */
export interface VoteInvokerDeps {
  readonly invoke: NodeSeam['invoke'];
  readonly store: AuditStore;
  readonly overlayDir: string;
  readonly discovered: DiscoveredCache;
  readonly runId: string;
  readonly isRatification: boolean;
  readonly voteDiversity?: VoteDiversity;
}

/**
 * The voter seam for one vote (#369). A panel-7 RATIFICATION vote with diversity
 * available round-robins the voters across the stable-sorted adapters (voter
 * i → adapters[i % n]), binding each to its OWN adapter's seam so the panel is
 * genuinely independent. A SINGLE available adapter degrades to one oracle — run it
 * (the human merge stays the ratifier) but append a `cli.vote.single-oracle-
 * degraded` audit (rule 7) so the non-independence is recorded, never silent. A
 * panel-3 loop vote, or the injected-invoke path, uses the single-seam invoker.
 */
export function voteInvokerFor(deps: VoteInvokerDeps): InvokeVoter {
  const single = ballotInvoker({
    overlayDir: deps.overlayDir,
    runId: deps.runId,
    invoke: deps.invoke,
  });
  const div = deps.voteDiversity;
  if (!deps.isRatification || div === undefined || div.adapters.length === 0) return single;
  const seamCache = new Map<AdapterName, NodeSeam>();
  const seamFor = (name: AdapterName): NodeSeam => {
    let seam = seamCache.get(name);
    if (seam === undefined) {
      seam = div.seamForAdapter(name);
      seamCache.set(name, seam);
    }
    return seam;
  };
  const byVoter = new Map<string, NodeSeam>(
    PANEL_RATIFICATION.map((voter, i) => [
      voter.name,
      seamFor(div.adapters[i % div.adapters.length] as AdapterName),
    ]),
  );
  if (div.adapters.length < 2) {
    appendEvent(deps.store, {
      type: 'cli.vote.single-oracle-degraded',
      payload: {
        runId: deps.runId,
        adapter: div.adapters[0] ?? null,
        reason: 'fewer than 2 distinct adapters available',
      },
    });
  }
  return diverseBallotInvoker({
    overlayDir: deps.overlayDir,
    runId: deps.runId,
    seamForVoter: (name) => byVoter.get(name) ?? seamFor(div.adapters[0] as AdapterName),
    discovered: deps.discovered,
  });
}
