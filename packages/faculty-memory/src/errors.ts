/**
 * Typed errors thrown at the faculty's write boundaries. Callers (the kernel,
 * at the bus boundary) can discriminate on `name` or `instanceof` — never on
 * message text.
 */

/**
 * Thrown when a semantic memory write arrives without provenance (spec §5.2:
 * "provenance mandatory"; CLM-0022). Missing, empty, and whitespace-only
 * provenance all reject.
 */
export class ProvenanceRequiredError extends Error {
  constructor(message = 'semantic memory write rejected: provenance is mandatory (spec §5.2)') {
    super(message);
    this.name = 'ProvenanceRequiredError';
  }
}

/**
 * Thrown when a semantic memory write is malformed for a reason other than
 * provenance (empty fact text, out-of-range confidence, wrong types).
 */
export class InvalidFactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFactError';
  }
}

/**
 * Thrown when `recordOutcome` receives a value that fails `OutcomeSchema`
 * validation at the boundary (charter: zod-validate at every contract
 * boundary; CLM-0024).
 */
export class InvalidOutcomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOutcomeError';
  }
}
