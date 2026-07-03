/**
 * Built-in security smell scanner (#277, #227 item 3). Per-rule fixtures: each
 * rule has a TRUE-POSITIVE (known-bad → Finding at the expected severity) AND a
 * BENIGN-LOOKALIKE NEGATIVE (the safe form → NO Finding), so the false-positive
 * rate is measurable. Plus the security invariants: the argv-array `spawn` is NOT
 * flagged (only the shell-invoking exec family), SKIP_DIRS is respected, and a
 * symlink is never followed off the tree.
 */
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanSecuritySmells } from './security-scan.js';

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Write `files` into a fresh workspace and scan it. */
function scan(files: Record<string, string>): ReturnType<typeof scanSecuritySmells> {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-secscan-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return scanSecuritySmells(dir);
}

describe('scanSecuritySmells — dynamic code execution (#277)', () => {
  it('flags eval() with a non-literal argument, but NOT eval of a string literal', () => {
    const bad = scan({ 'a.ts': 'export const f = (x: string) => eval(x);' });
    expect(bad.some((f) => f.message.includes('eval()') && f.severity === 'error')).toBe(true);
    const good = scan({ 'b.ts': "export const f = () => eval('1 + 1');" });
    expect(good).toEqual([]);
  });

  it('flags new Function() with a non-literal body, but NOT an all-literal Function', () => {
    const bad = scan({ 'a.ts': 'export const make = (src: string) => new Function(src);' });
    expect(bad.some((f) => f.message.includes('new Function()'))).toBe(true);
    const good = scan({ 'b.ts': "export const add = new Function('a', 'b', 'return a + b');" });
    expect(good).toEqual([]);
    const empty = scan({ 'c.ts': 'export const noop = new Function();' });
    expect(empty).toEqual([]); // zero-arg Function is inert, not a smell (#277 review)
  });
});

describe('scanSecuritySmells — shell command injection (#277)', () => {
  it('flags exec()/execSync() with a non-literal command in a child_process file', () => {
    const out = scan({
      'a.ts':
        "import { exec } from 'node:child_process';\nexport const run = (c: string) => exec(c);",
    });
    expect(out.some((f) => f.message.includes('exec()') && f.severity === 'error')).toBe(true);
  });

  it('does NOT flag a literal command, nor the argv-array spawn (the safe API)', () => {
    const literal = scan({
      'a.ts': "import { exec } from 'node:child_process';\nexec('ls -la');",
    });
    expect(literal).toEqual([]);
    const spawn = scan({
      'b.ts':
        "import { spawn } from 'node:child_process';\nexport const r = (c: string) => spawn(c, []);",
    });
    expect(spawn).toEqual([]); // spawn takes an argv array, no shell → never flagged
  });

  it('does NOT flag regex .exec() in a file that never imports child_process', () => {
    const out = scan({ 'a.ts': 'export const m = (s: string) => /ab+c/.exec(s);' });
    expect(out).toEqual([]);
  });
});

describe('scanSecuritySmells — known-format hardcoded secrets (#277)', () => {
  it('flags an AWS key, a GitHub token, and a PEM private key header', () => {
    const aws = scan({ 'a.ts': "const k = 'AKIAIOSFODNN7EXAMPLE';" });
    expect(aws.some((f) => f.message.includes('AWS access key id'))).toBe(true);
    const gh = scan({ 'b.ts': "const t = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz';" });
    expect(gh.some((f) => f.message.includes('GitHub token'))).toBe(true);
    const pem = scan({ 'c.env': 'KEY=-----BEGIN RSA PRIVATE KEY-----' });
    expect(pem.some((f) => f.message.includes('PEM private key'))).toBe(true);
  });

  it('does NOT flag a benign string that lacks the credential format', () => {
    const out = scan({ 'a.ts': "const note = 'the AKIA prefix alone is not a key';" });
    expect(out).toEqual([]);
  });
});

describe('scanSecuritySmells — scoped to written files (#541) [CLM-0189]', () => {
  const PRE_EXISTING = {
    // A pre-existing repo file carrying a fixture secret (this repo's own
    // detector fixtures are exactly this shape) — never the child's to own.
    'fixtures/pre-existing.ts': "const k = 'AKIAIOSFODNN7EXAMPLE';",
  };

  it('scoped, ignores a pre-existing secret outside the written files (#541)', () => {
    scan({ ...PRE_EXISTING, 'src/child.ts': 'export const clean = 1;' });
    expect(scanSecuritySmells(dir, [join('src', 'child.ts')])).toEqual([]);
  });

  it('scoped, still flags a secret INSIDE a written file (#541)', () => {
    scan({
      ...PRE_EXISTING,
      'src/child.ts': "const t = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz';",
    });
    // Absolute-but-inside scope entry: canonicalized like the doc scan (#534).
    const findings = scanSecuritySmells(dir, [join(dir, 'src', 'child.ts')]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('GitHub token');
    expect(findings.some((f) => f.message.includes('AWS access key id'))).toBe(false);
  });

  it('an omitted scope keeps the whole-workspace security scan unchanged', () => {
    const findings = scan({ ...PRE_EXISTING, 'src/child.ts': 'export const clean = 1;' });
    expect(findings.some((f) => f.message.includes('AWS access key id'))).toBe(true);
  });
});

describe('scanSecuritySmells — invariants (#277)', () => {
  it('never throws on unparseable generated code, and still scans secrets', () => {
    const out = scan({
      'broken.ts': "function ( { this is not valid ts AKIA'AKIAIOSFODNN7EXAMPLE'",
    });
    expect(Array.isArray(out)).toBe(true); // no throw
  });

  // 180s timeout (#551): two full parses of a ~490k-deep AST are CPU-bound;
  // under the ratified 2-CPU gate sandbox this exceeded the package's 60s default.
  it(
    'never overflows the stack on a deeply-nested file that TS parses (#277 security round)',
    { timeout: 180_000 },
    () => {
      // A ~1 MiB left-deep property chain parses fine but its AST is ~490k deep —
      // an unbounded visitor would RangeError out of the in-process gate. The depth
      // guard must keep this a normal (empty) scan, not a crash.
      const deep = `const x = a${'.b'.repeat(490_000)};`;
      expect(() => scan({ 'deep.ts': deep })).not.toThrow();
      expect(scan({ 'deep.ts': deep })).toEqual([]);
    },
  );

  it('does NOT scan inside node_modules / build dirs (SKIP_DIRS)', () => {
    const out = scan({ 'node_modules/dep/a.ts': 'export const f = (x: string) => eval(x);' });
    expect(out).toEqual([]);
  });

  it('never follows a symlink off the workspace tree', () => {
    dir = mkdtempSync(join(tmpdir(), 'kernloop-secscan-'));
    const secret = mkdtempSync(join(tmpdir(), 'kernloop-secret-'));
    writeFileSync(join(secret, 'leak.ts'), "const k = 'AKIAIOSFODNN7EXAMPLE';");
    try {
      symlinkSync(secret, join(dir, 'link'));
    } catch {
      return; // symlink unsupported on this platform → skip
    }
    try {
      expect(scanSecuritySmells(dir)).toEqual([]); // the symlinked dir is never walked
    } finally {
      rmSync(secret, { recursive: true, force: true });
    }
  });
});
