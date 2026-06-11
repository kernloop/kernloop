import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIPPED_TEMPLATES } from '@kernloop/faculty-workforce';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// CLM-0066: the research skill pack ships so the Researcher template's
// `research` skill reference resolves to a real, committed skill.
describe('the research skill pack ships', () => {
  test('the Researcher template references a research skill', () => {
    expect(SHIPPED_TEMPLATES.researcher.skills).toContain('research');
  });

  test('skills/research/SKILL.md exists and is non-empty', () => {
    const file = path.join(repoRoot, 'skills', 'research', 'SKILL.md');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8').trim().length).toBeGreaterThan(0);
  });
});
