import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import {
  OVERLAY_DIR_NAME,
  OverlayError,
  OverlaySchema,
  gateForNode,
  initOverlay,
  loadOverlay,
  overlayPaths,
  specialistsForNode,
} from './overlay.js';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-overlay-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Init a repo, overwrite overlay.yaml with `yaml`, and load it. */
function loadFrom(yaml: string): ReturnType<typeof loadOverlay> {
  const repo = tmp();
  initOverlay(repo);
  writeFileSync(path.join(repo, OVERLAY_DIR_NAME, 'overlay.yaml'), yaml);
  return loadOverlay(path.join(repo, OVERLAY_DIR_NAME));
}

describe('overlayPaths', () => {
  it('resolves the spec §7 file layout under the overlay directory', () => {
    const repo = tmp();
    const paths = overlayPaths(path.join(repo, OVERLAY_DIR_NAME));
    expect(paths.repoRoot).toBe(repo);
    expect(paths.audit).toBe(path.join(repo, '.kernloop', 'audit.jsonl'));
    expect(paths.memory).toBe(path.join(repo, '.kernloop', 'memory.sqlite'));
    expect(paths.config).toBe(path.join(repo, '.kernloop', 'overlay.yaml'));
  });
});

describe('initOverlay', () => {
  it('scaffolds overlay.yaml and gitignores the memory database', () => {
    const repo = tmp();
    const result = initOverlay(repo);
    expect(result.created).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    const config = readFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), 'utf8');
    expect(config).toContain(`id: ${path.basename(repo)}`);
    const gitignore = readFileSync(path.join(repo, '.kernloop', '.gitignore'), 'utf8');
    expect(gitignore).toContain('memory.sqlite');
    expect(existsSync(path.join(repo, '.kernloop', 'audit.jsonl'))).toBe(false);
  });

  it('writes a template that round-trips: parses against OverlaySchema as exactly the defaults', () => {
    const repo = tmp();
    initOverlay(repo);
    const raw: unknown = YAML.parse(
      readFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), 'utf8'),
    );
    const parsed = OverlaySchema.parse(raw);
    expect(parsed).toEqual(OverlaySchema.parse({ id: path.basename(repo) }));
    expect(parsed.K).toBe(3);
    expect(parsed.gates.vote).toEqual({ strategy: 'simple_majority', panel: 3 });
  });

  it('never overwrites existing files on re-init', () => {
    const repo = tmp();
    initOverlay(repo);
    writeFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), 'id: custom\n');
    const second = initOverlay(repo);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);
    expect(readFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), 'utf8')).toBe('id: custom\n');
  });
});

describe('loadOverlay defaults and precedence', () => {
  it('derives full defaults from the repo directory name when overlay.yaml is absent', () => {
    const repo = tmp();
    const overlay = loadOverlay(path.join(repo, OVERLAY_DIR_NAME));
    expect(overlay.id).toBe(path.basename(repo));
    expect(overlay.budgets).toEqual({ tokens: 100_000, usd: 1, wallClockMin: 30 });
    expect(overlay.briefTokens).toBe(4_000);
    expect(overlay.K).toBe(3);
    expect(overlay.Kc).toBe(3); // child-iterate bound default [CLM-0043]
    expect(overlay.budgetMode).toBe('enforce'); // budget enforced by default [CLM-0077]
    expect(overlay.gates).toEqual({ vote: { strategy: 'simple_majority', panel: 3 }, quality: {} });
    expect(overlay.nodeOverrides).toEqual({});
    expect(overlay.adapters).toBeUndefined(); // per-tier adapters are opt-in [CLM-0078]
  });

  it('loads Kc and budgetMode from the file; rejects an invalid mode [CLM-0043, CLM-0077]', () => {
    const overlay = loadFrom('id: x\nKc: 5\nbudgetMode: unlimited\n');
    expect(overlay.Kc).toBe(5);
    expect(overlay.budgetMode).toBe('unlimited');
    expect(() => loadFrom('id: x\nKc: 0\n')).toThrow(); // Kc floor is 1
    expect(() => loadFrom('id: x\nbudgetMode: yolo\n')).toThrow(); // enforce | unlimited only
  });

  it('loads the optional per-tier adapters block [CLM-0078]', () => {
    const overlay = loadFrom(
      'id: tiered\nadapters:\n  frontier: claude\n  large: claude\n  medium: codex\n  small: ollama\n',
    );
    expect(overlay.adapters).toEqual({
      frontier: 'claude',
      large: 'claude',
      medium: 'codex',
      small: 'ollama',
    });
  });

  it('accepts a partial adapters block — any tier may be set alone [CLM-0078]', () => {
    expect(loadFrom('id: x\nadapters:\n  medium: gemini\n').adapters).toEqual({ medium: 'gemini' });
    expect(loadFrom('id: x\nadapters:\n  frontier: opencode\n').adapters).toEqual({
      frontier: 'opencode',
    });
  });

  it('file values win over defaults; unset knobs still default (precedence)', () => {
    const overlay = loadFrom('id: my-overlay\nK: 5\nbudgets:\n  usd: 2.5\n');
    expect(overlay.K).toBe(5); // file wins
    expect(overlay.budgets.usd).toBe(2.5); // file wins inside a partial object
    expect(overlay.budgets.tokens).toBe(100_000); // sibling defaults survive
    expect(overlay.briefTokens).toBe(4_000);
    expect(overlay.gates.vote.panel).toBe(3);
  });

  it('loads a fully specified overlay: gates, K, and node overrides', () => {
    const overlay = loadFrom(
      [
        'id: full',
        'budgets: { tokens: 50000, usd: 0.5, wallClockMin: 10 }',
        'briefTokens: 2000',
        'K: 2',
        'gates:',
        '  vote: { strategy: supermajority, panel: 7 }',
        '  quality: { timeoutMsPerCheck: 60000 }',
        'nodeOverrides:',
        '  review: { gate: security-review }',
        '  fan-out: { specialists: [api-designer, perf-engineer] }',
        '',
      ].join('\n'),
    );
    expect(overlay.gates.vote).toEqual({ strategy: 'supermajority', panel: 7 });
    expect(overlay.gates.quality.timeoutMsPerCheck).toBe(60_000);
    expect(overlay.nodeOverrides['review']).toEqual({ gate: 'security-review' });
    expect(overlay.nodeOverrides['fan-out']?.specialists).toEqual([
      'api-designer',
      'perf-engineer',
    ]);
  });

  it('accepts every vote strategy in use (spec §12.3)', () => {
    for (const strategy of ['simple_majority', 'supermajority', 'unanimous']) {
      const overlay = loadFrom(`id: s\ngates:\n  vote:\n    strategy: ${strategy}\n`);
      expect(overlay.gates.vote.strategy).toBe(strategy);
    }
  });
});

