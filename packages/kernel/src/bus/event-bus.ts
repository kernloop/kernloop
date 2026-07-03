/**
 * Kernel EventBus (spec §3.1): typed pub/sub carrying the five frozen
 * contracts — and nothing else. Unknown contract names and schema-invalid
 * messages are rejected at the publish boundary with a typed error
 * [CLM-0014].
 *
 * Delivery + backpressure semantics [CLM-0018]:
 *  - Each subscriber owns a bounded FIFO queue (`queueCapacity`, default
 *    {@link DEFAULT_QUEUE_CAPACITY}). Handlers drain their queue one message
 *    at a time, in publish order, awaiting async handlers.
 *  - `publish` resolves once the message is ENQUEUED to every current
 *    subscriber of the contract — not once handlers finish. When a
 *    subscriber's queue is full, `publish` awaits a free slot (backpressure);
 *    a message is never silently dropped.
 *  - Unsubscribing releases any publishers blocked on that subscriber's full
 *    queue; the in-flight message is simply not delivered to the removed
 *    subscriber (it chose to leave).
 *  - A handler that throws does not poison the queue: the error is recorded
 *    as a `kernel.bus.handler_error` audit event and draining continues —
 *    failures are audited, never silent (constitutional rule 7).
 *
 * Replay hook: a late subscriber may attach with `{ replayFrom: events }`;
 * the recorded events are schema-validated and enqueued ahead of any new
 * traffic. The replay batch must fit within `queueCapacity` (typed
 * `replay_overflow` error otherwise) — replaying more history than the
 * subscriber is willing to buffer is a caller bug, not a bus concern.
 *
 * Audit: every publish (and replay attachment) appends an audit event
 * carrying the contract name and the message's id fields only — never the
 * full payload. The chain is for governance (who sent what, when, in what
 * order); the memory faculty owns durable state (spec §3.1: "persistence
 * beyond audit" is explicitly NOT the bus's job).
 *
 * The bus holds no intelligence: it validates, queues, delivers, and
 * records (constitutional rule 4).
 *
 * @module kernel/bus
 */

import type { z } from 'zod';
import { KNOWN_CONTRACTS, type ContractRef } from '@kernloop/contracts';
import { appendEvent, type AuditStore } from '../audit/index.js';

/** Name of one of the frozen five — the only message types the bus carries. */
export type ContractName = ContractRef;

/** The validated message type carried under a given contract name. */
export type ContractMessage<N extends ContractName> = z.infer<(typeof KNOWN_CONTRACTS)[N]>;

/** Union of all five contract message types. */
export type AnyContractMessage = ContractMessage<ContractName>;

/** Default per-subscriber queue capacity when none is given. */
export const DEFAULT_QUEUE_CAPACITY = 16;

/** Why the bus rejected an operation. */
export type EventBusErrorCode =
  'unknown_contract' | 'invalid_message' | 'invalid_capacity' | 'replay_overflow';

/** Typed rejection at the bus boundary [CLM-0014]. */
export class EventBusError extends Error {
  readonly code: EventBusErrorCode;
  constructor(code: EventBusErrorCode, message: string) {
    super(message);
    this.name = 'EventBusError';
    this.code = code;
  }
}

/** Handler invoked with each validated message, in publish order. */
export type ContractHandler<N extends ContractName> = (
  message: ContractMessage<N>,
) => void | Promise<void>;

/** Options accepted by {@link EventBus.subscribe}. */
export interface SubscribeOptions<N extends ContractName> {
  /** Bounded queue size for this subscriber (default {@link DEFAULT_QUEUE_CAPACITY}). */
  queueCapacity?: number;
  /** Recorded events to deliver to this late subscriber before new traffic. */
  replayFrom?: ContractMessage<N>[];
}

/** Internal per-subscriber state. Messages are validated before enqueue. */
interface SubscriberSlot {
  readonly contract: ContractName;
  readonly handler: (message: AnyContractMessage) => void | Promise<void>;
  readonly capacity: number;
  readonly queue: AnyContractMessage[];
  /** Publishers awaiting a free slot, woken one per dequeue, FIFO. */
  readonly waiters: Array<() => void>;
  pumping: boolean;
  closed: boolean;
}

/**
 * The id fields of a message — what the audit chain records instead of the
 * payload. Manifests are identified `name@version`; TaskContracts by `id`;
 * Brief/Verdict/Outcome by `taskId`.
 */
export function messageIdOf(contract: ContractName, message: AnyContractMessage): string {
  if (contract === 'Manifest') {
    const m = message as ContractMessage<'Manifest'>;
    return `${m.name}@${m.version}`;
  }
  if (contract === 'TaskContract') {
    return (message as ContractMessage<'TaskContract'>).id;
  }
  return (message as ContractMessage<'Brief' | 'Verdict' | 'Outcome'>).taskId;
}

