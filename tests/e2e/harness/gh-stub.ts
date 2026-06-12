/**
 * The hermetic `gh` stub — the ONE external boundary the e2e suite replaces so
 * nothing ever touches real GitHub or the network. `@kernloop/tracker` spawns
 * `gh` by bare name with `shell:false`, resolved from `PATH` (see
 * packages/tracker/src/exec.ts), so a fake `gh` placed FIRST on `PATH`
 * intercepts every invocation.
 *
 * Two modes:
 *  - `record`: append each argv (as JSON) to a record file and, for an
 *    `issue create`, print an issue URL as the LAST stdout line (the tracker
 *    parses the last URL line as the created ref). Exits 0.
 *  - `poison`: write a sentinel file and exit 1 the moment it is invoked — used
 *    to PROVE the CLI never spawned `gh` (a clean run leaves no sentinel).
 *
 * The stub is a self-contained Node script (shebang + `chmod 0o755`) using only
 * node built-ins, so it runs on the CI ubuntu runner.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A created gh stub: the bin dir to prepend to `PATH`, plus call/sentinel readers. */
export interface GhStub {
  /** Directory containing the executable `gh` — prepend to `PATH`. */
  readonly binDir: string;
  /** The recorded `gh` argv arrays (record mode); empty if never invoked. */
  calls(): string[][];
  /** True iff the poison stub fired (proves an unwanted spawn happened). */
  poisoned(): boolean;
}

/** Options for {@link installGhStub}. */
export interface GhStubOptions {
  /** `record` captures argv + prints a URL; `poison` exits 1 on any invocation. */
  readonly mode: 'record' | 'poison';
  /** The issue URL a record-mode `issue create` prints (defaults to issue #1). */
  readonly issueUrl?: string;
}

/** The env var the stub reads for its record-file path (record mode). */
const RECORD_ENV = 'KERNLOOP_GH_STUB_RECORD';
/** The env var the stub reads for its sentinel path (poison mode). */
const SENTINEL_ENV = 'KERNLOOP_GH_STUB_SENTINEL';

/** The record-mode stub body: append argv, print the issue URL last on `create`. */
function recordScript(issueUrl: string): string {
  return [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    `const rec = process.env.${RECORD_ENV};`,
    'const argv = process.argv.slice(2);',
    "if (rec) fs.appendFileSync(rec, JSON.stringify(argv) + '\\n');",
    "if (argv[0] === 'issue' && argv[1] === 'create') {",
    "  process.stdout.write('Creating issue...\\n');",
    `  process.stdout.write(${JSON.stringify(issueUrl)} + '\\n');`,
    '}',
    'process.exit(0);',
    '',
  ].join('\n');
}

/** The poison-mode stub body: drop a sentinel and fail loudly on any invocation. */
function poisonScript(): string {
  return [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    `const sentinel = process.env.${SENTINEL_ENV};`,
    'if (sentinel) fs.writeFileSync(sentinel, JSON.stringify(process.argv.slice(2)));',
    "process.stderr.write('POISONED gh stub was invoked — a dry-run/suggest path spawned gh\\n');",
    'process.exit(1);',
    '',
  ].join('\n');
}

/**
 * Write an executable `gh` stub into a fresh temp bin dir and return its handle.
 * Prepend `handle.binDir` to a `runCli` call's `PATH` env so the CLI's `gh`
 * resolves to this stub. The stub's record/sentinel file lives in the same temp
 * dir; the same paths are exported into the test's child env via the returned
 * `binDir` plus the `KERNLOOP_GH_STUB_*` vars — callers pass those through
 * {@link ghStubEnv}.
 */
export function installGhStub(opts: GhStubOptions): GhStub {
  const binDir = mkdtempSync(path.join(tmpdir(), 'kernloop-e2e-ghstub-'));
  const ghPath = path.join(binDir, 'gh');
  const recordPath = path.join(binDir, 'calls.jsonl');
  const sentinelPath = path.join(binDir, 'sentinel.json');
  const issueUrl = opts.issueUrl ?? 'https://github.com/kernloop-e2e/sandbox/issues/1';
  const body = opts.mode === 'record' ? recordScript(issueUrl) : poisonScript();
  writeFileSync(ghPath, body, { encoding: 'utf8' });
  chmodSync(ghPath, 0o755);
  // Seed an empty record file so `calls()` is deterministic before any spawn.
  if (opts.mode === 'record') writeFileSync(recordPath, '', 'utf8');
  return {
    binDir,
    calls(): string[][] {
      if (!existsSync(recordPath)) return [];
      return readFileSync(recordPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as string[]);
    },
    poisoned(): boolean {
      return existsSync(sentinelPath);
    },
  };
}

/**
 * The env a `runCli` call needs so the CLI resolves `gh` to this stub and the
 * stub writes its record/sentinel where {@link GhStub.calls}/`poisoned` read it.
 * Prepends `binDir` to the current `PATH` and points the stub at its files.
 */
export function ghStubEnv(stub: GhStub): Record<string, string> {
  return {
    PATH: `${stub.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    [RECORD_ENV]: path.join(stub.binDir, 'calls.jsonl'),
    [SENTINEL_ENV]: path.join(stub.binDir, 'sentinel.json'),
  };
}
