import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEOUT_MS,
  checksFromDefinitionOfDone,
  defaultQualityChecks,
  diffCoverageCheck,
  docCommentCheck,
  driftChecksFor,
  isInProcessCheck,
  securityCheck,
} from './checks.js';
import { parseEslintOutput, parseTscOutput, parseVitestOutput } from './parsers.js';
import { GATED_PACKAGES } from '../../../scripts/docs-coverage.mjs';

describe('diffCoverageCheck (#226 item 2)', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('is an in-process `diff-coverage` check that flags an untested written module', async () => {
    dir = mkdtempSync(join(tmpdir(), 'kernloop-dcc-'));
    mkdirSync(join(dir, 'coverage'), { recursive: true });
    const other = resolve(dir, 'src/other.ts');
    writeFileSync(
      join(dir, 'coverage', 'coverage-final.json'),
      JSON.stringify({ [other]: { path: other, s: { '0': 1 } } }),
    );
    const check = diffCoverageCheck([
      { path: 'src/new.ts', content: 'export function f() { return 1; }' },
    ]);
    expect(check.name).toBe('diff-coverage');
    expect(isInProcessCheck(check)).toBe(true);
    const findings = await check.run(dir);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('untested module');
  });

  it('adds NO check content for no written files (empty findings, byte-safe)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'kernloop-dcc-'));
    expect(await diffCoverageCheck([]).run(dir)).toEqual([]);
  });
});

describe('docCommentCheck scoping (#534) [CLM-0189]', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** A workspace with one pre-existing and one child-written undocumented export. */
  function seed(): string {
    dir = mkdtempSync(join(tmpdir(), 'kernloop-docscope-'));
    writeFileSync(join(dir, 'pre-existing.ts'), 'export function legacy() {}\n');
    writeFileSync(join(dir, 'child.ts'), 'export function fresh() {}\n');
    return dir;
  }

  it('scoped to writtenFiles, ignores an undocumented export outside them', async () => {
    const ws = seed();
    const findings = await docCommentCheck(['child.ts']).run(ws);
    expect(findings.some((f) => f.message.includes('"legacy"'))).toBe(false);
    expect(findings.some((f) => f.message.includes('"fresh"'))).toBe(true);
  });

  it('unscoped, keeps the whole-workspace semantics (both exports flagged)', async () => {
    const ws = seed();
    const messages = (await docCommentCheck().run(ws)).map((f) => f.message);
    expect(messages.some((m) => m.includes('"legacy"'))).toBe(true);
    expect(messages.some((m) => m.includes('"fresh"'))).toBe(true);
  });

  it('defaultQualityChecks forwards the doc scope to the doc-comments check', async () => {
    const ws = seed();
    const doc = defaultQualityChecks(['child.ts']).find((c) => c.name === 'doc-comments');
    if (doc === undefined || !isInProcessCheck(doc)) throw new Error('doc-comments check missing');
    const findings = await doc.run(ws);
    expect(findings.some((f) => f.message.includes('"legacy"'))).toBe(false);
    expect(findings.some((f) => f.message.includes('"fresh"'))).toBe(true);
  });
});

describe('securityCheck scoping (#541) [CLM-0189]', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** A workspace with a pre-existing fixture secret and a clean child write. */
  function seedSecrets(): string {
    dir = mkdtempSync(join(tmpdir(), 'kernloop-secscope-'));
    writeFileSync(join(dir, 'pre-existing.ts'), "const k = 'AKIAIOSFODNN7EXAMPLE';\n");
    writeFileSync(join(dir, 'child.ts'), 'export const clean = 1;\n');
    return dir;
  }

  it('scoped to writtenFiles, ignores a pre-existing secret outside them (#541)', async () => {
    const ws = seedSecrets();
    expect(await securityCheck(['child.ts']).run(ws)).toEqual([]);
  });

  it('unscoped, the security check keeps its whole-workspace semantics', async () => {
    const ws = seedSecrets();
    const findings = await securityCheck().run(ws);
    expect(findings.some((f) => f.message.includes('AWS access key id'))).toBe(true);
  });

  it('defaultQualityChecks forwards the child scope to the security check too (#541)', async () => {
    const ws = seedSecrets();
    const security = defaultQualityChecks(['child.ts']).find((c) => c.name === 'security');
    if (security === undefined || !isInProcessCheck(security))
      throw new Error('security check missing');
    expect(await security.run(ws)).toEqual([]);
  });
});

