/**
 * Tests for the OTLP push exporter (#155): the same pre-aggregated metric
 * families the Prometheus path renders are recorded into an OpenTelemetry meter
 * and pushed through an IN-MEMORY exporter double, then asserted — counters keep
 * their total, gauges their value, and labels become OTLP attributes.
 */
import { describe, expect, it } from 'vitest';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { exportOtlp } from './metrics-otlp.js';
import type { FamilySpec } from './metrics.js';

describe('exportOtlp', () => {
  it('pushes counters/gauges with labels→attributes through the exporter', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const families: FamilySpec[] = [
      [
        'kernloop_runs_total',
        'Run outcomes.',
        'counter',
        [{ labels: { capability: 'gate.quality', status: 'success' }, value: 2 }],
      ],
      ['kernloop_audit_chain_length', 'Chain length.', 'gauge', [{ value: 7 }]],
    ];
    await exportOtlp(families, exporter);

    const all = exporter.getMetrics().flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics));
    const runs = all.find((m) => m.descriptor.name === 'kernloop_runs_total');
    expect(runs).toBeDefined();
    expect(runs?.dataPoints[0]?.value).toBe(2); // the counter total
    expect(runs?.dataPoints[0]?.attributes).toMatchObject({
      capability: 'gate.quality',
      status: 'success',
    });
    const len = all.find((m) => m.descriptor.name === 'kernloop_audit_chain_length');
    expect(len?.dataPoints[0]?.value).toBe(7); // the gauge value
    expect(runs?.descriptor.description).toBe('Run outcomes.');
  });

  it('exports nothing for empty families without throwing', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    await exportOtlp([], exporter);
    expect(exporter.getMetrics().flatMap((rm) => rm.scopeMetrics)).toEqual([]);
  });
});
