/**
 * Project parsimony Decision Receipts into an OSCAL Assessment Results document
 * [#8/#414, EPIC #407]. A restraint decision's evidence — which Control Floor checks
 * applied and a refuted blind verification or an unmitigated deferral — is rendered
 * as catalog-mapped, schema-VALID OSCAL: floor checks become OSCAL `observations`;
 * a `refuted` verification and each unmitigated `deferred` control-risk become OSCAL
 * `findings`. A finding links to a NIST 800-53 control ONLY for a bare control-id
 * token; a `<catalog>:<name>` SENTINEL token (#423) — a Section-508 / WCAG / intent
 * deferral with no 800-53 control — is emitted as a finding WITHOUT a control link.
 *
 * The function is PURE: the caller supplies the document uuid, last-modified
 * timestamp, and oscal-version, so the output is deterministic and testable. Child
 * uuids (per observation/finding) are DERIVED from the document uuid so they are
 * stable across runs yet schema-valid v4-shaped uuids.
 *
 * The ground truth for OSCAL-validity is the `ajv` validation against the vendored
 * official NIST schema in `oscal.test.ts`, NOT the TS types in `oscal-types.ts`.
 *
 * @module parsimony/oscal
 */
import { createHash } from 'node:crypto';
import type { FloorCheck, ParsimonyReceipt } from './receipt.js';
import {
  PARSIMONY_OSCAL_VERSION,
  type OscalAssessmentResults,
  type OscalControlSelection,
  type OscalFinding,
  type OscalObservation,
  type OscalResult,
} from './oscal-types.js';

/** Caller-supplied, non-deterministic metadata for the OSCAL document (so the
 * projection stays pure). `uuid` must be a v4-shaped uuid; `lastModified` an OSCAL
 * date-time-with-timezone (e.g. an ISO-8601 `…Z`). */
export interface OscalMeta {
  readonly uuid: string;
  readonly lastModified: string;
  readonly oscalVersion?: string;
  /** The assessed System Security Plan / Assessment Plan reference (`import-ap.href`).
   * Defaults to a relative placeholder when the caller does not supply one. */
  readonly importApHref?: string;
}

/** The OSCAL property namespace used for kernloop-specific properties. */
const KL_NS = 'https://kernloop.dev/ns/oscal/parsimony';

/**
 * A risk token is a NON-control SENTINEL (`<catalog>:<name>`, #423) — not a bare
 * NIST control id — exactly when it contains a `:`. A real 800-53 control id
 * (`AC-3`, `SI-10`) has no colon; a sentinel always does (its catalog prefix is one
 * of `nist-800-53r5`/`section-508`/`wcag`/`intent`). This is the single
 * disambiguation point: a bare token links to a control, a sentinel does not.
 */
export function isSentinelRisk(token: string): boolean {
  return token.includes(':');
}

/** Derive a stable, schema-valid v4-shaped uuid from a seed (the document uuid plus
 * a discriminator), so child uuids are deterministic without a random source. */
function deriveUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  // Force the version (4) and variant ('8'..'b') nibbles so the result always
  // matches the schema's UUID v4 pattern, regardless of the hash bytes.
  const variant = '89ab'.charAt(parseInt(h.slice(16, 17), 16) % 4);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Map one applicable (non-`na`) floor check to an OSCAL observation. */
function checkToObservation(
  receipt: ParsimonyReceipt,
  check: FloorCheck,
  docUuid: string,
): OscalObservation {
  const controls = check.controlIds.length > 0 ? ` (${check.controlIds.join(', ')})` : '';
  return {
    uuid: deriveUuid(`${docUuid}|obs|${receipt.receiptId}|${check.name}`),
    title: `Control Floor: ${check.name}`,
    description: `Parsimony floor check '${check.name}' [${check.catalog}${controls}] on ${receipt.subject}: ${check.status}.`,
    methods: ['TEST'],
    types: ['control-objective'],
    props: [
      { name: 'floor-status', value: check.status, ns: KL_NS },
      { name: 'catalog', value: check.catalog, ns: KL_NS },
      ...(check.evidenceRef ? [{ name: 'evidence-ref', value: check.evidenceRef, ns: KL_NS }] : []),
    ],
    collected: receipt.ts,
  };
}

/** Build a finding linked to a bare NIST control id (`target.type: objective-id`). */
function controlFinding(
  seed: string,
  controlId: string,
  title: string,
  description: string,
  docUuid: string,
): OscalFinding {
  return {
    uuid: deriveUuid(`${docUuid}|finding|${seed}|${controlId}`),
    title,
    description,
    props: [{ name: 'control-id', value: controlId, ns: KL_NS, class: 'nist-800-53r5' }],
    target: {
      type: 'objective-id',
      'target-id': controlId,
      status: { state: 'not-satisfied', reason: 'fail' },
    },
  };
}

