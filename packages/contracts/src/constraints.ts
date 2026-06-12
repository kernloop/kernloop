/**
 * Constraint tags — a typed READER over the existing
 * `TaskContract.constraints: string[]` (spec §4; CLM-0095). This is NOT a new
 * frozen-five contract and adds NO field to TaskContract: it is the canonical
 * `key:value` carrier (already used by `assign:agent.*`) read back as typed
 * program metadata — the program altitude, track, and sprint a task belongs to.
 */
import { z } from 'zod';
import { InvalidConstraintTagError } from './errors.js';

/**
 * The three program altitudes a TaskContract may carry (CLM-0095): an `epic`
 * decomposes into `story`s, a `story` into `task`s. The narrowest reading —
 * three named rungs, no free-form altitude — keeps the tag safe as a later
 * tracker label.
 */
export const AltitudeSchema = z.enum(['epic', 'story', 'task']);
/** Inferred program altitude — see {@link AltitudeSchema}. */
export type Altitude = z.infer<typeof AltitudeSchema>;

/** The known constraint-tag keys this reader recognizes; others pass through. */
const KNOWN_KEYS = ['altitude', 'track', 'sprint', 'assign'] as const;

/**
 * Safe value charset for `track`/`sprint`: a LEADING alphanumeric followed by
 * alphanumerics and `._-`. Spaces, shell/label metacharacters, AND a leading
 * `-`/`.`/`_` are rejected so the value is safe to reuse verbatim as a later
 * tracker label — this mirrors the tracker provider's `LabelSchema` exactly
 * (which also requires a leading alphanumeric so a value can never be read as a
 * flag), so a value accepted here is accepted at the sink (defense in depth).
 */
const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Build the canonical `key:value` constraint tag (CLM-0095). The single
 * carrier used across the system (`assign:agent.*`, `altitude:epic`, …); the
 * inverse is {@link parseConstraintTags}.
 */
export function constraintTag(key: string, value: string): string {
  return `${key}:${value}`;
}

/** The typed view of a constraints array — known program tags plus the rest. */
export interface ParsedConstraintTags {
  /** The program altitude, if an `altitude:<v>` tag is present. */
  altitude?: Altitude;
  /** The track id, if a `track:<v>` tag is present. */
  track?: string;
  /** The sprint id, if a `sprint:<v>` tag is present. */
  sprint?: string;
  /** The assignment routing tag value, if an `assign:<v>` tag is present. */
  assign?: string;
  /** Every constraint that is not a recognized single-value program tag. */
  other: string[];
}

/** Validate and record a `track`/`sprint` value, rejecting duplicates/unsafe. */
function setLabelTag(out: ParsedConstraintTags, key: 'track' | 'sprint', value: string): void {
  if (out[key] !== undefined) {
    throw new InvalidConstraintTagError(key, `appears more than once`);
  }
  if (!SAFE_VALUE.test(value)) {
    throw new InvalidConstraintTagError(key, `value "${value}" is not in [A-Za-z0-9._-]`);
  }
  out[key] = value;
}

/**
 * Read a TaskContract's `constraints` array as typed program metadata
 * (CLM-0095). Recognizes `altitude:<v>`, `track:<v>`, `sprint:<v>`, and
 * `assign:<v>`; everything else — free-form constraints and any string without
 * a `:` — passes through to `other` untouched.
 *
 * Throws {@link InvalidConstraintTagError} when `altitude:` carries a value
 * outside {@link AltitudeSchema} or appears more than once, and when
 * `track:`/`sprint:` is duplicated or carries a value outside `[A-Za-z0-9._-]`
 * (so the value is safe to reuse as a tracker label).
 */
export function parseConstraintTags(constraints: readonly string[]): ParsedConstraintTags {
  const out: ParsedConstraintTags = { other: [] };
  for (const raw of constraints) {
    const sep = raw.indexOf(':');
    const key = sep === -1 ? '' : raw.slice(0, sep);
    if (sep === -1 || !(KNOWN_KEYS as readonly string[]).includes(key)) {
      out.other.push(raw);
      continue;
    }
    const value = raw.slice(sep + 1);
    if (key === 'altitude') {
      if (out.altitude !== undefined) {
        throw new InvalidConstraintTagError('altitude', 'appears more than once');
      }
      const parsed = AltitudeSchema.safeParse(value);
      if (!parsed.success) {
        throw new InvalidConstraintTagError('altitude', `"${value}" is not epic|story|task`);
      }
      out.altitude = parsed.data;
    } else if (key === 'assign') {
      // `assign:` is intentionally NOT charset/duplicate-validated here: it is
      // internally generated as `assign:agent.<template>` from an enum-bound
      // template name (never user free-text on the decompose path), and unlike
      // track/sprint it has no label sink yet. If `assign` ever becomes a
      // tracker label or routing key, route it through setLabelTag too.
      out.assign = value;
    } else if (key === 'track' || key === 'sprint') {
      setLabelTag(out, key, value);
    }
  }
  return out;
}
