import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CI_ONLY,
  blockScalarRunLines,
  ciRunCommands,
  missingGates,
  normalizeCmd,
  preflightGates,
  requiredGates,
  resolvePnpm,
  runCheck,
} from '../check-preflight-sync.mjs';

const SCRIPTS = {
  build: 'turbo run build',
  'governance:check': 'node scripts/governance-check.mjs',
  'docs:render': 'tsx scripts/render-api-docs.mjs',
  test: 'turbo run test && vitest run',
};

describe('normalizeCmd', () => {
  test('collapses runs of whitespace and trims', () => {
    expect(normalizeCmd('  pnpm   foo   bar ')).toBe('pnpm foo bar');
  });
});

describe('resolvePnpm — alias-aware one-level resolution', () => {
  test('a known pnpm alias resolves to its script definition', () => {
    expect(resolvePnpm('pnpm governance:check', SCRIPTS)).toBe('node scripts/governance-check.mjs');
  });
  test('a `-- <args>` suffix is appended to the resolved definition', () => {
    expect(resolvePnpm('pnpm docs:render -- --check', SCRIPTS)).toBe(
      'tsx scripts/render-api-docs.mjs --check',
    );
  });
  test('an alias and its raw equivalent canonicalize identically', () => {
    expect(resolvePnpm('pnpm governance:check', SCRIPTS)).toBe(
      resolvePnpm('node scripts/governance-check.mjs', SCRIPTS),
    );
  });
  test('an unknown pnpm name is returned normalized, unresolved', () => {
    expect(resolvePnpm('pnpm not-a-script', SCRIPTS)).toBe('pnpm not-a-script');
  });
  test('a non-pnpm command passes through normalized', () => {
    expect(resolvePnpm('node  scripts/x.mjs  --check', SCRIPTS)).toBe('node scripts/x.mjs --check');
  });
});

describe('ciRunCommands', () => {
  test('extracts every single-line `run:` step', () => {
    const yaml = [
      'jobs:',
      '  a:',
      '    steps:',
      '      - run: pnpm build',
      '      - run: pnpm test',
    ].join('\n');
    expect(ciRunCommands(yaml)).toEqual(['pnpm build', 'pnpm test']);
  });
  test('a line without run: is ignored', () => {
    expect(ciRunCommands('      - uses: actions/checkout@v4')).toEqual([]);
  });
});

describe('requiredGates — fail-closed: every non-CI-only run command is required', () => {
  const yaml = [
    '      - run: pnpm install --frozen-lockfile',
    '      - run: pnpm build',
    '      - run: node scripts/governance-check.mjs',
    '      - run: bash scripts/new-gate.sh',
  ].join('\n');
  const gates = requiredGates(yaml, SCRIPTS);
  test('CI-only commands (install) are excluded', () => {
    expect([...gates].some((g) => g.includes('install'))).toBe(false);
  });
  test('a NON-pnpm/scripts gate form is REQUIRED by default (no gate-form allowlist to escape)', () => {
    // The false-negative the review caught: a gate that does not look like a pnpm/
    // scripts command must still be required, or it could be added to CI yet escape preflight.
    expect(gates.has('bash scripts/new-gate.sh')).toBe(true);
  });
  test('gates are resolved and deduped', () => {
    expect(gates.has('turbo run build')).toBe(true);
    expect(gates.has('node scripts/governance-check.mjs')).toBe(true);
  });
  test('CI_ONLY is a non-empty list of regexes', () => {
    expect(CI_ONLY.length).toBeGreaterThan(0);
    expect(CI_ONLY[0]).toBeInstanceOf(RegExp);
  });
});

describe('blockScalarRunLines — multi-line run: blocks fail loud, never silently skip', () => {
  test('detects `run: |` and `run: >` block openers (with chomp + indentation indicators)', () => {
    const yaml = [
      '      - run: |',
      '          pnpm a',
      '      - run: >-',
      '          pnpm b',
      '      - run: |2-',
      '          pnpm c',
    ].join('\n');
    expect(blockScalarRunLines(yaml)).toHaveLength(3);
  });
  test('a single-line run: is NOT a block scalar', () => {
    expect(blockScalarRunLines('      - run: pnpm build')).toEqual([]);
  });
  test('runCheck fails loud when ci.yml introduces a block scalar (no silent pass)', () => {
    // Simulated via a temp repo would need fs; instead assert the detector + reason wiring
    // through a yaml fixture by checking the detector the runCheck branch depends on.
    const yaml = '      - run: |\n          pnpm newgate';
    expect(blockScalarRunLines(yaml).length).toBeGreaterThan(0);
  });
});

describe('missingGates / preflightGates', () => {
  const yaml = '      - run: pnpm build\n      - run: pnpm governance:check';
  test('a preflight covering every gate has no missing', () => {
    const preflight = 'pnpm build && pnpm governance:check';
    expect(missingGates(preflight, yaml, SCRIPTS)).toEqual([]);
  });
  test('a preflight missing a gate reports it (resolved form)', () => {
    const preflight = 'pnpm build'; // omits governance:check
    expect(missingGates(preflight, yaml, SCRIPTS)).toEqual(['node scripts/governance-check.mjs']);
  });
  test('the raw CI invocation is matched by the pnpm-alias preflight form', () => {
    const rawYaml = '      - run: node scripts/governance-check.mjs';
    expect(missingGates('pnpm governance:check', rawYaml, SCRIPTS)).toEqual([]);
    expect(
      preflightGates('pnpm governance:check', SCRIPTS).has('node scripts/governance-check.mjs'),
    ).toBe(true);
  });
});

describe('runCheck — the real repo is in sync (enforcement)', () => {
  test('the actual package.json preflight covers every CI gate', () => {
    const verdict = runCheck();
    expect(verdict.missing).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  /** Build a throwaway repo root with a given preflight + ci.yml and run the check. */
  function checkWith(preflight, ciYaml) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-sync-'));
    fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { preflight } }));
    fs.writeFileSync(path.join(dir, '.github/workflows/ci.yml'), ciYaml);
    try {
      return runCheck(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test('fails loud (ok=false, no missing) when ci.yml has a multi-line run block', () => {
    const verdict = checkWith('pnpm build', '      - run: |\n          pnpm newgate');
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual([]);
    expect(verdict.reason).toMatch(/multi-line/);
  });

  test('reports a missing gate when preflight omits one CI runs', () => {
    const verdict = checkWith('pnpm build', '      - run: pnpm build\n      - run: pnpm lint');
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(['pnpm lint']);
  });

  test('ok when preflight covers every single-line CI gate', () => {
    const verdict = checkWith(
      'pnpm build && pnpm lint',
      '      - run: pnpm build\n      - run: pnpm lint',
    );
    expect(verdict.ok).toBe(true);
  });

  test('fails when there is no preflight script at all', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-sync-'));
    fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: {} }));
    fs.writeFileSync(path.join(dir, '.github/workflows/ci.yml'), '      - run: pnpm build');
    try {
      const verdict = runCheck(dir);
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toMatch(/no `preflight`/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
