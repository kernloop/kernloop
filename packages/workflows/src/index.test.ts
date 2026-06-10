import { describe, expect, it } from 'vitest';
import {
  CANONICAL_LOOP,
  CheckpointRecordSchema,
  EngineConfigSchema,
  InMemoryCheckpointStore,
  JsonlCheckpointStore,
  RunStateSchema,
  WorkflowError,
  createEngine,
  nodeByName,
  successor,
  workflowsManifest,
} from './index.js';

describe('public surface', () => {
  it('exports the graph, the engine factory, both checkpoint stores, the schemas, and the manifest', () => {
    expect(Object.isFrozen(CANONICAL_LOOP)).toBe(true);
    expect(typeof createEngine).toBe('function');
    expect(typeof nodeByName).toBe('function');
    expect(typeof successor).toBe('function');
    expect(new InMemoryCheckpointStore()).toBeDefined();
    expect(JsonlCheckpointStore).toBeDefined();
    expect(EngineConfigSchema.parse({}).K).toBe(3);
    expect(CheckpointRecordSchema).toBeDefined();
    expect(RunStateSchema).toBeDefined();
    expect(new WorkflowError('aborted', 'x').code).toBe('aborted');
    expect(workflowsManifest.name).toBe('@kernloop/workflows');
  });
});
