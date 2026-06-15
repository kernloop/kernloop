/**
 * Typed errors for the program ledger (program-store.ts) — extracted so the
 * store stays within its per-file LOC budget. Re-exported from program-store.ts,
 * so callers keep importing them from there.
 */

/** Inserting a program whose id already exists — no silent overwrite. */
export class DuplicateProgramError extends Error {
  constructor(programId: string) {
    super(`program "${programId}" already exists — refusing to overwrite`);
    this.name = 'DuplicateProgramError';
  }
}

/** Advancing a (programId, nodeId) the ledger does not hold — never invented. */
export class UnknownProgramNodeError extends Error {
  constructor(programId: string, nodeId: string) {
    super(`no node "${nodeId}" in program "${programId}"`);
    this.name = 'UnknownProgramNodeError';
  }
}

/** Adding nodes to a program the ledger does not hold — never invented. */
export class UnknownProgramError extends Error {
  constructor(programId: string) {
    super(`no program "${programId}" in the ledger`);
    this.name = 'UnknownProgramError';
  }
}

/** Inserting a node whose id already exists in the program — no silent overwrite. */
export class DuplicateProgramNodeError extends Error {
  constructor(programId: string, nodeId: string) {
    super(`node "${nodeId}" already exists in program "${programId}" — refusing to overwrite`);
    this.name = 'DuplicateProgramNodeError';
  }
}

/** A backward or otherwise-illegal node transition (the ledger is forward-only). */
export class InvalidNodeTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNodeTransitionError';
  }
}
