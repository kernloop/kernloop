/**
 * EventBus suite (spec §3.1): contract-boundary rejection [CLM-0014],
 * bounded-queue backpressure [CLM-0018], replay hook, and audit-event
 * assertions — the JSONL the store writes is read back and the chain
 * verified.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TaskContract, Verdict } from '@kernloop/contracts';
import { createAuditStore, verifyChain, type AuditStore } from '../audit/index.js';
import type { AuditEnvelope } from '../audit/index.js';
import { DEFAULT_QUEUE_CAPACITY, EventBus, EventBusError, messageIdOf } from './event-bus.js';

let dir: string;
let store: AuditStore;
let bus: EventBus;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-bus-'));
  store = createAuditStore(join(dir, 'audit.jsonl'), {
    clock: () => new Date('2026-06-09T00:00:00.000Z'),
  });
  bus = new EventBus(store);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function taskContract(id: string): TaskContract {
  return {
    id,
    goal: 'test goal',
    constraints: [],
    budget: { tokens: 1000, usd: 1, wallClockMin: 5 },
    evidence: [],
    definitionOfDone: [],
    authorityCeiling: 'suggest',
    overlay: 'test-overlay',
  };
}

function verdict(taskId: string): Verdict {
  return {
    taskId,
    gate: 'quality',
    result: 'approve',
    confidence: 0.9,
    findings: [],
    cost: { tokens: 10, usd: 0.01 },
  };
}

function auditEvents(): AuditEnvelope[] {
  let text = '';
  try {
    text = readFileSync(store.filePath, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AuditEnvelope);
}

/** A handler whose completion the test controls, plus its release valve. */
function gatedHandler(): { handler: () => Promise<void>; release: () => void; calls: number[] } {
  const gates: Array<() => void> = [];
  const calls: number[] = [];
  return {
    handler: () => {
      calls.push(calls.length + 1);
      return new Promise<void>((resolve) => gates.push(resolve));
    },
    release: () => gates.shift()?.(),
    calls,
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('publish boundary [CLM-0014]', () => {
  it('delivers a valid contract message to a subscriber', async () => {
    const seen: TaskContract[] = [];
    bus.subscribe('TaskContract', (m) => {
      seen.push(m);
    });
    await bus.publish('TaskContract', taskContract('t-1'));
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.id).toBe('t-1');
  });

  it('rejects publishing an unknown contract name with a typed error', async () => {
    const publishUnknown = bus.publish.bind(bus) as (n: string, m: unknown) => Promise<void>;
    await expect(publishUnknown('SecretSixth', { anything: true })).rejects.toMatchObject({
      name: 'EventBusError',
      code: 'unknown_contract',
    });
  });

  it('rejects a schema-invalid message at the publish boundary with a typed error', async () => {
    const malformed = { ...taskContract('t-bad'), budget: { tokens: -1 } };
    await expect(
      bus.publish('TaskContract', malformed as unknown as TaskContract),
    ).rejects.toMatchObject({ name: 'EventBusError', code: 'invalid_message' });
    expect(auditEvents()).toHaveLength(0);
  });

  it('rejects subscribing to an unknown contract name with a typed error', () => {
    const subscribeUnknown = bus.subscribe.bind(bus) as (n: string, h: () => void) => () => void;
    expect(() => subscribeUnknown('SecretSixth', () => undefined)).toThrowError(EventBusError);
  });

  it('rejects a non-positive queueCapacity with a typed error', () => {
    expect(() => bus.subscribe('Verdict', () => undefined, { queueCapacity: 0 })).toThrowError(
      /positive integer/,
    );
  });
});

describe('audit events', () => {
  it('every publish appends an audit event with contract name and message id, and the chain verifies', async () => {
    await bus.publish('TaskContract', taskContract('t-1'));
    await bus.publish('Verdict', verdict('t-1'));
    const events = auditEvents();
    expect(events.map((e) => e.type)).toEqual(['kernel.bus.publish', 'kernel.bus.publish']);
    expect(events[0]?.payload).toEqual({ contract: 'TaskContract', messageId: 't-1' });
    expect(events[1]?.payload).toEqual({ contract: 'Verdict', messageId: 't-1' });
    expect(verifyChain(store)).toEqual({ ok: true, length: 2 });
  });

  it('audit payload carries id fields only, never the message payload', async () => {
    const tc = taskContract('t-goal-check');
    await bus.publish('TaskContract', tc);
    const [event] = auditEvents();
    expect(JSON.stringify(event?.payload)).not.toContain(tc.goal);
  });

  it('a throwing handler appends a handler_error audit event and the queue keeps draining', async () => {
    const seen: string[] = [];
    bus.subscribe('TaskContract', (m) => {
      if (m.id === 't-boom') throw new Error('handler exploded');
      seen.push(m.id);
    });
    await bus.publish('TaskContract', taskContract('t-boom'));
    await bus.publish('TaskContract', taskContract('t-ok'));
    await settle();
    expect(seen).toEqual(['t-ok']);
    const errorEvents = auditEvents().filter((e) => e.type === 'kernel.bus.handler_error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]?.payload).toMatchObject({
      contract: 'TaskContract',
      messageId: 't-boom',
      error: 'handler exploded',
    });
    expect(verifyChain(store).ok).toBe(true);
  });
});