describe('loadOverlay rejection matrix', () => {
  it('rejects unparseable YAML with a typed OverlayError carrying no zod issues', () => {
    const repo = tmp();
    initOverlay(repo);
    writeFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), 'id: [unclosed\n');
    let caught: unknown;
    try {
      loadOverlay(path.join(repo, OVERLAY_DIR_NAME));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OverlayError);
    expect((caught as OverlayError).issues).toHaveLength(0);
  });

  it.each([
    ['empty id', 'id: ""\n'],
    ['K below 1', 'id: x\nK: 0\n'],
    ['fractional K', 'id: x\nK: 2.5\n'],
    ['non-numeric K', 'id: x\nK: three\n'],
    ['vote panel outside {3,7}', 'id: x\ngates:\n  vote:\n    panel: 5\n'],
    ['unknown vote strategy', 'id: x\ngates:\n  vote:\n    strategy: plurality\n'],
    ['zero token budget', 'id: x\nbudgets:\n  tokens: 0\n'],
    ['negative usd budget', 'id: x\nbudgets:\n  usd: -1\n'],
    ['zero briefTokens', 'id: x\nbriefTokens: 0\n'],
    ['non-positive quality timeout', 'id: x\ngates:\n  quality:\n    timeoutMsPerCheck: 0\n'],
    ['unknown top-level key (P3 priors)', 'id: x\npriors: priors.yaml\n'],
    ['unknown key inside gates.vote', 'id: x\ngates:\n  vote:\n    quorum: 2\n'],
    ['empty node override (hides intent)', 'id: x\nnodeOverrides:\n  review: {}\n'],
    ['skip in a node override', 'id: x\nnodeOverrides:\n  review: { skip: true }\n'],
    ['empty gate name in an override', 'id: x\nnodeOverrides:\n  review: { gate: "" }\n'],
    ['unknown adapter name in a tier', 'id: x\nadapters:\n  medium: gpt5\n'],
    ['unknown tier key inside adapters', 'id: x\nadapters:\n  cheap: claude\n'],
    [
      'unknown model tier in a node override',
      'id: x\nnodeOverrides:\n  research: { tier: huge }\n',
    ],
    [
      'unknown effort in a node override',
      'id: x\nnodeOverrides:\n  research: { effort: max-plus }\n',
    ],
  ])('rejects %s with a typed OverlayError carrying the zod issues', (_name, yaml) => {
    let caught: unknown;
    try {
      loadFrom(yaml);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OverlayError);
    expect((caught as OverlayError).issues.length).toBeGreaterThan(0);
    expect((caught as OverlayError).message).toContain('overlay.yaml is invalid');
  });
});

describe('node override accessors (spec §6: swap a gate, add a specialist)', () => {
  const overlay = OverlaySchema.parse({
    id: 'x',
    nodeOverrides: {
      review: { gate: 'security-review' },
      'fan-out': { specialists: ['api-designer'] },
    },
  });

  it('gateForNode: the override wins over the declared gate', () => {
    expect(gateForNode(overlay, 'review', 'review-default')).toBe('security-review');
  });

  it('gateForNode: falls back to the declared gate without an override', () => {
    expect(gateForNode(overlay, 'quality', 'quality')).toBe('quality');
    expect(gateForNode(overlay, 'fan-out', 'none')).toBe('none'); // specialists-only override
  });

  it('specialistsForNode: returns the added templates, or empty without an override', () => {
    expect(specialistsForNode(overlay, 'fan-out')).toEqual(['api-designer']);
    expect(specialistsForNode(overlay, 'review')).toEqual([]);
    expect(specialistsForNode(overlay, 'integrate')).toEqual([]);
  });
});
