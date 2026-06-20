import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BEGIN,
  END,
  WATCHED,
  applyBlock,
  checkWatched,
  deriveStats,
  renderBlock,
  reportStats,
  runStats,
  toInt,
} from '../stats.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('deriveStats — every count comes from a canonical const', () => {
  const s = deriveStats();
  // Architectural invariants: changing these is a DELIBERATE act (and updates this test).
  test('the frozen contracts are five', () => expect(s.contracts).toBe(5));
  test('the kernel MCP tools are eleven', () => expect(s.tools).toBe(11));
  test('the doc-gate covers twelve tree-sitter languages', () => expect(s.languages).toBe(12));
  test('thirteen packages are doc-coverage gated', () => expect(s.gatedPackages).toBe(13));
  test('five shipped workforce templates', () => expect(s.templates).toBe(5));
  test('the claim count matches the registry glob', () => {
    const glob = fs
      .readdirSync(path.join(root, 'claims/registry'))
      .filter((f) => /^CLM-\d+\.yaml$/.test(f)).length;
    expect(s.claims).toBe(glob);
    expect(s.claims).toBeGreaterThan(0);
  });
});

describe('toInt — digits and English number words', () => {
  test('parses a digit', () => expect(toInt('11')).toBe(11));
  test('parses a number word case-insensitively', () => expect(toInt('Twelve')).toBe(12));
  test('an unknown word is undefined (so it fails a count check)', () =>
    expect(toInt('contains')).toBeUndefined());
});

describe('renderBlock — the generated README table', () => {
  test('is fenced by the markers and shows the derived digits', () => {
    const block = renderBlock({
      contracts: 5,
      tools: 11,
      languages: 12,
      gatedPackages: 9,
      templates: 5,
      claims: 109,
    });
    expect(block.startsWith(BEGIN)).toBe(true);
    expect(block.trimEnd().endsWith(END)).toBe(true);
    // The value cells are column-ALIGNED to the header widths (#400) — the same
    // form claims:render writes, so the two generators agree.
    expect(block).toContain(
      '| 5                | 11               | 12                 | 9              | 109             |',
    );
  });

  test('value cells align to the header column widths — guards the #400 padding regression', () => {
    // If the value row ever reverts to unpadded (`| 5 | 11 | …`), CI's exact-match
    // render-claims --check goes red while stats:check (padding-tolerant) stays
    // green. Assert structural alignment so a regression fails HERE, not in CI.
    const block = renderBlock({
      contracts: 5,
      tools: 11,
      languages: 12,
      gatedPackages: 13,
      templates: 5,
      claims: 163,
    });
    const lines = block.split('\n').filter((l) => l.startsWith('|'));
    const widths = (row) =>
      row
        .split('|')
        .slice(1, -1)
        .map((c) => c.length);
    const [header, , values] = lines; // header, separator, value row
    expect(widths(values)).toEqual(widths(header));
  });
});

describe('applyBlock — inject / check / stale / missing branches', () => {
  const withMarkers = `intro\n\n${BEGIN}\nold\n${END}\n\ntail\n`;
  const block = renderBlock({
    contracts: 5,
    tools: 11,
    languages: 12,
    gatedPackages: 9,
    templates: 5,
    claims: 1,
  });

  test('render mode rewrites the block in place', () => {
    const { text, error } = applyBlock(withMarkers, block, false);
    expect(error).toBeNull();
    // The exact rendered block is injected verbatim (robust to the #400 padding form).
    expect(text).toContain(block);
    expect(text).not.toContain('\nold\n');
  });
  test('check mode flags a stale block', () => {
    const { error } = applyBlock(withMarkers, block, true);
    expect(error).toContain('stale');
  });
  test('check mode passes when the block already matches', () => {
    const current = applyBlock(withMarkers, block, false).text;
    expect(applyBlock(current, block, true).error).toBeNull();
  });
  test('a README missing the markers is an error', () => {
    expect(applyBlock('no markers here', block, false).error).toContain('missing');
  });
});

describe('checkWatched — prose counts match the derived values', () => {
  test('the live repo has zero watched-count drift', () => {
    expect(checkWatched(root, deriveStats())).toEqual([]);
  });
  test('every WATCHED phrase actually resolves in its file (no dangling watch)', () => {
    // A huge derived value forces every found phrase to MISMATCH (never "not found"),
    // so any "not found" error here means a watch points at a phrase that moved.
    const errs = checkWatched(root, {
      contracts: 999,
      tools: 999,
      languages: 999,
      gatedPackages: 999,
      claims: 999,
    });
    expect(errs).toHaveLength(WATCHED.length);
    expect(errs.every((e) => /says \d+|says \w+ but derived/.test(e))).toBe(true);
    expect(errs.some((e) => e.includes('not found'))).toBe(false);
  });
  test('a drifted derived value is reported with the offending file', () => {
    const errs = checkWatched(root, { ...deriveStats(), gatedPackages: 4242 });
    expect(errs.some((e) => e.includes('CLM-0091') && e.includes('4242'))).toBe(true);
  });
});

describe('runStats — read-only check against the live repo', () => {
  test('the committed repo passes stats:check', () => {
    const { stats, errors } = runStats(root, true);
    expect(errors).toEqual([]);
    expect(stats.contracts).toBe(5);
  });
  test('render mode writes the block into a temp README', () => {
    // Counts derive from THIS checkout; only the README path follows the root.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-stats-'));
    fs.writeFileSync(path.join(tmp, 'README.md'), `top\n\n${BEGIN}\nstale\n${END}\n`);
    const { errors } = runStats(tmp, false);
    expect(errors).toEqual([]);
    const out = fs.readFileSync(path.join(tmp, 'README.md'), 'utf8');
    expect(out).toContain('| Frozen contracts |');
    expect(out).not.toContain('\nstale\n');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('checkWatched — present-but-mismatched and absent files', () => {
  test('an empty root yields no errors (every watch file is missing)', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-stats-'));
    expect(checkWatched(empty, deriveStats())).toEqual([]);
    fs.rmSync(empty, { recursive: true, force: true });
  });
  test('a watched file present but missing its phrase is a "not found" error', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-stats-'));
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), 'no count phrase here\n');
    const errs = checkWatched(tmp, deriveStats());
    expect(errs.some((e) => e.includes('AGENTS.md') && e.includes('not found'))).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('reportStats — CLI output + exit code', () => {
  test('clean result prints a ✓ summary and returns 0', () => {
    const lines = [];
    const code = reportStats(
      { stats: { contracts: 5 }, errors: [] },
      true,
      (m) => lines.push(m),
      () => {},
    );
    expect(code).toBe(0);
    expect(lines[0]).toContain('no drift');
    expect(lines[0]).toContain('contracts=5');
  });
  test('errors print to stderr and return 1', () => {
    const errs = [];
    const code = reportStats(
      { stats: {}, errors: ['README.md: stale'] },
      false,
      () => {},
      (m) => errs.push(m),
    );
    expect(code).toBe(1);
    expect(errs[0]).toContain('stale');
  });
});
