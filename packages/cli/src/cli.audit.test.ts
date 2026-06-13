/**
 * CLI-level `audit` exit-code behavior [#93]: `kernloop audit --op verify` must
 * FAIL CLOSED — exit 1 on a broken/tampered chain, not just report the verdict
 * as data with exit 0 — so `audit --op verify && …` can never treat tampering
 * as success. (The verdict shape itself is unit-tested in tools/audit.test.ts;
 * this proves the process exit code through the real dispatch.)
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli, type CliIo } from './cli.js';

const dirs: string[] = [];
function repoDir(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-audit-'));
  dirs.push(repo);
  return repo;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function capture(cwd: string): { io: CliIo; json: () => unknown } {
  const out: string[] = [];
  return {
    io: { out: (t) => out.push(t), err: () => {}, cwd },
    json: () => JSON.parse(out.join('\n')) as unknown,
  };
}

describe('kernloop audit --op verify — fail-closed exit code', () => {
  it('exits 0 on an honest chain, then exits 1 after a one-char tamper [#93]', async () => {
    const repo = repoDir();
    await runCli(['init'], capture(repo).io);
    await runCli(['remember', '--fact', 'f', '--provenance', 'AGENTS.md'], capture(repo).io);

    // Honest chain → exit 0, verdict ok.
    const ok = capture(repo);
    expect(await runCli(['audit', '--op', 'verify'], ok.io)).toBe(0);
    expect(ok.json()).toMatchObject({ result: { ok: true } });

    // Tamper one hex char of the LAST line's stored hash → deterministic
    // hash_mismatch (no prev-hash cascade); the command must now exit 1.
    const auditPath = path.join(repo, '.kernloop', 'audit.jsonl');
    const lines = readFileSync(auditPath, 'utf8').trimEnd().split('\n');
    const last = JSON.parse(lines.at(-1)!) as { hash: string };
    last.hash = (last.hash[0] === '0' ? '1' : '0') + last.hash.slice(1);
    lines[lines.length - 1] = JSON.stringify(last);
    writeFileSync(auditPath, lines.join('\n') + '\n', 'utf8');

    const broken = capture(repo);
    expect(await runCli(['audit', '--op', 'verify'], broken.io)).toBe(1);
    expect(broken.json()).toMatchObject({ result: { ok: false } });
  });
});
