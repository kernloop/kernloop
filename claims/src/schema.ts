/**
 * Claim schema for the kernloop claims registry (spec §1 rule 2, seed Step 3).
 *
 * A claim is one README-quotable sentence about repo behavior, backed by
 * typed evidence references that `claims:check` resolves against the actual
 * tree. The registry IS the backlog: a capability exists when its claim's
 * evidence resolves, and not before.
 *
 * Registry format: one YAML file per claim at `claims/registry/CLM-NNNN.yaml`
 * whose basename equals the claim `id`.
 */
import { z } from 'zod';

/** Stable claim identifier, e.g. `CLM-0001` (mirrors contracts ClaimRefSchema). */
export const CLAIM_ID_PATTERN = /^CLM-\d{4}$/;

/**
 * Evidence reference grammar (seed Step 3):
 * - `test:<path>::<test name>` — a `test('…')`/`it('…')` literal in that file
 * - `ci:<job>`                 — a job in `.github/workflows/*.yml`
 * - `doc:<path>#<anchor>`      — a GitHub-slugged heading or `<a id=…>` anchor
 * - `eval:<artifact path>`     — an eval artifact file that must exist
 *
 * Parsed into a discriminated union so resolvers can switch on `kind`.
 */
export type EvidenceRef =
  | { kind: 'test'; raw: string; path: string; testName: string }
  | { kind: 'ci'; raw: string; job: string }
  | { kind: 'doc'; raw: string; path: string; anchor: string }
  | { kind: 'eval'; raw: string; path: string };

/**
 * Parse a raw evidence string into its discriminated form.
 * Returns an error string (not an exception) when the ref is malformed, so
 * schema validation can surface a precise message per ref.
 */
export function parseEvidenceRef(raw: string): EvidenceRef | { error: string } {
  if (raw.startsWith('test:')) {
    const body = raw.slice('test:'.length);
    const sep = body.indexOf('::');
    if (sep <= 0 || sep === body.length - 2) {
      return { error: `test ref must be "test:<path>::<test name>", got "${raw}"` };
    }
    return { kind: 'test', raw, path: body.slice(0, sep), testName: body.slice(sep + 2) };
  }
  if (raw.startsWith('ci:')) {
    const job = raw.slice('ci:'.length);
    if (job.length === 0) return { error: `ci ref must be "ci:<job>", got "${raw}"` };
    return { kind: 'ci', raw, job };
  }
  if (raw.startsWith('doc:')) {
    const body = raw.slice('doc:'.length);
    const hash = body.indexOf('#');
    if (hash <= 0 || hash === body.length - 1) {
      return { error: `doc ref must be "doc:<path>#<anchor>", got "${raw}"` };
    }
    return { kind: 'doc', raw, path: body.slice(0, hash), anchor: body.slice(hash + 1) };
  }
  if (raw.startsWith('eval:')) {
    const path = raw.slice('eval:'.length);
    if (path.length === 0)
      return { error: `eval ref must be "eval:<artifact path>", got "${raw}"` };
    return { kind: 'eval', raw, path };
  }
  return { error: `unknown evidence kind in "${raw}" (expected test:|ci:|doc:|eval:)` };
}

/** Zod schema that validates AND parses a raw evidence string. */
export const EvidenceRefSchema = z
  .string()
  .min(1)
  .transform((raw, ctx): EvidenceRef => {
    const parsed = parseEvidenceRef(raw);
    if ('error' in parsed) {
      ctx.addIssue({ code: 'custom', message: parsed.error });
      return z.NEVER;
    }
    return parsed;
  });

/**
 * `statement` must be README-quotable: one sentence on a single line, ending
 * in terminal punctuation. (Interior punctuation is allowed — clauses, em
 * dashes, and version numbers are common in honest statements.)
 */
const StatementSchema = z
  .string()
  .min(1)
  .refine((s) => !/[\r\n]/.test(s), { message: 'statement must be a single line' })
  .refine((s) => /[.!?]$/.test(s.trim()), {
    message: 'statement must be one sentence ending in . ! or ?',
  });

/** GitHub handle: alphanumeric + hyphens, ≤39 chars, no leading hyphen. */
const OwnerSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/, 'owner must be a github handle');

/** Semver version string (the release the claim has held since). */
const SemverSchema = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    'since must be a semver string',
  );

/**
 * One registry claim. `verified` additionally requires at least one `test`
 * evidence ref — that cross-field rule lives in `claims:check` (check.ts)
 * rather than here so the checker can report it as its own failure class.
 *
 * Status lifecycle (ratified 7-0): `planned` (backlog entry, non-citable in
 * docs) → `verified` (evidence lands in the same PR as the implementation).
 * Only `planned` claims may have an empty evidence array; any refs that ARE
 * present on a planned claim must still resolve.
 */
export const ClaimSchema = z
  .strictObject({
    id: z.string().regex(CLAIM_ID_PATTERN, 'id must match CLM-NNNN'),
    statement: StatementSchema,
    evidence: z.array(EvidenceRefSchema),
    status: z.enum(['verified', 'experimental', 'planned']),
    owner: OwnerSchema,
    since: SemverSchema,
  })
  .superRefine((claim, ctx) => {
    if (claim.status !== 'planned' && claim.evidence.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'evidence must be a non-empty array (only "planned" claims may have none)',
      });
    }
  });
export type Claim = z.infer<typeof ClaimSchema>;
