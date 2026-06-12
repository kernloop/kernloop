/**
 * Typed errors thrown at the contracts layer's parsing boundaries. Callers
 * discriminate on `name` or `instanceof` — never on message text.
 */

/**
 * Thrown when a TaskContract constraint tag is malformed: an `altitude:` value
 * outside the {@link AltitudeSchema} enum, a duplicated `altitude:`/`track:`/
 * `sprint:` tag, or a `track:`/`sprint:` value outside the safe label charset.
 * Carries the offending tag key so a caller can report without parsing text.
 *
 * @see parseConstraintTags
 */
export class InvalidConstraintTagError extends Error {
  /** The constraint-tag key that was malformed (e.g. `altitude`). */
  readonly key: string;

  constructor(key: string, detail: string) {
    super(`invalid constraint tag ${key}: ${detail}`);
    this.name = 'InvalidConstraintTagError';
    this.key = key;
  }
}
