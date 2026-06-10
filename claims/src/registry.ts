/**
 * Registry loader for `claims:check`. Reads every `*.yaml`/`*.yml` file in
 * the registry directory, validates each against ClaimSchema, and enforces
 * the structural invariants: filename === claim id, ids unique.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ClaimSchema, type Claim } from './schema.js';

export interface RegistryClaim {
  /** Registry file the claim came from (relative to the registry dir). */
  file: string;
  claim: Claim;
}

export interface RegistryLoadResult {
  claims: RegistryClaim[];
  errors: string[];
}

function loadOne(registryDir: string, file: string, out: RegistryLoadResult): void {
  let raw: unknown;
  try {
    raw = YAML.parse(fs.readFileSync(path.join(registryDir, file), 'utf8'));
  } catch (err) {
    out.errors.push(`${file}: invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const parsed = ClaimSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const at = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      out.errors.push(`${file}: schema violation at ${at}: ${issue.message}`);
    }
    return;
  }
  const claim = parsed.data;
  const basename = file.replace(/\.(yaml|yml)$/, '');
  if (basename !== claim.id) {
    out.errors.push(
      `${file}: filename must equal claim id (file says "${basename}", claim says "${claim.id}")`,
    );
  }
  out.claims.push({ file, claim });
}

/**
 * Load and structurally validate the registry. Schema failures, filename/id
 * mismatches, and duplicate ids all land in `errors`; claims that parsed
 * cleanly are still returned so evidence errors can be reported alongside.
 */
export function loadRegistry(registryDir: string): RegistryLoadResult {
  const out: RegistryLoadResult = { claims: [], errors: [] };
  if (!fs.existsSync(registryDir)) {
    out.errors.push(`registry directory not found: ${registryDir}`);
    return out;
  }
  const files = fs
    .readdirSync(registryDir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort();
  if (files.length === 0) {
    out.errors.push(
      `registry directory is empty: ${registryDir} (an honest repo still claims what its tests prove)`,
    );
    return out;
  }
  for (const file of files) {
    loadOne(registryDir, file, out);
  }
  const seen = new Map<string, string>();
  for (const { file, claim } of out.claims) {
    const first = seen.get(claim.id);
    if (first !== undefined) {
      out.errors.push(`duplicate claim id ${claim.id} (in ${first} and ${file})`);
    } else {
      seen.set(claim.id, file);
    }
  }
  return out;
}
