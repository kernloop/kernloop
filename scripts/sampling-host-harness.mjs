#!/usr/bin/env node
/**
 * MCP-sampling LIVE validation harness (#135 Phase 2) — the production model
 * architecture, end to end, against a REAL model.
 *
 * This script acts as an MCP HOST: it spawns `kernloop serve` over stdio,
 * declares the `sampling` capability, and fulfils every `sampling/createMessage`
 * kernloop sends UP by running `opencode run` (OpenRouter free tier) and
 * returning the completion text. It then calls the `run` tool for
 * `workflow.canonical` on a tiny task in a throwaway workspace and prints the
 * terminal Outcome. The workspace carries a REAL `typecheck` gate (`node
 * --check`, dependency-free) so the gate-fail -> re-iterate -> pass routing is
 * actually exercised, not bypassed (the consensus-vote condition).
 *
 * TIER-AWARE ROUTING (#140): kernloop sends each node's requested tier as MCP
 * `modelPreferences` (cost/speed/intelligence priorities). This host reads them
 * and routes the high-intelligence nodes (vote/plan/review) to a STRONGER model
 * and the cheap nodes to a fast one — exactly what a production host (Opencode)
 * does with its own tiers. kernloop pins NO model; the host owns the mapping.
 *
 * NOT a CI test — it makes real model calls. The CI-safe proof is the in-process
 * mocked round-trip + sampling-during-tool-call tests in mcp-sampling.test.ts.
 *
 * ⚠ RUN IN A DISPOSABLE ENVIRONMENT (a throwaway VM/container/checkout). opencode
 * is an AUTONOMOUS AGENT, not a pure completion endpoint: fulfilling a coder
 * prompt, it may WRITE FILES via its own tools, and its project/session tracking
 * was observed escaping this script's `cwd: OPENCODE_CWD` and writing into the
 * surrounding git repo (#138). The `--` separator below blocks flag-injection but
 * NOT opencode's intrinsic file-writing. In PRODUCTION the host fulfils sampling
 * with a pure COMPLETION (the OpenAI-compatible provider), which has no such
 * side effects — using the opencode CLI here is a leaky TEST stand-in.
 *
 * Usage: node scripts/sampling-host-harness.mjs [high-model] [low-model]
 *   high (intelligencePriority>=0.7): opencode/nemotron-3-ultra-free  (overridable)
 *   low  (everything else):           opencode/north-mini-code-free   (overridable)
 *   env overrides: KERNLOOP_HARNESS_HIGH_MODEL, KERNLOOP_HARNESS_LOW_MODEL
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLI = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
// Tier-aware model pair (#140). kernloop sends each node's tier as MCP
// modelPreferences; this host maps high-intelligence nodes to HIGH_MODEL and
// the rest to LOW_MODEL. kernloop pins neither — the host owns the mapping.
const HIGH_MODEL =
  process.argv[2] ?? process.env.KERNLOOP_HARNESS_HIGH_MODEL ?? 'opencode/nemotron-3-ultra-free';
const LOW_MODEL =
  process.argv[3] ?? process.env.KERNLOOP_HARNESS_LOW_MODEL ?? 'opencode/north-mini-code-free';
// Route to HIGH when the node asked for at least this much intelligence (a
// frontier node sends 1.0, large 0.8, medium 0.5, small 0.2 — so 0.7 splits
// the judgment nodes (vote/plan/review) from the cheap ones.
const HIGH_INTELLIGENCE_CUTOFF = 0.7;
const OPENCODE_CWD = mkdtempSync(path.join(tmpdir(), 'sampling-opencode-'));

/** Map a node's MCP modelPreferences to a concrete opencode model (#140): the
 * host's own high/med/low routing. A node that asked for high intelligence gets
 * the strong model; everything else gets the fast one. No preference -> LOW. */
function pickModel(preferences) {
  const intelligence = preferences?.intelligencePriority ?? 0;
  return intelligence >= HIGH_INTELLIGENCE_CUTOFF ? HIGH_MODEL : LOW_MODEL;
}

/** One sampling round: run opencode on the prompt, return the assistant text by
 * concatenating its streamed `type:"text"` events (#135). The prompt is UNTRUSTED
 * (loop/model-generated), so it is passed AFTER a `--` end-of-options separator —
 * opencode (yargs) would otherwise read a leading-dash prompt (e.g. `--dir=…`) as
 * a FLAG and could be redirected out of its throwaway cwd (argument injection;
 * verified). NOTE: `--` blocks flag-injection but opencode is an autonomous agent
 * and its file-writing is NOT fully contained by `cwd` (see the header warning
 * and #138) — run this harness only in a disposable environment. */
