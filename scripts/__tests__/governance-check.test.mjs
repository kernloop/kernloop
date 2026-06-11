import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkCharterCommands,
  checkCodeowners,
  checkStructure,
  checkSymlinks,
  main,
  runGovernanceCheck,
} from '../governance-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-gov-'));
  for (const dir of [
    'packages/contracts',
    'packages/kernel',
    'claims',
    'skills',
    'docs',
    '.github/workflows',
  ]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, 'AGENTS.md'),
    '# charter\n```\npnpm install\npnpm build\npnpm test\n```\n',
  );
  fs.writeFileSync(
    path.join(root, '.github/CODEOWNERS'),
    [
      '/packages/contracts/ @owner',
      '/packages/kernel/ @owner',
      '/claims/ @owner',
      '/AGENTS.md @owner',
    ].join('\n') + '\n',
  );
  for (const f of ['docs/kernloop-kernel-spec.md', 'LICENSE', 'NOTICE', 'BOOTSTRAP.md']) {
    fs.writeFileSync(path.join(root, f), 'x\n');
  }
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { build: 'x', test: 'x' } }),
  );
  fs.symlinkSync('AGENTS.md', path.join(root, 'CLAUDE.md'));
  fs.symlinkSync('AGENTS.md', path.join(root, 'GEMINI.md'));
  return root;
}

describe('governance:check on the real repository', () => {
  test('the actual repo passes all governance checks', () => {
    expect(runGovernanceCheck(repoRoot)).toEqual([]);
    expect(main(repoRoot)).toBe(0);
  });
});

describe('governance:check failure modes (drift proofs)', () => {
  test('a complete fixture repo passes', () => {
    expect(runGovernanceCheck(fixtureRepo())).toEqual([]);
  });

  test('missing protected path fails structure check', () => {
    const root = fixtureRepo();
    fs.rmSync(path.join(root, 'claims'), { recursive: true });
    expect(checkStructure(root)).toContain('required path missing: claims');
    expect(main(root)).toBe(1);
  });

  test('a package outside the spec §9 tree fails', () => {
    const root = fixtureRepo();
    fs.mkdirSync(path.join(root, 'packages/rogue-faculty'));
    expect(checkStructure(root)).toContain('packages/rogue-faculty is not in the spec §9 tree');
  });

  test('CLAUDE.md as a regular file (not symlink) fails', () => {
    const root = fixtureRepo();
    fs.rmSync(path.join(root, 'CLAUDE.md'));
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'divergent charter\n');
    expect(checkSymlinks(root)).toContain('CLAUDE.md must be a symlink to AGENTS.md (one charter)');
  });

  test('symlink pointing elsewhere fails', () => {
    const root = fixtureRepo();
    fs.rmSync(path.join(root, 'GEMINI.md'));
    fs.symlinkSync('README.md', path.join(root, 'GEMINI.md'));
    expect(checkSymlinks(root)).toContain('GEMINI.md points at README.md, expected AGENTS.md');
  });

  test('CODEOWNERS dropping a protected path fails', () => {
    const root = fixtureRepo();
    fs.writeFileSync(path.join(root, '.github/CODEOWNERS'), '/packages/contracts/ @owner\n');
    const errors = checkCodeowners(root);
    expect(errors).toContain('CODEOWNERS does not cover protected path /claims/ with an @owner');
    expect(errors).toContain('CODEOWNERS does not cover protected path /AGENTS.md with an @owner');
  });

  test('missing CODEOWNERS fails', () => {
    const root = fixtureRepo();
    fs.rmSync(path.join(root, '.github/CODEOWNERS'));
    expect(checkCodeowners(root)).toEqual(['.github/CODEOWNERS missing']);
  });

  test('charter documenting a nonexistent command fails (drift)', () => {
    const root = fixtureRepo();
    fs.appendFileSync(path.join(root, 'AGENTS.md'), 'pnpm imaginary:gate\n');
    expect(checkCharterCommands(root)).toContain(
      'AGENTS.md documents `pnpm imaginary:gate` but package.json has no such script',
    );
  });

  test('charter with no pnpm commands at all fails', () => {
    const root = fixtureRepo();
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# silent charter\n');
    expect(checkCharterCommands(root)).toContain(
      'AGENTS.md contains no `pnpm <command>` lines — charter/commands drift',
    );
  });

  test('matches a hyphenated command name in full (e.g. claims:verify-ran)', () => {
    const root = fixtureRepo();
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# charter\n```\npnpm claims:verify-ran\n```\n');
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { 'claims:verify-ran': 'x' } }),
    );
    // The whole hyphenated name must resolve — a regex that stopped at the
    // hyphen would look for "claims:verify" and wrongly report drift.
    expect(checkCharterCommands(root)).toEqual([]);
  });
});
