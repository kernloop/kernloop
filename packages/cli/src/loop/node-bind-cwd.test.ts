/**
 * #570 regression — agentic subprocess cwd containment at the loop seam.
 *
 * The defect: the default per-node seam spawned CLI-adapter children with the
 * ORCHESTRATOR's cwd (`adapterInvoke(..., undefined, ...)`), so an agentic
 * coder resolved relative paths — and executed goal commands — against the
 * launching repo, while `guardWorkspaceContainment` validated the DECLARED
 * workspace the child never actually ran in. Proven live: a killed run's
 * orphaned coder wrote claims/renders into the orchestrating repo.
 *
 * These tests drive the REAL seam (a fake `claude` CLI on a stubbed PATH,
 * real subprocess) and pin both halves of the fix [CLM-0195]:
 *  1. the spawned child's actual `process.cwd()` IS the run's workspaceDir;
 *  2. the containment check and the spawn share ONE directory — a workspace
 *     the containment refuses is refused BEFORE any child process starts.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AgenticRepositoryWorkspaceError } from '@kernloop/kernel';
import { OverlaySchema, type Overlay } from '../overlay.js';
import { buildInvokeForNode } from './index.js';

const overlay = (): Overlay => OverlaySchema.parse({ id: 'cwd-570-test' });

const tempDirs: string[] = [];

/** Create a tracked temp dir (under the REAL temp root, captured up front). */
function makeDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `kernloop-570-${label}-`));
  tempDirs.push(dir);
  return dir;
}

/** A fake `claude` CLI on `binDir` that reports the cwd it actually ran in. */
function writePwdReportingClaude(binDir: string): void {
  writeFileSync(
    join(binDir, 'claude'),
    '#!/bin/sh\ncat > /dev/null\nprintf \'{"type":"result","is_error":false,"result":"%s",' +
      '"total_cost_usd":0,"usage":{"input_tokens":1,"output_tokens":1}}\\n\' "$(pwd -P)"\n',
    { mode: 0o755 },
  );
}

/** Run `fn` with PATH pointing at exactly `binDir` (restored afterwards). */
async function withPath<T>(binDir: string, fn: () => Promise<T>): Promise<T> {
  const oldPath = process.env.PATH;
  process.env.PATH = binDir;
  try {
    return await fn();
  } finally {
    process.env.PATH = oldPath;
  }
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('buildInvokeForNode — workspace-pinned subprocess cwd (#570, CLM-0195)', () => {
  it('pins every CLI-adapter subprocess to the run workspace — the dir containment validated (#570)', async () => {
    const ws = realpathSync(makeDir('ws'));
    const binDir = makeDir('bin');
    writePwdReportingClaude(binDir);
    await withPath(binDir, async () => {
      const invokeFor = buildInvokeForNode(
        'claude',
        overlay(),
        { tokens: 0, usd: 0 },
        undefined,
        undefined,
        {},
        ws, // the run's declared workspaceDir, threaded by executeCanonicalLoop
      );
      // The coder node — the agentic child the #570 incident caught escaping.
      const result = await invokeFor('implement').invoke('write the files');
      expect(result.output).toBe(ws); // the child RAN in the workspace
      expect(result.output).not.toBe(realpathSync(process.cwd())); // not the launch dir
    });
  });

  it('refuses at the seam when the pinned workspace is a real git tree — check and spawn share one dir (#570)', async () => {
    // The divergence regression: before the fix the spawn cwd was undefined, so
    // the kernel containment choke point saw nothing to check while the child
    // ran in the orchestrator's repo. Now the SAME workspaceDir flows to both:
    // a workspace the containment refuses must abort BEFORE any spawn.
    const binDir = makeDir('refuse-bin');
    const marker = join(binDir, 'spawn-happened');
    writeFileSync(join(binDir, 'claude'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
    const repo = makeDir('refuse-repo');
    mkdirSync(join(repo, '.git'));
    // Disable the throwaway carve-out deterministically (unresolvable TMPDIR ⇒
    // containment fails closed), so the fixture git tree is refused on any host.
    const oldTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = '/nonexistent-kernloop-tmp-570';
    try {
      await withPath(binDir, async () => {
        const invokeFor = buildInvokeForNode(
          'claude',
          overlay(),
          { tokens: 0, usd: 0 },
          undefined,
          undefined,
          {},
          repo,
        );
        const error = await invokeFor('implement')
          .invoke('write the files')
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(error).toBeInstanceOf(AgenticRepositoryWorkspaceError);
        // The refused dir is exactly the dir the child would have spawned into.
        expect((error as AgenticRepositoryWorkspaceError).workspace).toBe(realpathSync(repo));
        expect(existsSync(marker)).toBe(false); // no child process ever started
      });
    } finally {
      if (oldTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = oldTmpdir;
    }
  });

  it('leaves the child in the launch cwd when NO workspace is given (pure-verb paths)', async () => {
    // Standalone verbs (gate/distill/forge) declare no workspace — their
    // one-shot completion keeps the operator's cwd, unchanged by #570.
    const binDir = makeDir('nows-bin');
    writePwdReportingClaude(binDir);
    await withPath(binDir, async () => {
      const invokeFor = buildInvokeForNode('claude', overlay(), { tokens: 0, usd: 0 });
      const result = await invokeFor('implement').invoke('p');
      expect(result.output).toBe(realpathSync(process.cwd()));
    });
  });
});
