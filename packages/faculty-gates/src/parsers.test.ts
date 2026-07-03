import { describe, expect, it } from 'vitest';
import { outputTail, parseEslintOutput, parseTscOutput, parseVitestOutput } from './parsers.js';

/** Real `tsc --noEmit --pretty false` output shape. */
const TSC_SAMPLE = [
  "src/math.ts(2,9): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/math.ts(5,3): error TS2304: Cannot find name 'bogus'.",
  'error TS18003: No inputs were found in config file.',
  '',
].join('\n');

/** Real ESLint stylish output shape. */
const ESLINT_SAMPLE = [
  '/work/src/app.ts',
  "  3:7   error    'unused' is assigned a value but never used  @typescript-eslint/no-unused-vars",
  '  10:1  warning  Unexpected console statement                 no-console',
  '',
  '✖ 2 problems (1 error, 1 warning)',
  '',
].join('\n');

/** Real vitest failure output shape (condensed). */
const VITEST_SAMPLE = [
  ' ❯ src/math.test.ts (2 tests | 1 failed)',
  '   × adds numbers',
  ' FAIL  src/math.test.ts > adds numbers',
  'AssertionError: expected 5 to be 4',
  ' Test Files  1 failed (1)',
  'ERROR: Coverage for lines (45.45%) does not meet global threshold (80%)',
  '',
].join('\n');

describe('parseTscOutput', () => {
  it('parses located tsc errors into findings with paths', () => {
    const findings = parseTscOutput(TSC_SAMPLE, '');
    expect(findings).toHaveLength(3);
    expect(findings[0]).toEqual({
      severity: 'error',
      message: "error TS2322: Type 'string' is not assignable to type 'number'. (src/math.ts:2:9)",
      path: 'src/math.ts',
    });
    expect(findings[1]?.path).toBe('src/math.ts');
  });

  it('parses global tsc errors without a path', () => {
    const findings = parseTscOutput(TSC_SAMPLE, '');
    expect(findings[2]).toEqual({
      severity: 'error',
      message: 'error TS18003: No inputs were found in config file.',
    });
  });

  it('reads diagnostics from stderr too', () => {
    const findings = parseTscOutput('', TSC_SAMPLE);
    expect(findings).toHaveLength(3);
  });

  it('returns no findings for clean output', () => {
    expect(parseTscOutput('', '')).toEqual([]);
  });
});

describe('parseEslintOutput', () => {
  it('maps eslint problem lines to findings under their file header', () => {
    const findings = parseEslintOutput(ESLINT_SAMPLE, '');
    expect(findings).toHaveLength(2);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.path).toBe('/work/src/app.ts');
    expect(findings[0]?.message).toContain('never used');
    expect(findings[0]?.message).toContain('/work/src/app.ts:3:7');
  });

  it('maps eslint warnings to warn severity', () => {
    const findings = parseEslintOutput(ESLINT_SAMPLE, '');
    expect(findings[1]?.severity).toBe('warn');
    expect(findings[1]?.message).toContain('Unexpected console statement');
  });

  it('returns no findings for clean output', () => {
    expect(parseEslintOutput('✔ no problems', '')).toEqual([]);
  });
});

describe('parseVitestOutput', () => {
  it('turns FAIL lines into error findings with the file as path', () => {
    const findings = parseVitestOutput(VITEST_SAMPLE, '');
    const fail = findings.find((f) => f.message === 'failed: src/math.test.ts > adds numbers');
    expect(fail).toBeDefined();
    expect(fail?.severity).toBe('error');
    expect(fail?.path).toBe('src/math.test.ts');
  });

  it('turns coverage threshold breaches into error findings', () => {
    const findings = parseVitestOutput(VITEST_SAMPLE, '');
    const coverage = findings.find((f) => f.message.includes('does not meet global threshold'));
    expect(coverage?.severity).toBe('error');
  });

  it('deduplicates repeated failure lines', () => {
    const doubled = `${VITEST_SAMPLE}\n${VITEST_SAMPLE}`;
    const once = parseVitestOutput(VITEST_SAMPLE, '');
    expect(parseVitestOutput(doubled, '')).toHaveLength(once.length);
  });

  it('returns no findings for a passing run', () => {
    expect(parseVitestOutput(' ✓ src/math.test.ts (2 tests)', '')).toEqual([]);
  });
});

describe('outputTail', () => {
  it('returns the trimmed combined output when short', () => {
    expect(outputTail('out', 'err\n')).toBe('out\nerr');
  });

  it('keeps only the last maxChars characters of long output', () => {
    const tail = outputTail('x'.repeat(5000), '', 100);
    expect(tail).toHaveLength(101);
    expect(tail.startsWith('…')).toBe(true);
  });

  it('never returns an empty string', () => {
    expect(outputTail('', '')).toBe('no output');
  });

  it('drops a long leading banner and surfaces the trailing error line (#549)', () => {
    // The real turbo failure shape: a multi-line banner on stdout, the actual
    // error last on stderr. The finding must carry the error, not the banner head.
    const banner = Array.from({ length: 30 }, (_, i) => `BANNER LINE ${String(i + 1)}`).join('\n');
    const tail = outputTail(
      banner,
      '  x Unable to find package manager binary: cannot find binary path',
    );
    expect(tail).toContain('x Unable to find package manager binary');
    expect(tail).not.toContain('BANNER LINE 1');
    expect(tail.startsWith('…')).toBe(true);
  });
});
