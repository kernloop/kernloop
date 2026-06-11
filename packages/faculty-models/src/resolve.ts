/**
 * resolveIdentity [CLM-0080] — normalize a served model alias/id into a
 * {@link ModelIdentity} (spec §5.2 normalization, the SUPPLY dual of §8.4's
 * ModelRequirement). PURE: no I/O, no model call, no network; it reads only its
 * `rawId` argument and the supplied catalog.
 *
 * Three honesty-ordered layers, each a strictly weaker claim than the last:
 *  1. TABLE — an exact hit in the vendored catalog → full metadata,
 *     `resolvedBy:'table'`. This is the only path that asserts cost/context.
 *  2. RULE — a well-formed canonical `provider/family-generation-variant`
 *     string that is NOT catalogued → the structure is parsed (provider,
 *     family, generation, variant, a best-effort tier), but ALL cost/context
 *     metadata is null, `resolvedBy:'rule'`. We know its shape, not its prices.
 *  3. UNKNOWN — anything else (garbage, empty) → provider is the part before
 *     '/' when present else 'unknown', family 'unknown', generation '0',
 *     variant null, tier defaulted DOWN to 'small', all metadata null,
 *     `resolvedBy:'unknown'`.
 *
 * Invariants (the prime directive, enforced by tests): it NEVER throws, NEVER
 * guesses metadata (unknowns are null, not zero/estimate), NEVER defaults a
 * tier upward, and treats `generation` as an OPAQUE label — there is no
 * cross-provider "newer-than" arithmetic anywhere in this module.
 */
import { ModelIdentitySchema, type ModelIdentity } from '@kernloop/contracts';
import type { Catalog } from './catalog.js';

/** A catalogued model maps every tier; an unrecognized one defaults DOWN. */
const UNKNOWN_TIER = 'small' as const;

/**
 * Map a catalogued tier word onto the model class. Anthropic/openai/google
 * size words seen in canonical ids hint a tier WITHOUT guessing cost; an
 * unrecognized word defaults DOWN (never up). Used only by the RULE layer —
 * the TABLE layer takes the catalog's declared tier verbatim.
 */
function tierFromText(text: string): ModelIdentity['tier'] {
  const t = text.toLowerCase();
  if (/\b(opus|pro|frontier)\b/.test(t)) return 'large';
  if (/\b(sonnet|gpt|flash)\b/.test(t)) return 'medium';
  if (/\b(haiku|mini|nano|lite|small)\b/.test(t)) return 'small';
  return UNKNOWN_TIER;
}

/** Build a fully-null-metadata identity (RULE/UNKNOWN never assert cost). */
function bareIdentity(
  raw: string,
  fields: Pick<ModelIdentity, 'provider' | 'family' | 'generation' | 'variant' | 'tier'>,
  resolvedBy: 'rule' | 'unknown',
): ModelIdentity {
  return ModelIdentitySchema.parse({
    ...fields,
    raw,
    resolvedBy,
    contextWindow: null,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
  });
}

/** The honest UNKNOWN identity for a string we cannot structurally parse. */
function unknownIdentity(raw: string): ModelIdentity {
  const slash = raw.indexOf('/');
  const provider = slash > 0 ? raw.slice(0, slash) : 'unknown';
  return bareIdentity(
    raw,
    { provider, family: 'unknown', generation: '0', variant: null, tier: UNKNOWN_TIER },
    'unknown',
  );
}

/** Split a trailing `:variant` suffix off the id body (e.g. `…-3b:instruct`). */
function stripVariantSuffix(body: string): { body: string; suffix: string | null } {
  const colon = body.indexOf(':');
  return colon < 0
    ? { body, suffix: null }
    : { body: body.slice(0, colon), suffix: body.slice(colon + 1) || null };
}

/** Trailing version token → generation (opaque); the leading words → family. */
function parseFamilyGeneration(name: string): { family: string; generation: string } | null {
  // family is one-or-more leading words; generation is a trailing dotted/number
  // token, optionally followed by a non-numeric variant word we keep on family.
  const match = /^(.*?)[-\s]?(\d+(?:\.\d+)*)(?:[-_].*)?$/.exec(name);
  if (match === null || match[1] === undefined || match[1].length === 0) return null;
  return { family: match[1].replace(/[-_]+$/, ''), generation: match[2] ?? '0' };
}

/**
 * RULE layer: parse a canonical `provider/rest` id whose `rest` carries a
 * trailing version. Returns null when the string is not structurally a model id
 * (the caller then falls through to UNKNOWN).
 */
function ruleParse(rawId: string): ModelIdentity | null {
  const slash = rawId.indexOf('/');
  if (slash <= 0) return null;
  const provider = rawId.slice(0, slash);
  const { body, suffix } = stripVariantSuffix(rawId.slice(slash + 1));
  const fg = parseFamilyGeneration(body);
  if (fg === null) return null;
  return bareIdentity(
    rawId,
    {
      provider,
      family: fg.family,
      generation: fg.generation,
      variant: suffix,
      tier: tierFromText(body),
    },
    'rule',
  );
}

/**
 * Normalize a served model alias/id into a {@link ModelIdentity}. Layered
 * table → rule → unknown (see module doc). Never throws; an empty string is the
 * harness default (kernloop pinned no model) and resolves to an honest UNKNOWN.
 */
export function resolveIdentity(rawId: string, catalog: Catalog): ModelIdentity {
  const hit = catalog.models[rawId];
  if (hit !== undefined) {
    return ModelIdentitySchema.parse({ ...hit, raw: rawId, resolvedBy: 'table' });
  }
  return ruleParse(rawId) ?? unknownIdentity(rawId);
}
