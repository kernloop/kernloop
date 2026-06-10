/**
 * Section drafting: render each input group into a list of whole items, each
 * carrying its own Source (CLM-0030: every line provenance-tagged). Items
 * are the unit of budget truncation — the budget fitter drops whole items
 * from the end, never characters from the middle (sections are joined from
 * items, so no rendered line is ever chopped mid-sentence).
 */
import type { Source, TaskContract } from '@kernloop/contracts';
import { SECTION_PRIORITY, type BriefSources, type SectionName } from './inputs.js';

/** One renderable line/block of a section plus where it came from. */
export interface DraftItem {
  text: string;
  source: Source;
}

/** A section before budget fitting: name, drop priority, whole items. */
export interface SectionDraft {
  name: SectionName;
  priority: number;
  items: DraftItem[];
}

/** Render the `task` section from the TaskContract itself (spec §5.1). */
function taskItems(task: TaskContract): DraftItem[] {
  const source: Source = { ref: `task:${task.id}` };
  return [
    { text: `Goal: ${task.goal}`, source },
    ...task.constraints.map((c) => ({ text: `Constraint: ${c}`, source })),
    ...task.definitionOfDone.map((d) => ({ text: `Done: ${d.name} (${d.command})`, source })),
  ];
}

/** Render a semantic fact, carrying confidence when the caller supplied it. */
function factText(fact: string, confidence: number | undefined): string {
  return confidence === undefined ? fact : `${fact} (confidence: ${confidence})`;
}

/**
 * Build all non-empty section drafts in priority order (1 → 6). Input order
 * within each group is preserved — semantic facts arrive pre-ranked by the
 * memory faculty and are never re-ranked here. Pure data transformation:
 * output depends only on arguments (CLM-0029).
 */
export function buildDrafts(task: TaskContract, sources: BriefSources): SectionDraft[] {
  const drafts: SectionDraft[] = [
    { name: 'task', priority: SECTION_PRIORITY.task, items: taskItems(task) },
    {
      name: 'claims',
      priority: SECTION_PRIORITY.claims,
      items: (sources.claims ?? []).map((c) => ({
        text: `${c.id} [${c.status}]: ${c.statement}`,
        source: { ref: `claim:${c.id}` },
      })),
    },
    {
      name: 'semanticFacts',
      priority: SECTION_PRIORITY.semanticFacts,
      items: (sources.semanticFacts ?? []).map((f) => ({
        text: factText(f.fact, f.confidence),
        source: { ref: f.provenance },
      })),
    },
    {
      name: 'episodicSummaries',
      priority: SECTION_PRIORITY.episodicSummaries,
      items: (sources.episodicSummaries ?? []).map((e) => ({
        text: `${e.taskId}: ${e.summary}`,
        source: { ref: `trace:${e.traceRef}` },
      })),
    },
    {
      name: 'repoProbes',
      priority: SECTION_PRIORITY.repoProbes,
      items: (sources.repoProbes ?? []).map((p) => ({
        text: `${p.name}:\n${p.content}`,
        source: { ref: `probe:${p.source}` },
      })),
    },
    {
      name: 'skillsIndex',
      priority: SECTION_PRIORITY.skillsIndex,
      items: (sources.skillsIndex ?? []).map((s) => ({
        text: `${s.name}: ${s.oneLiner}`,
        source: { ref: `skill:${s.name}` },
      })),
    },
  ];
  return drafts.filter((d) => d.items.length > 0);
}
