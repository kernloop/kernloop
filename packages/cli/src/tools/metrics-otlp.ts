/**
 * OTLP push exporter for `kernloop metrics --otlp <endpoint>` (#155, [CLM-0110]).
 * The Prometheus exposition (scrape model) stays the dependency-free default;
 * this opt-in path PUSHES the same pre-aggregated metric families over OTLP via
 * the OpenTelemetry SDK (the approved runtime dep). Counters carry their total
 * (`add`), gauges their value (`record`), and Prometheus labels become OTLP
 * attributes — one-shot: build a meter, record, force-flush, shut down.
 */
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import type { FamilySpec } from './metrics.js';

/** A practically-infinite interval: the reader never AUTO-exports; we drive a
 * single export with `forceFlush`. */
const NO_AUTO_EXPORT_MS = 2_147_483_647;

/**
 * Record `families` into an OpenTelemetry meter and push them once through
 * `exporter` (an OTLP/HTTP exporter in the CLI, an in-memory double in tests).
 * Counters add their total; gauges record their value; labels → attributes.
 */
export async function exportOtlp(
  families: readonly FamilySpec[],
  exporter: PushMetricExporter,
): Promise<void> {
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: NO_AUTO_EXPORT_MS,
  });
  const provider = new MeterProvider({ readers: [reader] });
  const meter = provider.getMeter('kernloop');
  for (const [name, help, type, samples] of families) {
    if (type === 'counter') {
      const counter = meter.createCounter(name, { description: help });
      for (const s of samples) counter.add(s.value, s.labels);
    } else {
      const gauge = meter.createGauge(name, { description: help });
      for (const s of samples) gauge.record(s.value, s.labels);
    }
  }
  await provider.forceFlush();
  await provider.shutdown();
}
