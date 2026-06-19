/**
 * The `kernloop watch` subcommand (#126, [CLM-0111]) — its own module so the CLI
 * dispatcher stays under the LOC ceiling (#58). FOLLOWS the audit chain and
 * renders the live run (routing → gates → re-iterations → Outcome). Read-only:
 * it only reads `.kernloop/audit.jsonl`, never a kernel/model/gh surface.
 *
 * `--once` prints a snapshot and exits (the testable core). The default FOLLOWS:
 * it prints events as they land and — when `--task-id` is given — exits once that
 * run reaches a terminal Outcome; a `--timeout-ms` always bounds the wait.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { OVERLAY_DIR_NAME } from './overlay.js';
import {
  isTerminal,
  matchesFilter,
  readAuditEvents,
  renderEvent,
  watchSnapshot,
} from './tools/watch.js';
import type { CliIo } from './cli.js';

/** Parse a string flag to a bounded integer, falling back to `def` when unset
 * or unparseable (the poll cadence / wait ceiling must always be sane). */
function boundedInt(value: string | undefined, def: number, min: number, max: number): number {
  const n = value === undefined ? def : Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
}

/** Sleep `ms` (the follow-loop poll interval); the real CLI process owns it. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `kernloop watch [--task-id T] [--once] [--verbose|--explain] [--interval-ms N]
 * [--timeout-ms N]`. `--once --verbose` (alias `--explain`) replays a finished
 * run's full audit trail incl. the per-node lifecycle (#336 D). */
export async function watchCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      'task-id': { type: 'string' },
      once: { type: 'boolean' },
      verbose: { type: 'boolean' },
      explain: { type: 'boolean' }, // alias of --verbose (post-hoc "explain" replay)
      'interval-ms': { type: 'string' },
      'timeout-ms': { type: 'string' },
    },
    allowPositionals: false,
  });
  const overlayDir = path.join(path.resolve(io.cwd, values.dir ?? '.'), OVERLAY_DIR_NAME);
  const auditPath = path.join(overlayDir, 'audit.jsonl');
  const id = values['task-id'];
  // Post-hoc replay (#336 D): --once --verbose (alias --explain) adds node lifecycle.
  const verbose = values.verbose === true || values.explain === true;

  if (values.once === true) {
    io.out(watchSnapshot(readAuditEvents(auditPath), id, { verbose }));
    return 0;
  }

  const intervalMs = boundedInt(values['interval-ms'], 700, 50, 60_000);
  const timeoutMs = boundedInt(values['timeout-ms'], 3_600_000, 10, 24 * 3_600_000);
  io.out(
    `kernloop watch${id === undefined ? '' : ` ${id}`} — following ${auditPath} (Ctrl-C to stop)`,
  );

  let lastSeq = 0;
  const start = Date.now();
  for (;;) {
    for (const event of readAuditEvents(auditPath)) {
      if (event.seq <= lastSeq) continue;
      lastSeq = event.seq;
      if (!matchesFilter(event, id)) continue;
      const line = renderEvent(event);
      if (line !== undefined) io.out(line);
      // With a task filter, the watched run ending is the natural stop point.
      if (id !== undefined && isTerminal(event)) return 0;
    }
    if (Date.now() - start >= timeoutMs) {
      io.out('kernloop watch — timed out');
      return 0;
    }
    await sleep(intervalMs);
  }
}
