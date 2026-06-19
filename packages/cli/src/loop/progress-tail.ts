/**
 * In-process audit tailer that forwards a run's SIGNIFICANT milestones (#336 P1,
 * [CLM-0148]). The canonical loop already appends every milestone to the audit
 * JSONL; this re-reads it on a short interval, filters to THIS run, and pushes
 * each rendered line to `onMessage`. It is the SAME content `kernloop watch`
 * renders — re-transported, not new telemetry. Best-effort by construction:
 * `readAuditEvents` is lenient (a missing file or partial mid-append line yields
 * no event, never a throw), so a progress read can never break the run it
 * observes. The MCP `run` tool turns each message into an MCP progress
 * notification when the host supplied a progressToken (see mcp.ts / run.ts).
 *
 * @module cli/loop/progress-tail
 */
import { matchesFilter, readAuditEvents, renderEvent } from '../tools/watch.js';

/** A running tail; call {@link ProgressTail.stop} to flush + stop polling. */
export interface ProgressTail {
  /** Read any remaining milestones once more, then stop polling. */
  stop: () => void;
}

/**
 * Start tailing `auditPath` (#336 P1, CLM-0148), forwarding each newly-appended
 * SIGNIFICANT event that belongs to `runId` (via {@link matchesFilter}) as a
 * rendered line — the same content `kernloop watch` shows. `seq`
 * is globally monotonic, so a high-water `lastSeq` dedupes across polls and
 * across concurrently-appending fan-out children (their events interleave in
 * file order, which is the order the user should see).
 */
export function startProgressTail(opts: {
  auditPath: string;
  runId: string;
  onMessage: (message: string) => void;
  intervalMs?: number;
}): ProgressTail {
  let lastSeq = 0;
  const drain = (): void => {
    for (const event of readAuditEvents(opts.auditPath)) {
      if (event.seq <= lastSeq) continue;
      lastSeq = event.seq;
      if (!matchesFilter(event, opts.runId)) continue;
      const line = renderEvent(event); // undefined for non-significant events
      if (line !== undefined) opts.onMessage(line);
    }
  };
  drain(); // immediate catch-up: forward whatever has already been appended
  const timer = setInterval(drain, opts.intervalMs ?? 300);
  // Never let the poller hold the process open on its own.
  if (typeof timer.unref === 'function') timer.unref();
  return {
    stop: (): void => {
      drain(); // final flush so the terminal outcome/spend is never missed
      clearInterval(timer);
    },
  };
}

/**
 * Start a {@link startProgressTail} only when `onMessage` is set (the MCP host
 * supplied a progressToken) — otherwise undefined, a no-op. Keeps the run-tool
 * call site to one line.
 */
export function tailIf(
  onMessage: ((message: string) => void) | undefined,
  auditPath: string,
  runId: string,
): ProgressTail | undefined {
  return onMessage === undefined ? undefined : startProgressTail({ auditPath, runId, onMessage });
}

/**
 * Stop `tail` (if any) when `result` settles — on BOTH the fulfilled and
 * rejected paths — without awaiting it, so the caller's promise keeps its
 * original timing and the run's own rejection still propagates through `result`.
 */
export function stopTailOnSettle(result: Promise<unknown>, tail: ProgressTail | undefined): void {
  if (tail !== undefined) {
    void result.then(
      () => tail.stop(),
      () => tail.stop(),
    );
  }
}
