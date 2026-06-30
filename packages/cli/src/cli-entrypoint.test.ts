import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isProcessEntrypoint } from './cli.js';

// #502: the published CLI was silent via `npx @kernloop/cli` / global install / `.bin`
// because the entry guard compared `import.meta.url` against `path.resolve(argv[1])`,
// which does not follow symlinks. The npm bin shim `node_modules/.bin/kernloop` is a
// symlink to `dist/cli.js`, so argv[1] never equaled the realpath-resolved module URL
// and `main()` never ran. The fix realpath-resolves argv[1]. These tests pin that.
describe('isProcessEntrypoint (#502 — recognized through the npm bin symlink)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'kl-entry-'));
    dirs.push(d);
    return d;
  }

  it('true when argv[1] is the real file path (node dist/cli.js)', () => {
    const d = tmp();
    const real = join(d, 'cli.js');
    writeFileSync(real, '// entry');
    expect(isProcessEntrypoint(pathToFileURL(real).href, real)).toBe(true);
  });

  it('true when argv[1] is a SYMLINK to the real file (.bin/kernloop → dist/cli.js)', () => {
    // The regression: with the old path.resolve-only guard this returned false, so the
    // CLI did nothing under npx / global install / .bin.
    const d = tmp();
    const real = join(d, 'cli.js');
    writeFileSync(real, '// entry');
    const link = join(d, 'kernloop');
    symlinkSync(real, link);
    expect(isProcessEntrypoint(pathToFileURL(real).href, link)).toBe(true);
  });

  it('true under --preserve-symlinks (import.meta.url IS the symlink path)', () => {
    // With --preserve-symlinks[-main], Node leaves import.meta.url as the symlink rather
    // than the real file; the resolved-form match covers that so the CLI is not silenced.
    const d = tmp();
    const real = join(d, 'cli.js');
    writeFileSync(real, '// entry');
    const link = join(d, 'kernloop');
    symlinkSync(real, link);
    expect(isProcessEntrypoint(pathToFileURL(link).href, link)).toBe(true);
  });

  it('false when argv[1] points at a different module', () => {
    const d = tmp();
    const real = join(d, 'cli.js');
    writeFileSync(real, '// entry');
    const other = join(d, 'other.js');
    writeFileSync(other, '// other');
    expect(isProcessEntrypoint(pathToFileURL(real).href, other)).toBe(false);
  });

  it('false when argv[1] is undefined (imported as a module, not run)', () => {
    expect(isProcessEntrypoint('file:///whatever/cli.js', undefined)).toBe(false);
  });

  it('does not throw when argv[1] does not exist (realpath falls back to resolve)', () => {
    const d = tmp();
    const missing = join(d, 'nope.js');
    // realpathSync throws ENOENT → fall back to path.resolve, then compare normally.
    expect(isProcessEntrypoint(pathToFileURL(missing).href, missing)).toBe(true);
    expect(isProcessEntrypoint('file:///elsewhere.js', missing)).toBe(false);
  });
});