describe('backpressure [CLM-0018]', () => {
  it('applies backpressure when a subscriber queue is full instead of dropping events', async () => {
    const { handler, release, calls } = gatedHandler();
    bus.subscribe('TaskContract', handler, { queueCapacity: 1 });
    await bus.publish('TaskContract', taskContract('t-1'));
    let secondEnqueued = false;
    const second = bus.publish('TaskContract', taskContract('t-2')).then(() => {
      secondEnqueued = true;
    });
    await settle();
    expect(secondEnqueued).toBe(false); // queue full: publish awaits drain
    release(); // first handler completes, slot frees
    await second;
    expect(secondEnqueued).toBe(true);
    release();
    await settle();
    expect(calls).toHaveLength(2); // nothing dropped
  });

  it('delivers every message in publish order under sustained backpressure', async () => {
    const seen: string[] = [];
    const gates: Array<() => void> = [];
    bus.subscribe(
      'TaskContract',
      (m) =>
        new Promise<void>((resolve) => {
          seen.push(m.id);
          gates.push(resolve);
        }),
      { queueCapacity: 2 },
    );
    const ids = ['t-1', 't-2', 't-3', 't-4', 't-5'];
    const publishes = Promise.all(ids.map((id) => bus.publish('TaskContract', taskContract(id))));
    for (let i = 0; i < ids.length; i++) {
      await settle();
      gates.shift()?.();
    }
    await publishes;
    await settle();
    expect(seen).toEqual(ids);
  });

  it('unsubscribing releases a publisher blocked on that subscriber', async () => {
    const { handler } = gatedHandler();
    const unsubscribe = bus.subscribe('TaskContract', handler, { queueCapacity: 1 });
    await bus.publish('TaskContract', taskContract('t-1'));
    const blocked = bus.publish('TaskContract', taskContract('t-2'));
    await settle();
    unsubscribe();
    await expect(blocked).resolves.toBeUndefined();
  });

  it('uses DEFAULT_QUEUE_CAPACITY when no capacity is given', async () => {
    const { handler, calls } = gatedHandler();
    bus.subscribe('TaskContract', handler);
    for (let i = 0; i < DEFAULT_QUEUE_CAPACITY; i++) {
      await bus.publish('TaskContract', taskContract(`t-${i}`));
    }
    await settle();
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('replay hook', () => {
  it('feeds recorded events to a late subscriber via replayFrom', async () => {
    const recorded = [taskContract('t-old-1'), taskContract('t-old-2')];
    const seen: string[] = [];
    bus.subscribe(
      'TaskContract',
      (m) => {
        seen.push(m.id);
      },
      { replayFrom: recorded },
    );
    await bus.publish('TaskContract', taskContract('t-new'));
    await settle();
    expect(seen).toEqual(['t-old-1', 't-old-2', 't-new']);
    const replayEvents = auditEvents().filter((e) => e.type === 'kernel.bus.replay');
    expect(replayEvents).toHaveLength(1);
    expect(replayEvents[0]?.payload).toEqual({
      contract: 'TaskContract',
      messageIds: ['t-old-1', 't-old-2'],
    });
  });

  it('rejects a replay batch larger than the queue capacity with a typed error', () => {
    const recorded = [taskContract('a'), taskContract('b'), taskContract('c')];
    expect(() =>
      bus.subscribe('TaskContract', () => undefined, { replayFrom: recorded, queueCapacity: 2 }),
    ).toThrowError(expect.objectContaining({ code: 'replay_overflow' }) as Error);
  });

  it('rejects schema-invalid replay events with a typed error', () => {
    const invalid = [{ id: 't-x' }] as unknown as TaskContract[];
    expect(() =>
      bus.subscribe('TaskContract', () => undefined, { replayFrom: invalid }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_message' }) as Error);
  });
});

describe('messageIdOf', () => {
  it('identifies each contract by its id fields', () => {
    expect(messageIdOf('TaskContract', taskContract('t-1'))).toBe('t-1');
    expect(messageIdOf('Verdict', verdict('t-2'))).toBe('t-2');
    expect(
      messageIdOf('Manifest', {
        name: 'faculty-memory',
        version: '1.0.0',
        kind: 'faculty',
        capabilities: [],
        contracts: { consumes: [], emits: [] },
        cost: { tokens: 0, usd: 0, latencyMs: 0 },
        tier: 'observe',
        claims: [],
        maturity: 'experimental',
      }),
    ).toBe('faculty-memory@1.0.0');
  });
});

describe('subscription lifecycle', () => {
  it('an unsubscribed handler receives no further messages', async () => {
    const seen: string[] = [];
    const unsubscribe = bus.subscribe('TaskContract', (m) => {
      seen.push(m.id);
    });
    await bus.publish('TaskContract', taskContract('t-1'));
    await settle();
    unsubscribe();
    await bus.publish('TaskContract', taskContract('t-2'));
    await settle();
    expect(seen).toEqual(['t-1']);
  });

  it('publish with no subscribers still appends the audit event', async () => {
    await bus.publish('Verdict', verdict('t-quiet'));
    expect(auditEvents().map((e) => e.type)).toEqual(['kernel.bus.publish']);
  });
});
