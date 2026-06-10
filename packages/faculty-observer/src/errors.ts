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
 * Thrown when an issue proposal is malformed (empty title/body/goal) or a
 * filing request references a proposal that does not exist or was already
 * filed.
 */
export class InvalidIssueProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidIssueProposalError';
  }
}

/**
 * Thrown when the issue tracker is unreachable: `gh` is absent from PATH,
 * unauthenticated, or exits nonzero (CLM-0056; design note: the Observer
 * reports unavailable — it never silently skips, never stubs success).
 */
export class ObserverTrackerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObserverTrackerUnavailableError';
  }
}
