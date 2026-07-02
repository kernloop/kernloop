/**
 * #509 endpoint-diverse (per-MODEL) vote panel — the HONEST-framing core. These
 * pin the load-bearing conditions from the ratification panel: chat-only filtering
 * of `/v1/models` (embeddings/moderation/audio/image/rerank dropped), the
 * correlated-oracle CAVEAT on the visible Verdict Finding (NOT independence, NOT
 * closing CLM-0164, and neither high NOR low disagreement establishes independence),
 * the measured divergence, and the deterministic shared round-robin.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditStore } from '@kernloop/kernel';
import { identityKey } from '@kernloop/faculty-gates';
import type { ModelIdentity, Verdict, VoterRecord } from '@kernloop/contracts';
import type { DiscoveredCache } from '@kernloop/faculty-models';
import type { Overlay } from '../overlay.js';
import { readEnvelopes } from '../tools/audit.js';
import { voteInvokerFor, type VoteInvokerDeps } from './vote-diversity.js';
import type { LoopInvoke } from './invoke.js';
import type { NodeSeam } from './node-seam.js';
import {
  activeModelDiversity,
  assignRoundRobin,
  buildModelDiversity,
  disagreementOf,
  endpointChatModels,
  endpointOracleIdentity,
  isChatCapableModel,
  modelDiverseFindings,
  type ModelDiversity,
} from './vote-model-diversity.js';

const mid = (raw: string, extra: Partial<ModelIdentity> = {}): ModelIdentity => ({
  provider: 'openai',
  family: 'gpt',
  generation: '4',
  variant: null,
  tier: 'large',
  raw,
  resolvedBy: 'rule',
  contextWindow: null,
  inputCostPerMTok: null,
  outputCostPerMTok: null,
  ...extra,
});

const cacheWith = (endpointId: string, models: ModelIdentity[]): DiscoveredCache =>
  ({
    snapshot: '2026-07-02',
    sources: { [endpointId]: { syncedAt: '2026-07-02', models } },
  }) as DiscoveredCache;

describe('isChatCapableModel — filters /v1/models to chat models (#509 condition 1)', () => {
  it.each(['gpt-4o', 'claude-opus-4-8', 'gemini-2.5-pro', 'llama-3.1-70b', 'qwen-2.5', 'o3-mini'])(
    'keeps chat model %s',
    (raw) => expect(isChatCapableModel(mid(raw))).toBe(true),
  );

  it.each([
    'text-embedding-3-large',
    'text-embedding-ada-002',
    'omni-moderation-latest',
    'whisper-1',
    'tts-1-hd',
    'gpt-4o-mini-tts',
    'gpt-4o-transcribe',
    'dall-e-3',
    'stable-diffusion-xl',
    'rerank-english-v3',
    'clip-vit-large',
    // non-OpenAI families (MED-1: the reject-list must not be OpenAI-centric)
    'bge-large-en-v1.5',
    'gte-large',
    'e5-mistral-7b-instruct',
    'voyage-2',
    'jina-colbert-v2',
    'nomic-embed-text-v1',
  ])('drops non-chat model %s', (raw) => expect(isChatCapableModel(mid(raw))).toBe(false));
});

describe('endpointOracleIdentity — the #509 HIGH-1 honesty collapse', () => {
  const seamFor = (model: string): NodeSeam =>
    ({
      invoke: (() => {}) as unknown,
      served: { model, servedTier: 'large' },
    }) as unknown as NodeSeam;

  it('gives every per-model voter ONE uniform class (distinct raw) so the faculty sees a single oracle', () => {
    const a = endpointOracleIdentity('my-provider', seamFor('gpt-4o'));
    const b = endpointOracleIdentity('my-provider', seamFor('claude-opus'));
    // identityKey = provider/family/generation/tier — MUST be identical (collapse to 1 class)
    expect([a.provider, a.family, a.generation, a.tier]).toEqual([
      b.provider,
      b.family,
      b.generation,
      b.tier,
    ]);
    expect(a.provider).toBe('endpoint:my-provider');
    // raw stays DISTINCT so the divergence metric still attributes per model
    expect(a.raw).toBe('gpt-4o');
    expect(b.raw).toBe('claude-opus');
    expect(a.raw).not.toBe(b.raw);
  });

  it('LOCKSTEP: collapses EXACTLY the fields the real identityKey consults (tripwire vs a leak)', () => {
    // The ratification panel's condition: pin the collapse to the ACTUAL faculty class
    // key. Two distinct models must map to the SAME identityKey — so if identityKey ever
    // grows a field (e.g. raw) that endpointOracleIdentity does not uniform-ize, this
    // fails and the diversity-theater leak cannot silently reopen.
    const ka = identityKey(endpointOracleIdentity('ep', seamFor('gpt-4o')));
    const kb = identityKey(endpointOracleIdentity('ep', seamFor('claude-opus')));
    expect(ka).toBe(kb);
  });
});

describe('endpointChatModels — partition + stable sort + per-source read', () => {
  it('partitions chat vs dropped and sorts chat deterministically by id', () => {
    const cache = cacheWith('ep', [
      mid('gpt-4o'),
      mid('text-embedding-3-large'),
      mid('claude-opus'),
      mid('whisper-1'),
    ]);
    const { chat, dropped } = endpointChatModels(cache, 'ep');
    expect(chat.map((m) => m.raw)).toEqual(['claude-opus', 'gpt-4o']); // sorted
    expect(dropped.map((m) => m.raw).sort()).toEqual(['text-embedding-3-large', 'whisper-1']);
  });

  it('returns empty for a missing / unsynced source (no crash)', () => {
    expect(endpointChatModels(cacheWith('other', [mid('gpt-4o')]), 'ep')).toEqual({
      chat: [],
      dropped: [],
    });
  });
});

const overlayWithEndpoint = (models: Record<string, string>): Overlay =>
  ({
    adapters: {},
    endpoints: {
      'my-provider': { baseUrl: 'https://api.example.com/v1', apiKeyEnv: 'MY_KEY', models },
    },
    nodeOverrides: {},
  }) as unknown as Overlay;

describe('buildModelDiversity — only an endpoint-only run with ≥2 chat models', () => {
  const overlay = overlayWithEndpoint({ large: 'gpt-4o' });
  const totals = { tokens: 0, usd: 0 };

  it('undefined when the run adapter is not a registered endpoint (a CLI adapter)', () => {
    const cache = cacheWith('claude', [mid('a'), mid('b')]);
    expect(buildModelDiversity(overlay, 'claude', cache, totals)).toBeUndefined();
  });

  it('undefined when the endpoint serves fewer than 2 chat models', () => {
    // one chat + one embedding → only 1 chat model → no panel
    const cache = cacheWith('my-provider', [mid('gpt-4o'), mid('text-embedding-3-large')]);
    expect(buildModelDiversity(overlay, 'my-provider', cache, totals)).toBeUndefined();
  });

  it('builds a per-model panel for ≥2 chat models, dropping non-chat + pinning the model', () => {
    const cache = cacheWith('my-provider', [
      mid('gpt-4o'),
      mid('claude-opus'),
      mid('text-embedding-3-large'),
    ]);
    const md = buildModelDiversity(overlay, 'my-provider', cache, totals);
    expect(md).toBeDefined();
    expect(md?.endpointId).toBe('my-provider');
    expect(md?.models.map((m) => m.raw)).toEqual(['claude-opus', 'gpt-4o']);
    expect(md?.dropped.map((m) => m.raw)).toEqual(['text-embedding-3-large']);
    // seamForModel PINS the discovered id as the served model (no tier resolution).
    const seam = md?.seamForModel(mid('gpt-4o'));
    expect(seam?.served.model).toBe('gpt-4o');
    expect(seam?.served.adapter).toBe('my-provider');
  });
});

describe('assignRoundRobin — shared deterministic voter→item map (#509 condition 5)', () => {
  it('round-robins voter i → items[i % n]', () => {
    const m = assignRoundRobin(['v0', 'v1', 'v2', 'v3'], ['a', 'b']);
    expect([...m.values()]).toEqual(['a', 'b', 'a', 'b']);
  });
});

describe('activeModelDiversity — panel-7 ratification, endpoint-only, ≥2 models', () => {
  const md = { models: [mid('a'), mid('b')] } as ModelDiversity;
  it('active only for a ratification vote with no CLI adapters and ≥2 models', () => {
    expect(activeModelDiversity(md, 0, true)).toBe(md);
    expect(activeModelDiversity(md, 2, true)).toBeUndefined(); // cross-adapter takes precedence
    expect(activeModelDiversity(md, 0, false)).toBeUndefined(); // loop vote unaffected
    expect(activeModelDiversity({ models: [mid('a')] } as ModelDiversity, 0, true)).toBeUndefined();
    expect(activeModelDiversity(undefined, 0, true)).toBeUndefined();
  });
});

describe('disagreementOf — divergence signal (0 unanimous → 1 split)', () => {
  it('0 for empty or unanimous', () => {
    expect(disagreementOf([])).toBe(0);
    expect(disagreementOf(['approve', 'approve', 'approve'])).toBe(0);
  });
  it('1 − plurality share for a split', () => {
    expect(disagreementOf(['approve', 'approve', 'approve', 'reject'])).toBeCloseTo(0.25);
    expect(disagreementOf(['approve', 'reject'])).toBeCloseTo(0.5);
  });
});

const record = (vote: VoterRecord['vote'], reasoning: string, raw?: string): VoterRecord =>
  ({
    voter: `v-${raw ?? vote}`,
    vote,
    reasoning,
    ...(raw === undefined ? {} : { served: mid(raw) }),
  }) as VoterRecord;

const verdictWith = (voters: VoterRecord[]): Verdict => ({ voters }) as unknown as Verdict;
const md2 = { endpointId: 'my-provider', models: [mid('a'), mid('b')] } as ModelDiversity;

describe('modelDiverseFindings — the VISIBLE honest Verdict findings (#509 conditions 2/3)', () => {
  it('emits a correlated-oracle CAVEAT that refuses the independence overclaim', () => {
    const [caveat] = modelDiverseFindings(
      verdictWith([record('approve', 'ok', 'gpt-4o'), record('reject', 'no', 'claude-opus')]),
      md2,
    );
    expect(caveat?.severity).toBe('warn');
    expect(caveat?.path).toBe('endpoints.my-provider');
    // The load-bearing honesty phrases must be on the VISIBLE finding, not just the claim.
    expect(caveat?.message).toContain('within ONE oracle');
    expect(caveat?.message).toContain('NOT cross-provider independence');
    expect(caveat?.message).toContain('[CLM-0164]');
    expect(caveat?.message).toContain('#348');
    expect(caveat?.message).toMatch(/[Nn]either high nor low/);
    expect(caveat?.message).toContain('divergence signal, not an independence measurement');
  });

  it('measures divergence + distinct model ids, counting only voters that ACTUALLY balloted', () => {
    const [, metric] = modelDiverseFindings(
      verdictWith([
        record('approve', 'ok', 'gpt-4o'),
        record('approve', 'ok', 'claude-opus'),
        record('reject', 'no', 'gpt-4o'),
        record('abstain', 'voter_error: endpoint 500', 'claude-opus'), // failed → not a participant
      ]),
      md2,
    );
    expect(metric?.severity).toBe('info');
    // 3 participants (the voter_error abstain excluded), disagreement 1 - 2/3 = 0.33
    expect(metric?.message).toContain('0.33');
    expect(metric?.message).toContain('3 ballot(s)');
    expect(metric?.message).toContain('2 distinct model id(s)');
    expect(metric?.message).toContain('1 voter(s) failed to ballot');
  });
});

describe('voteInvokerFor — endpoint-only routing decision + audit (#509, wired)', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const stubInvoke = (async () => ({ output: '{}', cost: {} })) as unknown as LoopInvoke;
  const stubSeam = { invoke: stubInvoke, served: {} } as unknown as NodeSeam;
  const emptyCache = { snapshot: 'x', sources: {} } as DiscoveredCache;

  const deps = (modelDiverse?: ModelDiversity): VoteInvokerDeps => {
    dir = mkdtempSync(join(tmpdir(), 'mdvote-'));
    return {
      invoke: stubInvoke,
      store: createAuditStore(join(dir, 'audit.jsonl')),
      overlayDir: dir,
      discovered: emptyCache,
      runId: 'run-1',
      isRatification: true,
      voteDiversity: {
        adapters: [],
        seamForAdapter: () => stubSeam,
        ...(modelDiverse === undefined ? {} : { modelDiverse }),
      },
    };
  };
  const events = () => readEnvelopes(join(dir, 'audit.jsonl'));

  it('takes the per-model path (audits model-diverse-single-oracle) for ≥2 chat models', () => {
    const md: ModelDiversity = {
      endpointId: 'my-provider',
      models: [mid('gpt-4o'), mid('claude-opus')],
      dropped: [mid('text-embedding-3-large')],
      seamForModel: () => stubSeam,
    };
    voteInvokerFor(deps(md));
    const evts = events();
    expect(evts.filter((e) => e.type === 'cli.vote.model-diverse-single-oracle')).toHaveLength(1);
    expect(
      evts.find((e) => e.type === 'cli.vote.model-diverse-single-oracle')?.payload,
    ).toMatchObject({ endpoint: 'my-provider', models: 2, dropped: 1 });
    // The plain single-oracle degrade must NOT also fire — the model-diverse path was taken.
    expect(evts.filter((e) => e.type === 'cli.vote.single-oracle-degraded')).toHaveLength(0);
  });

  it('falls back to the honest single-oracle degrade when no model diversity is available', () => {
    voteInvokerFor(deps(undefined));
    const evts = events();
    expect(evts.filter((e) => e.type === 'cli.vote.single-oracle-degraded')).toHaveLength(1);
    expect(evts.filter((e) => e.type === 'cli.vote.model-diverse-single-oracle')).toHaveLength(0);
  });
});
