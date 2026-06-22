import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderHarnessCopy, renderSkillDoc, PARSIMONY_HARNESSES } from '@kernloop/parsimony';

/**
 * Generates the per-harness copies of the one canonical COMPACT_PARSIMONY_RULE
 * [#417, EPIC #407 M4] from the SINGLE SOURCE in `@kernloop/parsimony`. Each
 * `skills/parsimony-restraint/copies/{claude,codex,gemini,opencode}.md` file is
 * written by `renderHarnessCopy(harness)`, so the committed copies cannot be
 * hand-edited away from the source: `--check` mode EXITS NONZERO on any drift
 * (mirroring `render-claims.mjs --check` and the `docs:render --check` pattern),
 * which is the CI gate behind issue #417's "CI drift check fails if copies
 * diverge".
 */

/** The committed copy file path for one harness, under the skill's copies/ dir. */
export function harnessCopyPath(repoRoot, harness) {
  return path.join(repoRoot, 'skills', 'parsimony-restraint', 'copies', `${harness}.md`);
}

/** The skill home (`SKILL.md`) path — the human-readable rule home. */
export function skillDocPath(repoRoot) {
  return path.join(repoRoot, 'skills', 'parsimony-restraint', 'SKILL.md');
}

/** The {harness, file, want} render plan: the human-readable skill home plus one
 * generated copy per supported harness, all derived from the single rule source. */
export function renderPlan(repoRoot) {
  const harnessCopies = PARSIMONY_HARNESSES.map((harness) => ({
    harness,
    file: harnessCopyPath(repoRoot, harness),
    want: renderHarnessCopy(harness),
  }));
  return [
    { harness: 'skill', file: skillDocPath(repoRoot), want: renderSkillDoc() },
    ...harnessCopies,
  ];
}

/** The plan entries whose committed file is missing or not byte-identical to the
 * rendered source — the drift set (empty when every copy is current). */
export function driftedCopies(plan) {
  return plan.filter((p) => !fs.existsSync(p.file) || fs.readFileSync(p.file, 'utf8') !== p.want);
}

/**
 * Drift-check (`check`) or write the per-harness copies. In check mode a
 * non-empty drift set returns 1 (the CI gate); otherwise every copy is written
 * (creating the copies/ dir as needed) and 0 is returned.
 */
export function emit(check, plan) {
  if (check) {
    const drift = driftedCopies(plan);
    if (drift.length > 0) {
      console.error(
        `render-parsimony-rule ✗ harness copies stale: ${drift
          .map((d) => d.harness)
          .join(', ')} — \`pnpm parsimony:render\``,
      );
      return 1;
    }
    console.log(`render-parsimony-rule ✓ ${plan.length} harness copies current`);
    return 0;
  }
  for (const p of plan) {
    fs.mkdirSync(path.dirname(p.file), { recursive: true });
    fs.writeFileSync(p.file, p.want);
  }
  console.log(`render-parsimony-rule ✓ wrote ${plan.length} harness copies`);
  return 0;
}

/** Build the plan and emit (check or write). The repo-root-relative entrypoint. */
export function main(repoRoot, check) {
  return emit(check, renderPlan(repoRoot));
}

/* v8 ignore start -- CLI entry */
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(main(repoRoot, process.argv.includes('--check')));
}
/* v8 ignore stop */
