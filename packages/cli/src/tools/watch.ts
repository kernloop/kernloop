/**
 * `kernloop watch` core (#126) — a READ-ONLY, human-readable tail of the audit
 * chain (`.kernloop/audit.jsonl`). A CLI-only view (NOT a kernel MCP tool): it
 * renders the canonical-loop progression a run records — routing, gate verdicts,
 * child re-iterations, the document step, and the terminal Outcome — as it lands.
 *
 * This module is the PURE core (lenient read + filter + per-event render +
 * snapshot); the follow loop and flag parsing live in watch-commands.ts. The
 * reader tolerates a partial final line (the file is being appended to live) and
 * any corrupt line by SKIPPING it — watch degrades, never throws.
 */
import fs from 'node:fs';

/** A minimal audit event as watch reads it (no strict zod — see module doc). */
export interface WatchEvent {
  readonly seq: number;
  readonly ts: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

/** The event types watch renders; everything else (bus/ladder/registry) is noise. */
const SIGNIFICANT: ReadonlySet<string> = new Set([
  'kernel.router.route',
  'cli.gate.verdict',
  'loop.child.iterate',
  'loop.document',
  'loop.spend',
  'loop.unlimited',
  'cli.job.created',
  'cli.job.finished',
  'cli.run.outcome',
]);

/** Narrow a parsed payload to a record. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Read the audit chain LENIENTLY (#126): a missing file is `[]`, and a partial
 * (mid-append) or corrupt line is skipped — watch follows a file being written,
 * so it must never throw on an incomplete tail. Returns events in file order.
 */
export function readAuditEvents(auditPath: string): WatchEvent[] {
  let raw: string;
  try {
    raw = fs.readFileSync(auditPath, 'utf8');
  } catch {
    return [];
  }
  const events: WatchEvent[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const e: unknown = JSON.parse(line);
      const r = asRecord(e);
      if (typeof r.seq === 'number' && typeof r.type === 'string') {
        events.push({
          seq: r.seq,
          ts: typeof r.ts === 'string' ? r.ts : '',
          type: r.type,
          payload: asRecord(r.payload),
        });
      }
    } catch {
      /* partial or corrupt line — skip (live append) */
    }
  }
  return events;
}

/** True when an event belongs to the watched id — its taskId/runId/childId/jobId
 * equals `id` or is a child of it (`id.N`). No filter (`undefined`) matches all. */
export function matchesFilter(event: WatchEvent, id: string | undefined): boolean {
  if (id === undefined) return true;
  for (const key of ['taskId', 'runId', 'childId', 'jobId'] as const) {
    const v = event.payload[key];
    if (typeof v === 'string' && (v === id || v.startsWith(`${id}.`))) return true;
  }
  return false;
}

/** A run/job reached a terminal state (its Outcome or job settlement landed). */
export function isTerminal(event: WatchEvent): boolean {
  return event.type === 'cli.run.outcome' || event.type === 'cli.job.finished';
}

/** A string payload field, or a fallback (never an invented value). */
function field(p: Record<string, unknown>, key: string, fallback = '?'): string {
  return typeof p[key] === 'string' ? (p[key] as string) : fallback;
}

/** Number payload field, or 0. */
function num(p: Record<string, unknown>, key: string): number {
  return typeof p[key] === 'number' ? (p[key] as number) : 0;
}

/** The human-readable body for one significant event (its `type`-specific line). */
function describe(event: WatchEvent): string {
  const p = event.payload;
  switch (event.type) {
    case 'kernel.router.route':
      return `route → ${field(p, 'outcome')}${p.explored === true ? ' (explored)' : ''}`;
    case 'cli.gate.verdict': {
      const voters = Array.isArray(p.voters) ? p.voters.filter((v) => typeof v === 'string') : [];
      const findings = num(p, 'findings');
      const extra = [
        findings > 0 ? `${String(findings)} finding(s)` : '',
        voters.length > 0 ? `voters: ${voters.join(', ')}` : '',
      ].filter(Boolean);
      return `gate ${field(p, 'gate')}: ${field(p, 'result')}${extra.length ? ` (${extra.join('; ')})` : ''}`;
    }
    case 'loop.child.iterate':
      return `↻ re-iterate child ${field(p, 'childId')} #${String(num(p, 'iteration'))}${typeof p.gate === 'string' ? ` after ${p.gate} gate` : ''}`;
    case 'loop.document':
      return `documented deliverable`;
    case 'loop.spend': {
      const child = field(p, 'childId', '');
      return `spend: ${field(p, 'node')}${child ? ` [${child}]` : ''} +$${num(p, 'nodeUsd').toFixed(4)} (${String(num(p, 'nodeTokens'))} tok) → $${num(p, 'cumulativeUsd').toFixed(4)} cumulative`;
    }
    case 'loop.unlimited':
      return `unlimited budget (no enforcement)`;
    case 'cli.job.created':
      return `job ${field(p, 'jobId')} created (${field(p, 'capability')})`;
    case 'cli.job.finished':
      return `job ${field(p, 'jobId')} ${field(p, 'status')}`;
    case 'cli.run.outcome': {
      const status = field(p, 'status');
      const mark = status === 'success' ? '✓' : status === 'failure' ? '✗' : '•';
      return `${mark} outcome: ${status} — ${field(p, 'capability')} (${String(num(p, 'wallClockMs'))}ms)`;
    }
    default:
      return event.type;
  }
}

/** Render ONE event as a readable `HH:MM:SS #seq  <description>` line, or
 * undefined when the event is not significant enough to show. */
export function renderEvent(event: WatchEvent): string | undefined {
  if (!SIGNIFICANT.has(event.type)) return undefined;
  const time = event.ts.length >= 19 ? event.ts.slice(11, 19) : '--:--:--';
  return `${time} #${String(event.seq)}  ${describe(event)}`;
}

/** A full snapshot of the matching significant events (the `--once` view) [CLM-0111]:
 * a header plus one rendered line per event, ending in a trailing newline. */
export function watchSnapshot(events: readonly WatchEvent[], id: string | undefined): string {
  const lines = events
    .filter((e) => matchesFilter(e, id))
    .map(renderEvent)
    .filter((l): l is string => l !== undefined);
  const header = `kernloop watch — ${String(lines.length)} event(s)${id === undefined ? '' : ` for ${id}`}`;
  return [header, ...lines].join('\n') + '\n';
}