/** Build a finding for a non-control SENTINEL risk — NO NIST control link; the risk
 * is recorded as a property and the target is a synthetic statement id. */
function sentinelFinding(
  seed: string,
  token: string,
  title: string,
  description: string,
  docUuid: string,
): OscalFinding {
  // Synthesize a TokenDatatype-valid target-id from the sentinel (replace `:` so it
  // matches `^(\p{L}|_)(\p{L}|\p{N}|[.\-_])*$`), carrying no NIST control link.
  const targetId = `non-control.${token.replace(/[^\p{L}\p{N}.\-_]/gu, '.')}`;
  return {
    uuid: deriveUuid(`${docUuid}|finding|${seed}|${token}`),
    title,
    description,
    props: [{ name: 'non-control-risk', value: token, ns: KL_NS }],
    target: {
      type: 'statement-id',
      'target-id': targetId,
      status: { state: 'not-satisfied', reason: 'fail' },
    },
  };
}

/** All findings a single receipt contributes: one per refuted-verification control,
 * plus one per unmitigated deferral control-risk token (sentinel-aware). */
function receiptFindings(receipt: ParsimonyReceipt, docUuid: string): OscalFinding[] {
  const findings: OscalFinding[] = [];
  if (receipt.verification.status === 'refuted') {
    // A refuted blind verification fails every applicable (non-`na`) control the
    // floor checked; link a finding to each bare 800-53 control id involved.
    const controls = new Set<string>();
    for (const c of receipt.floorChecks) {
      if (c.status === 'na') continue;
      for (const id of c.controlIds) controls.add(id);
    }
    for (const id of controls) {
      findings.push(
        controlFinding(
          `refuted|${receipt.receiptId}`,
          id,
          `Refuted blind verification on ${receipt.subject}`,
          `The blind verifier '${receipt.verification.verifier}' REFUTED the parsimony decision on ${receipt.subject}; control ${id} is not demonstrably satisfied.`,
          docUuid,
        ),
      );
    }
  }
  if (receipt.deferred) {
    const d = receipt.deferred;
    for (const token of d.controlRisk) {
      const common = {
        seed: `deferred|${d.debtId}`,
        title: `Unmitigated parsimony deferral on ${receipt.subject}`,
        description: `Debt ${d.debtId} (owner ${d.owner}): ${d.reason}. Risk: ${token}.`,
      };
      findings.push(
        isSentinelRisk(token)
          ? sentinelFinding(common.seed, token, common.title, common.description, docUuid)
          : controlFinding(common.seed, token, common.title, common.description, docUuid),
      );
    }
  }
  return findings;
}

/** The set of bare NIST control ids assessed across all receipts (for
 * `reviewed-controls`). Sentinel tokens are excluded — they are not controls. */
function reviewedControlSelections(findings: readonly OscalFinding[]): OscalControlSelection[] {
  const controls = new Set<string>();
  for (const f of findings) {
    if (f.target.type === 'objective-id') controls.add(f.target['target-id']);
  }
  if (controls.size === 0) return [{ 'include-all': {} }];
  return [{ 'include-controls': [...controls].map((id) => ({ 'control-id': id })) }];
}

/**
 * Project receipts into an OSCAL Assessment Results document. Pure: identical inputs
 * yield identical output. Emits the smallest document the vendored official NIST
 * schema accepts (uuid + metadata + import-ap + one result with observations and
 * findings). Floor checks that did not apply (`na`) are omitted from observations.
 */
export function toOscalAssessmentResults(
  receipts: readonly ParsimonyReceipt[],
  meta: OscalMeta,
): OscalAssessmentResults {
  const observations: OscalObservation[] = [];
  const findings: OscalFinding[] = [];
  for (const r of receipts) {
    for (const c of r.floorChecks) {
      if (c.status === 'na') continue;
      observations.push(checkToObservation(r, c, meta.uuid));
    }
    findings.push(...receiptFindings(r, meta.uuid));
  }

  const result: OscalResult = {
    uuid: deriveUuid(`${meta.uuid}|result`),
    title: 'Parsimony Restraint Assessment',
    description:
      'Assessment results projected from kernloop parsimony Decision Receipts: Control Floor checks as observations, refuted blind verifications and unmitigated deferrals as findings.',
    start: meta.lastModified,
    'reviewed-controls': { 'control-selections': reviewedControlSelections(findings) },
    ...(observations.length > 0 ? { observations } : {}),
    ...(findings.length > 0 ? { findings } : {}),
  };

  return {
    'assessment-results': {
      uuid: meta.uuid,
      metadata: {
        title: 'Kernloop Parsimony Assessment Results',
        'last-modified': meta.lastModified,
        version: '0.1.0',
        'oscal-version': meta.oscalVersion ?? PARSIMONY_OSCAL_VERSION,
      },
      'import-ap': { href: meta.importApHref ?? '#parsimony-assessment-plan' },
      results: [result],
    },
  };
}
