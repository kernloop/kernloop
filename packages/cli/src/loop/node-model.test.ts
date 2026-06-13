/**
 * Per-node model derivation [CLM-0078]: each model-calling loop node derives
 * its ModelRequirement from the SINGLE source (template/manifest) it routes to,
 * with no parallel map. Flipping a single source's tier moves the derived node
 * requirement — proving the manifest/template is the sole authority.
 */
import { describe, expect, it } from 'vitest';
import type { ModelRequirement } from '@kernloop/contracts';
import { SHIPPED_TEMPLATES } from '@kernloop/faculty-workforce';
import { voteGateManifest, reviewGateManifest } from '@kernloop/faculty-gates';
import {
  DEFAULT_INVOKE_TIMEOUT_MS,
  LIGHT_INVOKE_TIMEOUT_MS,
  TIERED_NODES,
  defaultModelSources,
  invokeTimeoutForNode,
  nodeRequirement,
} from './node-model.js';

const req = (
  tier: ModelRequirement['tier'],
  effort: ModelRequirement['effort'],
): ModelRequirement => ({
  tier,
  effort,
  capabilities: [],
});

describe('nodeRequirement — derives each node from its single source', () => {
  it('covers exactly the six model-calling nodes', () => {
    expect([...TIERED_NODES].sort()).toEqual(
      ['decompose', 'implement', 'plan', 'research', 'review', 'vote'].sort(),
    );
  });

  it('reads the real shipped templates + gate manifests', () => {
    expect(nodeRequirement('research')).toEqual(SHIPPED_TEMPLATES['researcher']?.model);
    expect(nodeRequirement('plan')).toEqual(SHIPPED_TEMPLATES['pm']?.model);
    expect(nodeRequirement('decompose')).toEqual(SHIPPED_TEMPLATES['pm']?.model);
    expect(nodeRequirement('implement')).toEqual(SHIPPED_TEMPLATES['coder']?.model);
    expect(nodeRequirement('vote')).toEqual(voteGateManifest.model);
    expect(nodeRequirement('review')).toEqual(reviewGateManifest.model);
  });

  it('SINGLE SOURCE: flipping a template tier moves the derived node requirement', () => {
    const sources = defaultModelSources();
    // Flip the coder template to small/low — only via the source, no node map.
    const flipped = { ...sources, coder: { model: req('small', 'low') } };
    expect(nodeRequirement('implement', flipped)).toEqual(req('small', 'low'));
    // plan/research, drawn from OTHER sources, are unaffected by the flip.
    expect(nodeRequirement('plan', flipped)).toEqual(sources.pm.model);
    expect(nodeRequirement('research', flipped)).toEqual(sources.researcher.model);
  });

  it('flipping a gate manifest tier moves its node requirement', () => {
    const sources = { ...defaultModelSources(), vote: { model: req('frontier', 'xhigh') } };
    expect(nodeRequirement('vote', sources)).toEqual(req('frontier', 'xhigh'));
  });

  it('a model-calling gate manifest with no declared model is a loud bug', () => {
    const sources = { ...defaultModelSources(), review: { model: undefined } };
    expect(() => nodeRequirement('review', sources)).toThrow(/declares no model/);
  });
});

describe('invokeTimeoutForNode (#127) — per-node model-call budget', () => {
  it('gives the GENERATIVE nodes (implement/research/review) the full configured base', () => {
    for (const node of ['implement', 'research', 'review'] as const) {
      expect(invokeTimeoutForNode(node, DEFAULT_INVOKE_TIMEOUT_MS)).toBe(DEFAULT_INVOKE_TIMEOUT_MS);
    }
  });

  it('caps the LIGHTER nodes (plan/decompose/vote) at the light budget', () => {
    for (const node of ['plan', 'decompose', 'vote'] as const) {
      expect(invokeTimeoutForNode(node, DEFAULT_INVOKE_TIMEOUT_MS)).toBe(LIGHT_INVOKE_TIMEOUT_MS);
    }
  });

  it('a small configured base lowers EVERY node (the cap is a min, not a floor)', () => {
    expect(invokeTimeoutForNode('implement', 60_000)).toBe(60_000);
    expect(invokeTimeoutForNode('vote', 60_000)).toBe(60_000); // min(60_000, light)
  });

  it('the raised default exceeds the old uniform 5-minute cap for generative nodes', () => {
    expect(DEFAULT_INVOKE_TIMEOUT_MS).toBeGreaterThan(LIGHT_INVOKE_TIMEOUT_MS);
  });
});