function fulfilViaOpencode(prompt, model) {
  const out = execFileSync('opencode', ['run', '--format', 'json', '-m', model, '--', prompt], {
    cwd: OPENCODE_CWD,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 600_000,
  });
  let text = '';
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'text' && ev.part?.type === 'text') text += ev.part.text;
    } catch {
      /* non-JSON noise line — skip */
    }
  }
  return text;
}

/** Build a throwaway repo workspace: a tiny package.json whose `typecheck` is a
 * REAL dependency-free syntax check, plus a kernloop overlay (`kernloop init`). */
function makeWorkspace() {
  const ws = mkdtempSync(path.join(tmpdir(), 'sampling-ws-'));
  mkdirSync(path.join(ws, 'src'), { recursive: true });
  writeFileSync(
    path.join(ws, 'package.json'),
    JSON.stringify(
      {
        name: 'sampling-harness-ws',
        version: '0.0.0',
        scripts: { typecheck: 'node --check src/index.js', lint: 'true', test: 'true' },
      },
      null,
      2,
    ),
  );
  execFileSync('node', [CLI, 'init', '--dir', ws], { encoding: 'utf8' });
  return ws;
}

/** Install the sampling fulfilment handler (each createMessage -> opencode);
 * returns a getter for the running call count. */
function installSamplingFulfilment(client) {
  let sampleCount = 0;
  client.setRequestHandler(CreateMessageRequestSchema, (req) => {
    sampleCount += 1;
    const m = req.params.messages[0]?.content;
    const prompt = m?.type === 'text' ? m.text : '';
    // Tier-aware routing (#140): the node's requested tier rode up as MCP
    // modelPreferences; this host maps it to a concrete model.
    const prefs = req.params.modelPreferences;
    const model = pickModel(prefs);
    const intel = prefs?.intelligencePriority ?? 0;
    console.error(
      `[harness] sampling #${sampleCount} (${prompt.length} chars, intel=${intel}) -> ${model}…`,
    );
    const text = fulfilViaOpencode(prompt, model);
    console.error(`[harness]   <- ${text.length} chars`);
    return { role: 'assistant', content: { type: 'text', text }, model };
  });
  return () => sampleCount;
}

/** Print the audit-chain tail so a terminal Outcome + the nodes are observable. */
function printAuditTail(ws) {
  try {
    const audit = readFileSync(path.join(ws, '.kernloop', 'audit.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .slice(-6)
      .map((l) => {
        const e = JSON.parse(l);
        return `${e.seq} ${e.type} ${e.payload?.status ?? e.payload?.node ?? ''}`;
      });
    console.error('[harness] audit tail:\n  ' + audit.join('\n  '));
  } catch (e) {
    console.error('[harness] (no audit tail)', e?.message);
  }
}

async function main() {
  if (!existsSync(CLI)) throw new Error(`build first: ${CLI} missing (run pnpm build)`);
  const ws = makeWorkspace();
  console.error(
    `[harness] workspace: ${ws}\n[harness] tier routing — high: ${HIGH_MODEL}  low: ${LOW_MODEL}`,
  );

  const transport = new StdioClientTransport({
    command: 'node',
    args: [CLI, 'serve', '--dir', ws],
  });
  const client = new Client(
    { name: 'sampling-host-harness', version: '0.1.0' },
    { capabilities: { sampling: {} } },
  );
  const samples = installSamplingFulfilment(client);

  await client.connect(transport);
  console.error('[harness] connected to kernloop serve; calling run (workflow.canonical)…');

  const result = await client.callTool(
    {
      name: 'run',
      arguments: {
        goal: 'Create src/index.js that exports a function greet(name) returning the string `Hello, ${name}!`. Keep it to that one small file.',
        capability: 'workflow.canonical',
        workspaceDir: ws,
        execute: true,
        unlimited: true,
      },
    },
    undefined,
    { timeout: 1_800_000 }, // 30 min — the whole loop, many sampling round-trips
  );

  const payload = result.content?.[0]?.type === 'text' ? result.content[0].text : '{}';
  console.error(`\n[harness] === RUN RESULT (sampling calls: ${samples()}) ===`);
  console.log(payload);
  printAuditTail(ws);

  await client.close();
  console.error('[harness] done. workspace kept for inspection: ' + ws);
}

main()
  .catch((e) => {
    console.error('[harness] FAILED:', e?.stack ?? e);
    process.exitCode = 1;
  })
  .finally(() => rmSync(OPENCODE_CWD, { recursive: true, force: true }));
