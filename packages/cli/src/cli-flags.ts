/**
 * Shared CLI flag parsers kept apart from cli.ts so the dispatch shell stays
 * under the 400-line budget. Pure parsing — no I/O, no kernloop.
 */

/** One run-budget dimension on the `--budget` flag (`tokens=N,usd=N,wallClock=N`). */
const BUDGET_KEYS = { tokens: 'tokens', usd: 'usd', wallclock: 'wallClockMin' } as const;

/**
 * Parse a first-class `--budget tokens=N,usd=N,wallClock=N` flag into the run
 * tool's budget shape [CLM-0077]. All three dimensions are required (a partial
 * budget would silently default the rest — a lie about the cap). An unknown key
 * or non-numeric value fails loudly.
 */
export function parseBudget(
  raw: string | undefined,
): { tokens: number; usd: number; wallClockMin: number } | undefined {
  if (raw === undefined) return undefined;
  const out: Record<string, number> = {};
  for (const pair of raw.split(',')) {
    const [key, value] = pair.split('=');
    const dim = BUDGET_KEYS[(key ?? '').trim().toLowerCase() as keyof typeof BUDGET_KEYS];
    const n = Number(value);
    if (dim === undefined || value === undefined || !Number.isFinite(n)) {
      throw new Error(`--budget expects tokens=N,usd=N,wallClock=N (got "${pair}")`);
    }
    out[dim] = n;
  }
  const { tokens, usd, wallClockMin } = out;
  if (tokens === undefined || usd === undefined || wallClockMin === undefined) {
    throw new Error('--budget requires all of tokens, usd, wallClock');
  }
  return { tokens, usd, wallClockMin };
}
