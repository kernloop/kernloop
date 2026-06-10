import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '@kernloop/contracts';
import { workflowsManifest } from './manifest.js';

describe('workflowsManifest', () => {
  it('parses against ManifestSchema with the workflow.canonical capability', () => {
    const parsed = ManifestSchema.parse(workflowsManifest);
    expect(parsed.name).toBe('@kernloop/workflows');
    expect(parsed.kind).toBe('strategy');
    expect(parsed.capabilities.map((c) => c.name)).toContain('workflow.canonical');
    expect(parsed.contracts.consumes).toEqual(['TaskContract']);
    expect(parsed.contracts.emits).toEqual(['Outcome']);
    expect(parsed.tier).toBe('suggest');
    expect(parsed.maturity).toBe('stable');
    expect(parsed.claims).toEqual(['CLM-0042', 'CLM-0043', 'CLM-0044', 'CLM-0045']);
  });
});
