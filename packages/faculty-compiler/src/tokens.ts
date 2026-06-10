/**
 * Deterministic token estimator for brief budgeting (spec §5.1, §8 item 1).
 *
 * The estimate is `ceil(length / 4)` over UTF-16 code units — the common
 * ~4-characters-per-token heuristic. Exact tokenizer parity is explicitly
 * NOT a goal: budgets need a stable, model-independent measure so that
 * identical inputs always charge identical token counts (CLM-0029). Pure
 * arithmetic on string length — no I/O, no locale tables, no clock.
 */
export const CHARS_PER_TOKEN = 4;

/** Estimated token cost of `text`; 0 for the empty string. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
