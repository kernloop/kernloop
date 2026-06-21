/**
 * The typed OSCAL Assessment Results SUBSET the parsimony projection emits [#8/#414,
 * EPIC #407]. These interfaces describe exactly the shape {@link
 * ../oscal.ts:toOscalAssessmentResults} produces — a callers'-facing type so the
 * projection output is statically typed. The GROUND TRUTH for OSCAL-validity is NOT
 * this type but the `ajv` validation against the vendored official NIST schema
 * (`schemas/oscal_assessment-results_schema.json`, OSCAL v1.1.3) in `oscal.test.ts`:
 * this type is a convenience, the schema is the contract.
 *
 * Only the fields the projection actually emits are modelled — OSCAL has many more
 * optional fields. Property names are OSCAL's kebab-case (e.g. `last-modified`,
 * `oscal-version`, `target-id`), so the emitted JSON matches the schema verbatim.
 *
 * @module parsimony/oscal-types
 */

/** An OSCAL `property` (name/value pair, optionally namespaced) — used to record a
 * receipt's provenance and a non-control risk that has no NIST control to link. */
export interface OscalProperty {
  readonly name: string;
  readonly value: string;
  readonly ns?: string;
  readonly class?: string;
}

/** An OSCAL `observation`: how a floor check was evaluated. `methods` is the OSCAL
 * method vocabulary (`TEST` for an automated floor check); `collected` is the
 * date-time the evidence was gathered. */
export interface OscalObservation {
  readonly uuid: string;
  readonly title: string;
  readonly description: string;
  readonly methods: readonly string[];
  readonly types?: readonly string[];
  readonly props?: readonly OscalProperty[];
  readonly collected: string;
}

/** The OSCAL finding `target` — the objective/statement the finding is about and
 * whether it is satisfied. For a NIST control the `target-id` IS the control id and
 * `type` is `objective-id`; for a non-control (sentinel) risk it is a synthetic
 * `statement-id` carrying no control link. */
export interface OscalFindingTarget {
  readonly type: 'statement-id' | 'objective-id';
  readonly 'target-id': string;
  readonly status: { readonly state: 'satisfied' | 'not-satisfied'; readonly reason?: string };
}

/** An OSCAL `finding`: an unmet objective. A `props` `control-id` entry is present
 * IFF this finding links to a real NIST 800-53 control (bare-token deferral or a
 * refuted verification); a sentinel (non-control) risk carries no control link. */
export interface OscalFinding {
  readonly uuid: string;
  readonly title: string;
  readonly description: string;
  readonly props?: readonly OscalProperty[];
  readonly target: OscalFindingTarget;
}

/** An OSCAL `select-control-by-id` — names one assessed control. */
export interface OscalControlSelection {
  readonly 'include-all'?: Record<string, never>;
  readonly 'include-controls'?: readonly { readonly 'control-id': string }[];
}

/** An OSCAL `result` aggregating the observations + findings of one assessment run. */
export interface OscalResult {
  readonly uuid: string;
  readonly title: string;
  readonly description: string;
  readonly start: string;
  readonly 'reviewed-controls': { readonly 'control-selections': readonly OscalControlSelection[] };
  readonly observations?: readonly OscalObservation[];
  readonly findings?: readonly OscalFinding[];
}

/** OSCAL document `metadata` — title, last-modified, version, oscal-version. */
export interface OscalMetadata {
  readonly title: string;
  readonly 'last-modified': string;
  readonly version: string;
  readonly 'oscal-version': string;
}

/** The OSCAL Assessment Results document the projection emits (the subset the
 * vendored schema requires: uuid, metadata, import-ap, results). */
export interface OscalAssessmentResults {
  readonly 'assessment-results': {
    readonly uuid: string;
    readonly metadata: OscalMetadata;
    readonly 'import-ap': { readonly href: string };
    readonly results: readonly OscalResult[];
  };
}

/** The default OSCAL version the projection targets (matches the vendored schema). */
export const PARSIMONY_OSCAL_VERSION = '1.1.3';
