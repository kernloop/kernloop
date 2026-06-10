/**
 * Capability-statement lint (seed Step 3b, conservative form): inside a
 * `<!-- claims:begin -->` … `<!-- claims:end -->` block, every sentence must
 * carry at least one `[CLM-NNNN]` tag, and every tag in the document must
 * reference a claim that exists in the registry. Documentation cannot lie
 * about behavior: a capability sentence without a verifiable claim is a
 * lint failure, not prose style.
 */
import fs from 'node:fs';
import path from 'node:path';

const BEGIN = '<!-- claims:begin -->';
const END = '<!-- claims:end -->';
const TAG = /\[CLM-\d{4}\]/;
const TAG_GLOBAL = /\[(CLM-\d{4})\]/g;

interface DocSpec {
  file: string;
  /** When true, the file existing WITHOUT claims markers is a failure. */
  markersRequired: boolean;
}

/**
 * P0 policy: absence of either file is OK (the repo may not have written its
 * README yet); an existing README without a claims block is a failure (a
 * README that states capabilities outside the lint's reach is exactly the
 * drift this gate exists to prevent); ARCHITECTURE.md without markers is OK.
 */
const DOCS: DocSpec[] = [
  { file: 'README.md', markersRequired: true },
  { file: 'ARCHITECTURE.md', markersRequired: false },
];

/** Extract the text between each begin/end marker pair; flag unbalanced markers. */
export function extractClaimBlocks(
  source: string,
  file: string,
): { blocks: string[]; errors: string[] } {
  const blocks: string[] = [];
  const errors: string[] = [];
  let cursor = 0;
  for (;;) {
    const begin = source.indexOf(BEGIN, cursor);
    if (begin === -1) break;
    const end = source.indexOf(END, begin + BEGIN.length);
    if (end === -1) {
      errors.push(`${file}: "${BEGIN}" without matching "${END}"`);
      break;
    }
    blocks.push(source.slice(begin + BEGIN.length, end));
    cursor = end + END.length;
  }
  if (source.indexOf(END) !== -1 && source.indexOf(BEGIN) === -1) {
    errors.push(`${file}: "${END}" without matching "${BEGIN}"`);
  }
  return { blocks, errors };
}

/**
 * Split one line of block prose into sentences. Markdown structure lines
 * (headings, fences, comments, blank) carry no capability statements and are
 * skipped; list markers are stripped so the bullet text is linted as a
 * sentence. A line without terminal punctuation is one sentence.
 */
function sentencesOf(line: string): string[] {
  const stripped = line.trim().replace(/^([-*+]|\d+\.)\s+/, '');
  if (stripped.length === 0) return [];
  if (/^(#{1,6}\s|```|~~~|<!--|\||>)/.test(stripped)) return [];
  const chunks = stripped.match(/[^.!?]*[.!?]+(?:\s*\[CLM-\d{4}\])*|[^.!?]+$/g) ?? [];
  return chunks.map((c) => c.trim()).filter((c) => /\p{L}/u.test(c));
}

function lintBlock(block: string, file: string, errors: string[]): void {
  let inFence = false;
  for (const line of block.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const sentence of sentencesOf(line)) {
      if (!TAG.test(sentence)) {
        errors.push(
          `${file}: untagged sentence in claims block: "${sentence}" (every capability sentence needs a [CLM-NNNN] tag)`,
        );
      }
    }
  }
}

function lintDoc(repoRoot: string, spec: DocSpec, knownIds: ReadonlySet<string>): string[] {
  const full = path.resolve(repoRoot, spec.file);
  if (!fs.existsSync(full)) return [];
  const source = fs.readFileSync(full, 'utf8');
  const { blocks, errors } = extractClaimBlocks(source, spec.file);
  if (blocks.length === 0 && errors.length === 0 && spec.markersRequired) {
    errors.push(
      `${spec.file}: exists but has no ${BEGIN} … ${END} block (capability statements must live inside one)`,
    );
  }
  for (const block of blocks) {
    lintBlock(block, spec.file, errors);
  }
  for (const m of source.matchAll(TAG_GLOBAL)) {
    const id = m[1];
    if (id !== undefined && !knownIds.has(id)) {
      errors.push(`${spec.file}: tag [${id}] does not reference an existing registry claim`);
    }
  }
  return errors;
}

/** Lint README.md and ARCHITECTURE.md against the registry's known claim ids. */
export function lintCapabilityDocs(repoRoot: string, knownIds: ReadonlySet<string>): string[] {
  return DOCS.flatMap((spec) => lintDoc(repoRoot, spec, knownIds));
}
