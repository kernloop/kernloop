/**
 * The `kernloop metrics` subcommand (#125, [CLM-0110]) — its own module so the
 * CLI dispatcher stays under the LOC ceiling (#58). Emits the Prometheus
 * exposition text from {@link metricsExport} to stdout, or writes it to `--out`.
 * Read-only: assembles a kernloop over the overlay, reads, and closes.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createKernloop } from './kernel.js';
import { OVERLAY_DIR_NAME } from './overlay.js';
import { metricsExport } from './tools/metrics.js';
import type { CliIo } from './cli.js';

/** Parse `--dir`/`--out`, render metrics, and emit (stdout, or write to `--out`). */
export async function metricsCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { dir: { type: 'string' }, out: { type: 'string' } },
    allowPositionals: false,
  });
  const overlayDir = path.join(path.resolve(io.cwd, values.dir ?? '.'), OVERLAY_DIR_NAME);
  const kern = createKernloop({ overlayDir });
  try {
    const text = metricsExport(kern);
    if (values.out === undefined) {
      io.out(text);
    } else {
      writeFileSync(path.resolve(io.cwd, values.out), text);
      io.out(`wrote ${String(text.length)} bytes of Prometheus metrics to ${values.out}`);
    }
    return 0;
  } finally {
    kern.close();
  }
}
