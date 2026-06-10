/**
 * Kernel EventBus (spec §3.1) — public surface of the bus module.
 *
 * @module kernel/bus
 */

export {
  EventBus,
  EventBusError,
  DEFAULT_QUEUE_CAPACITY,
  messageIdOf,
  type EventBusErrorCode,
  type ContractName,
  type ContractMessage,
  type AnyContractMessage,
  type ContractHandler,
  type SubscribeOptions,
} from './event-bus.js';