/** Resolve and apply the schema for `contract`, throwing typed errors. */
function validateMessage(contract: string, message: unknown): AnyContractMessage {
  const schema = (KNOWN_CONTRACTS as Record<string, z.ZodType<AnyContractMessage> | undefined>)[
    contract
  ];
  if (schema === undefined) {
    throw new EventBusError(
      'unknown_contract',
      `unknown contract "${contract}" — the bus carries only the frozen five`,
    );
  }
  const result = schema.safeParse(message);
  if (!result.success) {
    throw new EventBusError(
      'invalid_message',
      `message rejected at the ${contract} boundary: ${result.error.message}`,
    );
  }
  return result.data;
}

/** Typed pub/sub for the frozen five. See module docs for full semantics. */
export class EventBus {
  private readonly store: AuditStore;
  private readonly subscribers = new Map<ContractName, Set<SubscriberSlot>>();

  /** @param store - audit store every publish/replay/handler-error is appended to */
  constructor(store: AuditStore) {
    this.store = store;
  }

  /**
   * Validate and deliver one message [CLM-0014]. Appends a
   * `kernel.bus.publish` audit event (contract + message id, no payload),
   * then enqueues to every subscriber, awaiting drain on full queues
   * [CLM-0018]. Resolves when enqueued everywhere; rejects with
   * {@link EventBusError} on unknown contract or invalid message.
   */
  async publish<N extends ContractName>(contract: N, message: ContractMessage<N>): Promise<void> {
    const validated = validateMessage(contract, message);
    appendEvent(this.store, {
      type: 'kernel.bus.publish',
      payload: { contract, messageId: messageIdOf(contract, validated) },
    });
    const slots = this.subscribers.get(contract);
    if (slots === undefined) return;
    for (const slot of [...slots]) {
      await this.enqueue(slot, validated);
    }
  }

  /**
   * Attach a subscriber with a bounded queue; returns an unsubscribe
   * function. `replayFrom` events are validated and enqueued immediately
   * (audited as one `kernel.bus.replay` event); the batch must fit within
   * `queueCapacity`.
   */
  subscribe<N extends ContractName>(
    contract: N,
    handler: ContractHandler<N>,
    options?: SubscribeOptions<N>,
  ): () => void {
    const capacity = options?.queueCapacity ?? DEFAULT_QUEUE_CAPACITY;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new EventBusError('invalid_capacity', `queueCapacity must be a positive integer`);
    }
    const replay = this.validateReplay(contract, options?.replayFrom ?? [], capacity);
    const slot: SubscriberSlot = {
      contract,
      handler: handler as (message: AnyContractMessage) => void | Promise<void>,
      capacity,
      queue: [],
      waiters: [],
      pumping: false,
      closed: false,
    };
    const slots = this.subscribers.get(contract) ?? new Set();
    slots.add(slot);
    this.subscribers.set(contract, slots);
    if (replay.length > 0) {
      appendEvent(this.store, {
        type: 'kernel.bus.replay',
        payload: { contract, messageIds: replay.map((m) => messageIdOf(contract, m)) },
      });
      slot.queue.push(...replay);
      void this.pump(slot);
    }
    return () => this.unsubscribe(slot);
  }

  /** Validate a replay batch: known contract, fits capacity, every event valid. */
  private validateReplay(
    contract: string,
    events: unknown[],
    capacity: number,
  ): AnyContractMessage[] {
    if (!(contract in KNOWN_CONTRACTS)) {
      throw new EventBusError(
        'unknown_contract',
        `unknown contract "${contract}" — the bus carries only the frozen five`,
      );
    }
    if (events.length > capacity) {
      throw new EventBusError(
        'replay_overflow',
        `replayFrom has ${events.length} events but queueCapacity is ${capacity}`,
      );
    }
    return events.map((event) => validateMessage(contract, event));
  }

  /** Push to the slot's queue, awaiting a free slot while full (backpressure). */
  private async enqueue(slot: SubscriberSlot, message: AnyContractMessage): Promise<void> {
    while (slot.queue.length >= slot.capacity) {
      if (slot.closed) return;
      await new Promise<void>((resolve) => slot.waiters.push(resolve));
    }
    if (slot.closed) return;
    slot.queue.push(message);
    void this.pump(slot);
  }

  /** Drain the slot's queue serially; one pump runs per slot at a time. */
  private async pump(slot: SubscriberSlot): Promise<void> {
    if (slot.pumping) return;
    slot.pumping = true;
    while (slot.queue.length > 0 && !slot.closed) {
      const message = slot.queue[0] as AnyContractMessage;
      try {
        await slot.handler(message);
      } catch (error) {
        appendEvent(this.store, {
          type: 'kernel.bus.handler_error',
          payload: {
            contract: slot.contract,
            messageId: messageIdOf(slot.contract, message),
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      slot.queue.shift();
      slot.waiters.shift()?.();
    }
    slot.pumping = false;
  }

  /** Detach a slot and release any publishers blocked on its full queue. */
  private unsubscribe(slot: SubscriberSlot): void {
    slot.closed = true;
    this.subscribers.get(slot.contract)?.delete(slot);
    for (const wake of slot.waiters.splice(0)) wake();
  }
}