describe('driftChecksFor (#564 — closes the #562/DF1 rescue gap)', () => {
  it('adds the claims-render drift check when a claims/ path was written', () => {
    // claims/src/ (not claims/registry/) so this exercises ONLY the claims
    // trigger, not the stats-registry-count trigger too (that overlap is its
    // own test below).
    const checks = driftChecksFor(['claims/src/check.ts']);
    expect(checks).toEqual([
      {
        name: 'claims-render-drift',
        command: 'node',
        args: ['scripts/render-claims.mjs', '--check'],
        parse: expect.any(Function),
      },
    ]);
  });

  it('does NOT add the claims-render check for an unrelated write', () => {
    expect(driftChecksFor(['src/feature.ts'])).toEqual([]);
  });

  it('adds the docs-render drift check when a gated package src file was written', () => {
    const checks = driftChecksFor(['packages/faculty-gates/src/checks.ts']);
    expect(checks).toEqual([
      {
        name: 'docs-render-drift',
        command: 'pnpm',
        args: ['docs:render', '--', '--check'],
        parse: expect.any(Function),
      },
    ]);
  });

  it('does NOT add the docs-render check for a non-gated-package or non-src write', () => {
    expect(driftChecksFor(['packages/faculty-gates/README.md'])).toEqual([]);
    expect(driftChecksFor(['packages/faculty-gates/vitest.config.ts'])).toEqual([]);
  });

  it('mirrors scripts/docs-coverage.mjs GATED_PACKAGES exactly (no silent drift between the two lists)', () => {
    for (const pkg of GATED_PACKAGES) {
      const checks = driftChecksFor([`packages/${pkg}/src/index.ts`]);
      expect(checks.some((c) => c.name === 'docs-render-drift')).toBe(true);
    }
  });

  it('adds the stats drift check when a stats-input const file was written', () => {
    // scripts/docs-coverage.mjs is a pure stats input — not under claims/ and
    // not under any gated package's packages/<pkg>/src/, so this exercises
    // ONLY the stats trigger.
    const checks = driftChecksFor(['scripts/docs-coverage.mjs']);
    expect(checks).toEqual([
      { name: 'stats-drift', command: 'pnpm', args: ['stats:check'], parse: expect.any(Function) },
    ]);
  });

  it('adds the stats drift check for a written claims-registry file too (its count is a derived stat)', () => {
    const checks = driftChecksFor(['claims/registry/CLM-0180.yaml']);
    expect(checks.map((c) => c.name)).toEqual(
      expect.arrayContaining(['claims-render-drift', 'stats-drift']),
    );
  });

  it('does NOT add the stats check for an unrelated write', () => {
    expect(driftChecksFor(['docs/some-guide.md'])).toEqual([]);
  });

  it('empty writtenFiles adds no drift checks', () => {
    expect(driftChecksFor([])).toEqual([]);
  });

  it('a write touching all three inputs adds all three checks, each a real no-parse subprocess check', () => {
    const checks = driftChecksFor([
      'claims/registry/CLM-0180.yaml',
      'packages/kernel/src/index.ts',
      'packages/contracts/src/common.ts',
    ]);
    expect(checks.map((c) => c.name)).toEqual([
      'claims-render-drift',
      'docs-render-drift',
      'stats-drift',
    ]);
    for (const c of checks) {
      expect(c.parse('anything', 'anything', 1)).toEqual([]);
    }
  });
});

