/**
 * Typed errors thrown at the observer's boundaries. Callers (the kernel, at
 * the bus/composition boundary) discriminate on `name` or `instanceof` —
 * never on message text.
 */

/**
 * Thrown when `ingestOutcome` receives a value failing `OutcomeSchema`
 * validation at the boundary (charter: zod-validate at every contract
 * boundary; CLM-0055).
 */
export class InvalidOutcomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOutcomeError';
  }
}

/**
 * Thrown when `ingestVerdict` receives a value failing `VerdictSchema`
 * validation at the boundary (CLM-0055).
 */
export class InvalidVerdictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidVerdictError';
  }
}

/**
 * Thrown when an issue proposal is malformed (empty title/body/goal), or when
 * marking a proposal filed references a proposal that does not exist, was
 * already filed, or carries a non-http(s) url (CLM-0056).
 */
export class InvalidIssueProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidIssueProposalError';
  }
}
