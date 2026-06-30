/**
 * Scenario F — the bin-symlink invariant (#502). The published CLI is launched
 * through the npm bin shim `node_modules/.bin/kernloop`, which is a SYMLINK to
 * `dist/cli.js`. A regression once made the binary silent on exactly this path:
 * the process-entry guard compared the symlink path (`argv[1]`) instead of its
 * realpath, so `main()` never ran and `npx @kernloop/cli` / a global install
 * produced no output. This drives the REAL built binary through a real symlink
 * and proves it actually runs — the end-to-end counterpart to the unit-level
 * guard test (packages/cli/src/cli-entrypoint.test.ts, CLM-0185).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_ENTRY = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'cli.js');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('Scenario F — the built CLI runs through the npm bin symlink (#502)', () => {
  it('spawning `kernloop --help` through a symlink to dist/cli.js produces usage output', () => {
    if (!existsSync(CLI_ENTRY)) {
      throw new Error(
        `CLI not built: ${CLI_ENTRY} is missing — run \`pnpm build\` before \`pnpm e2e\``,
      );
    }
    const dir = mkdtempSync(path.join(tmpdir(), 'kl-binsym-'));
    dirs.push(dir);
    // The exact shape npm creates for the `kernloop` bin: a symlink → the real entry.
    const link = path.join(dir, 'kernloop');
    symlinkSync(CLI_ENTRY, link);

    const result = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });

    // The bug's signature was empty stdout + exit 0; the fix yields real usage output.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('usage: kernloop');
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});
