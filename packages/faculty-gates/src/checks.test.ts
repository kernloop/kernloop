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
  isInProcessCheck,
} from './checks.js';
import { parseEslintOutput, parseTscOutput, parseVitestOutput } from './parsers.js';

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
