/**
 * The COMPACT PARSIMONY RULE [#417, EPIC #407 M4] — the one canonical,
 * agent-facing Prime-layer instruction that tells a coder to climb the
 * {@link PARSIMONY_LADDER restraint ladder}, respect the {@link CONTROL_FLOOR
 * control floor}, and emit the greppable {@link MARKER_TAG `kl:parsimony`}
 * marker. It is the SINGLE SOURCE OF TRUTH: both the implement/coder prompt
 * (`coderPrompt`, the Prime layer) and the per-harness copies (Claude / Codex /
 * Gemini / OpenCode) are DERIVED from this one const, so a CI drift gate fails
 * the moment a committed copy diverges from it.
 *
 * The text is kept CONSISTENT with the canonical machinery — the same rung
 * names, the same `kl:parsimony` marker grammar, and the same floor control ids
 * (AC-3 / SI-10 / AU-2) — by composing it from {@link PARSIMONY_LADDER},
 * {@link CONTROL_FLOOR}, and {@link MARKER_TAG} rather than re-typing the
 * vocabulary, so the rule cannot drift from the evaluator it describes.
 *
 * @module parsimony/rule
 */
import { PARSIMONY_LADDER } from './ladder.js';
import { CONTROL_FLOOR } from './floor.js';
import { MARKER_TAG } from './marker.js';

/** The ladder rungs as a `N <name> → <outcome>` line each — the restraint cascade,
 * read straight from {@link PARSIMONY_LADDER} so the rule names the real rungs. */
function ladderLines(): string {
  return PARSIMONY_LADDER.map((r) => `rung ${r.rung} ${r.name} → ${r.outcome}`).join('\n');
}

/** The floor entries as a `<name> (<ids|catalog>) when <trigger>` line each — the
 * non-waivable guards, read from {@link CONTROL_FLOOR} so the ids stay real. */
function floorLines(): string {
  return CONTROL_FLOOR.map((e) => {
    const handle = e.controlIds.length > 0 ? e.controlIds.join('/') : e.catalog;
    return `${e.name} (${handle}) when ${e.appliesWhen}`;
  }).join('\n');
}

/**
 * The one canonical compact parsimony rule text [#417]. Composed from the
 * canonical ladder / floor / marker so it can never name a rung, control id, or
 * marker grammar the evaluator does not — the single source the coder prompt and
 * every per-harness copy derive from.
 */
export const COMPACT_PARSIMONY_RULE = [
  '## Parsimony (restraint) rule',
  '',
  'Before you add code, climb the RESTRAINT LADDER and stop at the FIRST rung',
  'that holds — prefer reuse / stdlib / a native platform feature / an installed',
  'dependency / one line over writing something new:',
  '',
  '```',
  ladderLines(),
  '```',
  '',
  'Never invoke "keep it simple" / YAGNI to drop a CONTROL FLOOR guard. When the',
  'change crosses one of these boundaries the guard is NON-WAIVABLE — implement it',
  '(do not claim it is satisfied when the diff does not implement it):',
  '',
  '```',
  floorLines(),
  '```',
  '',
  `A guard that applies and is unmet is a FIRST-CLASS deferred finding (it names`,
  'the control at risk), never a silent omission.',
  '',
  `EMIT the greppable \`${MARKER_TAG}\` marker for each restraint decision so it is`,
  'auditable, e.g.:',
  '',
  '```',
  `${MARKER_TAG} rung=2 outcome=reuse_native floor=SI-10:pass,AU-2:pass defer=none receipt=<id>`,
  '```',
  '',
  'The `floor` field lists every guard that applied (control id or name : status),',
  '`defer` is `none` or the debt id, and `receipt` back-links the full receipt on',
  'the hash-chained audit log.',
].join('\n');

/** The per-harness instruction families the compact rule is rendered for. The
 * canonical rule text is identical across all four; only a thin header differs. */
export const PARSIMONY_HARNESSES = ['claude', 'codex', 'gemini', 'opencode'] as const;

/** One supported harness family ({@link PARSIMONY_HARNESSES}). */
export type ParsimonyHarness = (typeof PARSIMONY_HARNESSES)[number];

/** The human-facing name each harness header announces. */
const HARNESS_LABEL: Record<ParsimonyHarness, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
};

/**
 * Render the per-harness copy of the compact parsimony rule for `harness`: a
 * thin GENERATED header (naming the harness and that the body is generated, not
 * hand-edited) wrapped around the one canonical {@link COMPACT_PARSIMONY_RULE}.
 * Both the committed copy files and this function read the SAME rule const, so a
 * drift check that compares `renderHarnessCopy(h)` to the committed copy fails
 * the instant a copy is hand-edited away from the source. The output ends with a
 * trailing newline so a committed `.md` file is byte-identical to it.
 */
export function renderHarnessCopy(harness: ParsimonyHarness): string {
  const label = HARNESS_LABEL[harness];
  const header = [
    `# Parsimony restraint rule — ${label} copy`,
    '',
    `> GENERATED from \`COMPACT_PARSIMONY_RULE\` in \`@kernloop/parsimony\` by`,
    `> \`scripts/render-parsimony-rule.mjs\`. Do NOT edit by hand — the CI drift`,
    `> gate (\`parsimony:render -- --check\`) fails if this copy diverges from the`,
    `> single source. [CLM-0179]`,
    '',
  ].join('\n');
  return `${header}\n${COMPACT_PARSIMONY_RULE}\n`;
}

/**
 * Render the human-readable skill home (`SKILL.md`) for the compact parsimony
 * rule: a `When to use` framing wrapped around the one canonical
 * {@link COMPACT_PARSIMONY_RULE}. Generated from the SAME source as the
 * per-harness copies (and drift-checked the same way), so the skill home can
 * never drift from the rule the coder prompt embeds. Ends with a trailing
 * newline so the committed file is byte-identical to it.
 */
export function renderSkillDoc(): string {
  const header = [
    '# parsimony-restraint',
    '',
    'The compact parsimony (restraint) rule — the Prime-layer instruction that',
    'tells a coder to climb the restraint ladder, respect the control floor, and',
    `emit the greppable \`${MARKER_TAG}\` marker. [CLM-0179]`,
    '',
    '## When to use',
    '',
    'This rule is the single source of truth (`COMPACT_PARSIMONY_RULE` in',
    '`@kernloop/parsimony`). It is embedded automatically in the implement/coder',
    'prompt (`coderPrompt`) on every coder call, and is GENERATED into the',
    'per-harness copies under `copies/` by `scripts/render-parsimony-rule.mjs`',
    '(CI drift-gated via `parsimony:render -- --check`). Read it here as the',
    'human-facing home; do not hand-edit the generated copies. [CLM-0179]',
    '',
  ].join('\n');
  return `${header}\n${COMPACT_PARSIMONY_RULE}\n`;
}
