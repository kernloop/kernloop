/**
 * Hard-budget fitting with priority-ordered drop (spec §5.1, §8 item 1;
 * CLM-0030). Sections are admitted in priority order (1 first); each is
 * charged against the remaining total budget and its optional per-section
 * cap. When a section is over budget, WHOLE items are dropped from the end
 * — never mid-item chopping — and the drop is recorded honestly as a
 * bracketed notice line inside the section (provenance-tagged
 * `compiler:budget-drop`), whose tokens are themselves charged.
 *
 * Drop-ordering guarantee: when the TOTAL budget runs out, admission stops,
 * so fully-dropped-for-total-budget sections always form a suffix of the
 * priority order (8 before 7 before 6 …). A section excluded by its own
 * per-section cap does NOT starve lower-priority sections — that exclusion
 * is the caller's explicit choice, not budget exhaustion.
 */
import type { BriefSection, Source } from '@kernloop/contracts';
import { estimateTokens } from './tokens.js';
import type { DraftItem, SectionDraft } from './sections.js';
import type { SectionName } from './inputs.js';

/** Source ref attached to truncation-notice lines. */
export const DROP_NOTICE_REF = 'compiler:budget-drop';

function render(items: DraftItem[]): string {
  return items.map((i) => i.text).join('\n');
}

/** Honest in-section record of what budget fitting removed. */
function dropNotice(dropped: number, total: number): string {
  return `[budget: dropped ${dropped} of ${total} items]`;
}

/** Deduplicated provenance of the kept items, in first-occurrence order. */
function provenanceOf(kept: DraftItem[], truncated: boolean): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const item of kept) {
    if (!seen.has(item.source.ref)) {
      seen.add(item.source.ref);
      out.push({ ref: item.source.ref });
    }
  }
  if (truncated) out.push({ ref: DROP_NOTICE_REF });
  return out;
}

interface FittedSection {
  content: string;
  kept: DraftItem[];
  dropped: number;
}

/**
 * Fit items under `cap` by dropping whole items from the end. Returns null
 * when not even one item plus the truncation notice fits — the section is
 * then dropped entirely rather than misrepresented by a fragment.
 */
function fitItems(items: DraftItem[], cap: number): FittedSection | null {
  const full = render(items);
  if (estimateTokens(full) <= cap) return { content: full, kept: items, dropped: 0 };
  for (let keep = items.length - 1; keep >= 1; keep -= 1) {
    const kept = items.slice(0, keep);
    const content = `${render(kept)}\n${dropNotice(items.length - keep, items.length)}`;
    if (estimateTokens(content) <= cap) {
      return { content, kept, dropped: items.length - keep };
    }
  }
  return null;
}

/**
 * Assemble budget-fitted BriefSections from drafts (already in priority
 * order). Deterministic: pure arithmetic over the inputs (CLM-0029).
 */
export function fitToBudget(
  drafts: SectionDraft[],
  totalTokens: number,
  perSection: Partial<Record<SectionName, number>>,
): BriefSection[] {
  const sections: BriefSection[] = [];
  let remaining = totalTokens;
  for (const draft of drafts) {
    const sectionCap = perSection[draft.name] ?? Number.POSITIVE_INFINITY;
    const fitted = fitItems(draft.items, Math.min(sectionCap, remaining));
    if (fitted === null) {
      // Per-section cap was the binding constraint: skip just this section.
      if (sectionCap <= remaining) continue;
      // Total budget exhausted: every lower-priority section drops too.
      break;
    }
    const tokens = estimateTokens(fitted.content);
    remaining -= tokens;
    sections.push({
      name: draft.name,
      content: fitted.content,
      tokens,
      priority: draft.priority,
      provenance: provenanceOf(fitted.kept, fitted.dropped > 0),
    });
  }
  return sections;
}
