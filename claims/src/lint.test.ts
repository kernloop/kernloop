/**
 * Capability-statement lint proofs: untagged sentences and unknown tags in
 * claims blocks fail; citing a non-verified (planned or experimental) claim
 * fails; the P0 absence policy (missing file OK; README without markers
 * FAILS; ARCHITECTURE.md without markers OK) holds.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { extractClaimBlocks, lintCapabilityDocs, type ClaimStatuses } from './lint.js';
import { runClaimsCheck } from './check.js';
import { githubSlug } from './resolve.js';
import { CAP_TEST_FILE, claimYaml, cleanupRepos, makeRepo } from './__fixtures__/fixture-repo.js';

afterAll(cleanupRepos);

const KNOWN: ClaimStatuses = new Map([['CLM-0001', 'verified']]);

function readme(body: string): string {
  return `# Fixture\n\n<!-- claims:begin -->\n${body}\n<!-- claims:end -->\n`;
}

function repoWithReadme(content: string): string {
  return makeRepo({
    'claims/registry/CLM-0001.yaml': claimYaml(),
    'src/cap.test.ts': CAP_TEST_FILE,
    'README.md': content,
  });
}

describe('lintCapabilityDocs', () => {
  it('passes a claims block where every sentence is tagged', () => {
    const root = repoWithReadme(
      readme('Contracts validate. [CLM-0001]\n- Drift is rejected [CLM-0001].'),
    );
    expect(lintCapabilityDocs(root, KNOWN)).toEqual([]);
  });

  it('fails an untagged sentence inside a claims block', () => {
    const root = repoWithReadme(
      readme('Contracts validate. [CLM-0001]\nThis sentence has no tag.'),
    );
    const errors = lintCapabilityDocs(root, KNOWN);
    expect(errors.join('\n')).toContain('untagged sentence in claims block');
  });

  it('fails a tag that references an unknown claim id', () => {
    const root = repoWithReadme(readme('Contracts validate. [CLM-9999]'));
    const errors = lintCapabilityDocs(root, KNOWN);
    expect(errors.join('\n')).toContain('[CLM-9999] does not reference an existing registry claim');
  });

  it('fails a tag that cites a planned claim (docs may only state verified capability)', () => {
    const statuses: ClaimStatuses = new Map([
      ['CLM-0001', 'verified'],
      ['CLM-0002', 'planned'],
    ]);
    const root = repoWithReadme(readme('A future capability. [CLM-0002]'));
    const errors = lintCapabilityDocs(root, statuses);
    expect(errors.join('\n')).toContain(
      'tag [CLM-0002] cites a "planned" claim — documentation may only state verified capability',
    );
  });

  it('fails a tag that cites an experimental claim', () => {
    const statuses: ClaimStatuses = new Map([['CLM-0003', 'experimental']]);
    const root = repoWithReadme(readme('An experimental capability. [CLM-0003]'));
    const errors = lintCapabilityDocs(root, statuses);
    expect(errors.join('\n')).toContain(
      'tag [CLM-0003] cites a "experimental" claim — documentation may only state verified capability',
    );
  });

  it('passes a tag that cites a verified claim', () => {
    const root = repoWithReadme(readme('A verified capability. [CLM-0001]'));
    expect(lintCapabilityDocs(root, KNOWN)).toEqual([]);
  });

  it('flags unknown tags even outside the claims block', () => {
    const root = repoWithReadme(
      `${readme('Contracts validate. [CLM-0001]')}\nStray ref [CLM-4242].\n`,
    );
    expect(lintCapabilityDocs(root, KNOWN).join('\n')).toContain('[CLM-4242]');
  });

  it('fails a README that exists without claims markers', () => {
    const root = repoWithReadme('# Fixture\n\nNo markers here.\n');
    expect(lintCapabilityDocs(root, KNOWN).join('\n')).toContain('has no <!-- claims:begin -->');
  });

  it('fails an unbalanced claims block', () => {
    const root = repoWithReadme('# Fixture\n\n<!-- claims:begin -->\nDangling.\n');
    expect(lintCapabilityDocs(root, KNOWN).join('\n')).toContain('without matching');
  });

  it('passes when README.md is absent (P0 policy)', () => {
    const root = makeRepo({
      'claims/registry/CLM-0001.yaml': claimYaml(),
      'src/cap.test.ts': CAP_TEST_FILE,
    });
    expect(lintCapabilityDocs(root, KNOWN)).toEqual([]);
    expect(runClaimsCheck({ repoRoot: root }).ok).toBe(true);
  });

  it('passes ARCHITECTURE.md without markers but lints its blocks when present', () => {
    const okRoot = makeRepo({
      'README.md': readme('Contracts validate. [CLM-0001]'),
      'ARCHITECTURE.md': '# Arch\n\nNo markers is fine here.\n',
    });
    expect(lintCapabilityDocs(okRoot, KNOWN)).toEqual([]);
    const badRoot = makeRepo({
      'README.md': readme('Contracts validate. [CLM-0001]'),
      'ARCHITECTURE.md': readme('Untagged architecture capability.'),
    });
    expect(lintCapabilityDocs(badRoot, KNOWN).join('\n')).toContain('ARCHITECTURE.md');
  });

  it('skips headings, comments, and code fences inside a claims block', () => {
    const root = repoWithReadme(
      readme(
        '## Capabilities\n<!-- a comment -->\n```\nuntagged code, not prose\n```\nContracts validate. [CLM-0001]',
      ),
    );
    expect(lintCapabilityDocs(root, KNOWN)).toEqual([]);
  });

  it('treats a line without terminal punctuation as one sentence needing a tag', () => {
    const root = repoWithReadme(readme('a trailing fragment without punctuation'));
    expect(lintCapabilityDocs(root, KNOWN).join('\n')).toContain('untagged sentence');
  });
});

describe('extractClaimBlocks', () => {
  it('extracts multiple blocks and flags an end without a begin', () => {
    const two = extractClaimBlocks(
      'x <!-- claims:begin -->A<!-- claims:end --> y <!-- claims:begin -->B<!-- claims:end -->',
      'README.md',
    );
    expect(two.blocks).toEqual(['A', 'B']);
    expect(two.errors).toEqual([]);
    const orphan = extractClaimBlocks('text <!-- claims:end -->', 'README.md');
    expect(orphan.errors.join('\n')).toContain('without matching');
  });
});

describe('githubSlug', () => {
  it('slugs headings the way GitHub does', () => {
    expect(githubSlug('Evidence & Anchors')).toBe('evidence--anchors');
    expect(githubSlug('`claims:check` — The Gate')).toBe('claimscheck--the-gate');
    expect(githubSlug('[Link](https://x.dev) **bold** _em_')).toBe('link-bold-em');
  });
});
