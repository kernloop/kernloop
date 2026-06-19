/**
 * The `kernloop metrics` subcommand (#125, [CLM-0110]) — its own module so the
 * CLI dispatcher stays under the LOC ceiling (#58). Default: emit the Prometheus
 * exposition text from {@link metricsExport} to stdout (or `--out <file>`).
 * `--otlp <endpoint>` instead PUSHES the same families over OTLP/HTTP (#155).
 * Read-only over the overlay: assemble a kernloop, read, push/print, close.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createProductionKernloop } from './kernel.js';
import { OVERLAY_DIR_NAME } from './overlay.js';
import { collectFamilies, metricsExport } from './tools/metrics.js';
import type { CliIo } from './cli.js';

/** Parse `--dir`/`--out`/`--otlp`, then push to OTLP or emit Prometheus text. */
export async function metricsCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string' },
      out: { type: 'string' },
      otlp: { type: 'string' },
    },
    allowPositionals: false,
  });
  const overlayDir = path.join(path.resolve(io.cwd, values.dir ?? '.'), OVERLAY_DIR_NAME);
  const kern = createProductionKernloop({ overlayDir });
  try {
    if (values.otlp !== undefined) {
      // Lazily load the OpenTelemetry SDK (#155) ONLY for the OTLP path — never
      // on the hot path of every other CLI command's startup.
      const [{ OTLPMetricExporter }, { exportOtlp }] = await Promise.all([
        import('@opentelemetry/exporter-metrics-otlp-http'),
        import('./tools/metrics-otlp.js'),
      ]);
      const families = collectFamilies(kern);
      await exportOtlp(families, new OTLPMetricExporter({ url: values.otlp }));
      io.out(`pushed ${String(families.length)} OTLP metric families to ${values.otlp}`);
      return 0;
    }
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