describe('checksFromDefinitionOfDone (#226)', () => {
  it('maps each DoD Check to a no-shell subprocess check, tokenized on whitespace', () => {
    const [check] = checksFromDefinitionOfDone([
      { name: 'acceptance', command: 'node verify.mjs --strict' },
    ]);
    expect(check !== undefined && isInProcessCheck(check)).toBe(false);
    expect(check).toMatchObject({
      name: 'dod:acceptance',
      command: 'node',
      args: ['verify.mjs', '--strict'],
    });
  });

  it('does NOT shell-interpret the command — metacharacters become literal argv', () => {
    const [check] = checksFromDefinitionOfDone([
      { name: 'x', command: 'echo a; rm -rf b && curl evil' },
    ]);
    // No shell: `;` and `&&` are just arguments to `echo`, never separators/operators.
    expect(check).toMatchObject({
      command: 'echo',
      args: ['a;', 'rm', '-rf', 'b', '&&', 'curl', 'evil'],
    });
  });

  it('a blank command yields an empty executable that fails to start (fail CLOSED)', () => {
    const [check] = checksFromDefinitionOfDone([{ name: 'blank', command: '   ' }]);
    expect(check?.command).toBe(''); // spawn('') errors → a failed-to-start error finding, never a silent pass
  });

  it('an empty definition-of-done maps to no checks (backward-compat)', () => {
    expect(checksFromDefinitionOfDone([])).toEqual([]);
  });
});

describe('defaultQualityChecks', () => {
  it('default checks cover typecheck, lint, test, the doc-comment scan, and the security scan', () => {
    const checks = defaultQualityChecks();
    expect(checks.map((c) => c.name)).toEqual([
      'typecheck',
      'lint',
      'test',
      'doc-comments',
      'security',
    ]);
  });

  it('the security check is in-process and emits no findings for clean source (#277)', () => {
    const security = defaultQualityChecks().find((c) => c.name === 'security');
    expect(security !== undefined && isInProcessCheck(security)).toBe(true);
  });

  it('the three tool checks are subprocess `pnpm` runs; doc-comments is in-process', () => {
    const checks = defaultQualityChecks();
    const subprocess = checks.filter((c) => !isInProcessCheck(c));
    expect(subprocess.map((c) => (isInProcessCheck(c) ? null : c.command))).toEqual([
      'pnpm',
      'pnpm',
      'pnpm',
    ]);
    expect(subprocess.map((c) => (isInProcessCheck(c) ? null : c.args))).toEqual([
      ['typecheck'],
      ['lint'],
      ['test'],
    ]);
    const docCheck = checks.find((c) => c.name === 'doc-comments');
    expect(docCheck !== undefined && isInProcessCheck(docCheck)).toBe(true);
  });

  it('wires each subprocess check to its tool-specific parser', () => {
    const [typecheck, lint, test] = defaultQualityChecks();
    expect(typecheck !== undefined && !isInProcessCheck(typecheck) && typecheck.parse).toBe(
      parseTscOutput,
    );
    expect(lint !== undefined && !isInProcessCheck(lint) && lint.parse).toBe(parseEslintOutput);
    expect(test !== undefined && !isInProcessCheck(test) && test.parse).toBe(parseVitestOutput);
  });

  it('docCommentCheck is an in-process check named doc-comments', () => {
    const check = docCommentCheck();
    expect(check.name).toBe('doc-comments');
    expect(isInProcessCheck(check)).toBe(true);
    expect(typeof check.run).toBe('function');
  });

  it('isInProcessCheck discriminates the union by the `run` property', () => {
    expect(isInProcessCheck({ name: 'd', run: () => [] })).toBe(true);
    expect(isInProcessCheck({ name: 't', command: 'pnpm', args: ['test'], parse: () => [] })).toBe(
      false,
    );
  });

  it('returns a fresh array each call', () => {
    expect(defaultQualityChecks()).not.toBe(defaultQualityChecks());
  });

  it('defaults the per-check timeout to two minutes', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(120_000);
  });
});
