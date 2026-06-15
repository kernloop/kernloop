/**
 * Scenario A — the AGILE pipeline end to end (spec §5.4). Drives the REAL
 * `kernloop` binary as a subprocess through decompose → create → status →
 * emit (dry-run, then enforce execute against a hermetic gh stub) → advance,
 * asserting observable state at each step: stdout JSON, the audit chain, the
 * SQLite ledger rollup, exit codes, and the recorded gh invocations.
 *
 * The emit↔ledger link (#88) is now CLOSED: `program emit --program <id>` files
 * a persisted program's planned nodes through the gated tracker and AUTO-records
 * each filed ref into the ledger (planned → emitted) — no manual `program
 * advance --ref` bridge. (The ad-hoc `--goal/--spec` emit still exists and is
 * exercised separately; the manual `advance` now only drives `done` / out-of-band
 * transitions.)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from './harness/run-cli.js';
import {
  auditEvents,
  auditText,
  cleanupOverlays,
  freshOverlay,
  withTracker,
  writeSpec,
} from './harness/overlay.js';
import { ghStubEnv, installGhStub } from './harness/gh-stub.js';
import { PROGRAM_GOAL, TWO_NODE_SPEC } from './harness/specs.js';

afterEach(cleanupOverlays);

const ID = 'prog';

/** Narrow the emit/decompose/status JSON the pipeline asserts against. */
interface NodeRow {
  id?: string;
  nodeId?: string;
  labels?: string[];
  state?: string;
  issueRef?: string | null;
  result?: { ok: boolean; ref?: string };
}

describe('Scenario A — the AGILE pipeline, real binary, hermetic gh', () => {
  it('decompose previews the child tree with mapped ids/altitude/assign labels', () => {
    const repo = freshOverlay();
    const spec = writeSpec(repo, TWO_NODE_SPEC);
    const res = runCli(
      ['program', 'decompose', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID],
      {
        cwd: repo,
      },
    );
    expect(res.code).toBe(0);
    const out = res.json() as { children: Array<{ id: string; constraints: string[] }> };
    expect(out.children.map((c) => c.id)).toEqual(['prog.1', 'prog.2']);
    expect(out.children[0]!.constraints).toContain('altitude:story');
    expect(out.children[0]!.constraints).toContain('assign:agent.coder');
    expect(out.children[1]!.constraints).toContain('assign:agent.documenter');
  });

  it('create persists the plan; list + status reflect N planned nodes', () => {
    const repo = freshOverlay();
    const spec = writeSpec(repo, TWO_NODE_SPEC);
    const created = runCli(
      ['program', 'create', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID],
      { cwd: repo },
    );
    expect(created.code).toBe(0);
    expect((created.json() as { nodeCount: number }).nodeCount).toBe(2);

    const list = runCli(['program', 'list'], { cwd: repo });
    const programs = (list.json() as { programs: Array<{ programId: string }> }).programs;
    expect(programs.map((p) => p.programId)).toContain(ID);

    const status = runCli(['program', 'status', '--program', ID], { cwd: repo });
    const rollup = status.json() as { counts: { planned: number }; nodes: NodeRow[] };
    // The program root umbrella is stored AS a node (it files first on emit),
    // so the rollup shows it alongside the 2 children: 3 planned nodes (#84).
    expect(rollup.counts.planned).toBe(3);
    expect(rollup.nodes.find((n) => n.nodeId === 'prog.1')?.labels).toBeUndefined();
    // The status view carries each node's mapped labels via the create step's
    // ledger; the rollup proves the nodes are planned.
    expect(rollup.nodes.map((n) => n.state)).toEqual(['planned', 'planned', 'planned']);
  });

  it('emit (no --execute, suggest tier) proposes a dry-run and NEVER spawns gh', () => {
    const repo = freshOverlay();
    withTracker(repo, 'suggest');
    const spec = writeSpec(repo, TWO_NODE_SPEC);
    const stub = installGhStub({ mode: 'poison' });
    const res = runCli(['program', 'emit', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID], {
      cwd: repo,
      env: ghStubEnv(stub),
    });
    expect(res.code).toBe(0);
    const report = res.json() as { mode: string; notice: string; nodes: NodeRow[] };
    expect(report.mode).toBe('dry-run');
    expect(report.notice).toContain('DRY RUN');
    // Per-node labels are present in the dry-run proposal.
    expect(report.nodes[0]!.labels).toContain('altitude:story');
    expect(report.nodes[0]!.labels).toContain('agent:coder');
    // The hard proof: gh was never spawned.
    expect(stub.poisoned()).toBe(false);
  });

  it('emit --execute at enforce files one gh issue per node with the mapped labels', () => {
    const repo = freshOverlay();
    withTracker(repo, 'enforce');
    const spec = writeSpec(repo, TWO_NODE_SPEC);
    const stub = installGhStub({
      mode: 'record',
      issueUrl: 'https://github.com/kernloop-e2e/sandbox/issues/501',
    });
    const res = runCli(
      ['program', 'emit', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID, '--execute'],
      { cwd: repo, env: ghStubEnv(stub) },
    );
    expect(res.code).toBe(0);
    const report = res.json() as { mode: string; nodes: NodeRow[] };
    expect(report.mode).toBe('execute');

    const calls = stub.calls();
    expect(calls).toHaveLength(2); // one `gh issue create` per node
    for (const argv of calls) {
      expect(argv.slice(0, 2)).toEqual(['issue', 'create']);
      expect(argv).toContain('--repo');
      expect(argv).toContain('kernloop-e2e/sandbox');
      expect(argv.some((a) => a.startsWith('--title='))).toBe(true);
      expect(argv).toContain('--body-file');
    }
    // The two nodes carry distinct agent labels (proves the per-node mapping).
    const coder = calls.find((a) => a.includes('--title=Build the auth module'))!;
    expect(coder).toContain('--label=altitude:story');
    expect(coder).toContain('--label=agent:coder');
    const doc = calls.find((a) => a.includes('--title=Document the auth module'))!;
    expect(doc).toContain('--label=agent:documenter');
    // The created ref the stub returned is surfaced back per node.
    expect(report.nodes[0]!.result?.ref).toBe('https://github.com/kernloop-e2e/sandbox/issues/501');
  });

  it('emit --program AUTO-records refs into the ledger (planned → emitted), idempotently (#88 CLOSED)', () => {
    const repo = freshOverlay();
    withTracker(repo, 'enforce');
    const spec = writeSpec(repo, TWO_NODE_SPEC);
    const url = 'https://github.com/kernloop-e2e/sandbox/issues/501';
    runCli(['program', 'create', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID], {
      cwd: repo,
    });

    // The link is CLOSED: a single ledger-driven emit files AND records — no
    // manual `program advance --ref` bridge needed.
    const stub = installGhStub({ mode: 'record', issueUrl: url });
    const emitted = runCli(['program', 'emit', '--program', ID, '--execute'], {
      cwd: repo,
      env: ghStubEnv(stub),
    });
    expect(emitted.code).toBe(0);
    const report = emitted.json() as {
      mode: string;
      emittedCount: number;
      nodes: NodeRow[];
      epicUpdates: Array<{ nodeId: string; childCount: number; ok: boolean }>;
    };
    expect(report.mode).toBe('execute');
    // The umbrella root + 2 children = 3 emitted; 3 creates + 1 epic-body edit.
    expect(report.emittedCount).toBe(3);
    expect(stub.calls()).toHaveLength(4);
    expect(stub.calls().filter((a) => a.slice(0, 2).join(' ') === 'issue edit')).toHaveLength(1);
    // The epic body was edited once with its 2 sub-issues (the tree linking, #84).
    expect(report.epicUpdates).toEqual([{ nodeId: ID, childCount: 2, ok: true }]);

    // The ledger shows every node emitted with its ref, recorded AUTOMATICALLY.
    const status = runCli(['program', 'status', '--program', ID], { cwd: repo });
    const rollup = status.json() as {
      counts: { emitted: number; planned: number };
      nodes: NodeRow[];
    };
    expect(rollup.counts.emitted).toBe(3);
    expect(rollup.counts.planned).toBe(0);
    for (const node of rollup.nodes) {
      expect(node.state).toBe('emitted');
      expect(node.issueRef).toBe(url);
    }

    // Idempotency: a re-emit files NOTHING and records zero new gh calls.
    const stub2 = installGhStub({ mode: 'record', issueUrl: url });
    const reemit = runCli(['program', 'emit', '--program', ID, '--execute'], {
      cwd: repo,
      env: ghStubEnv(stub2),
    });
    expect(reemit.code).toBe(0);
    expect(stub2.calls()).toHaveLength(0);
    const skipped = reemit.json() as { notice: string; skipped: Array<{ state: string }> };
    expect(skipped.notice).toContain('nothing to emit');
    expect(skipped.skipped.map((s) => s.state)).toEqual(['emitted', 'emitted', 'emitted']);
  });

  it('reconcile --execute advances emitted nodes to done when their GitHub issue is CLOSED (#87)', () => {
    const repo = freshOverlay();
    withTracker(repo, 'enforce');
    const spec = writeSpec(repo, TWO_NODE_SPEC);
    const url = 'https://github.com/kernloop-e2e/sandbox/issues/501';
    runCli(['program', 'create', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID], {
      cwd: repo,
    });
    // Emit so both nodes are `emitted` with refs recorded in the ledger.
    const emitStub = installGhStub({ mode: 'record', issueUrl: url });
    const emitted = runCli(['program', 'emit', '--program', ID, '--execute'], {
      cwd: repo,
      env: ghStubEnv(emitStub),
    });
    expect(emitted.code).toBe(0);

    // Reconcile against a GitHub where the issues are CLOSED → nodes advance to done.
    const viewStub = installGhStub({ mode: 'record', issueState: 'CLOSED' });
    const reconciled = runCli(['program', 'reconcile', '--program', ID, '--execute'], {
      cwd: repo,
      env: ghStubEnv(viewStub),
    });
    expect(reconciled.code).toBe(0);
    const rep = reconciled.json() as { mode: string; checked: number; advanced: number };
    expect(rep.mode).toBe('execute');
    // The umbrella root + 2 children are all emitted, so all 3 are reconciled.
    expect(rep.checked).toBe(3);
    expect(rep.advanced).toBe(3);
    // The reconcile spawned `gh issue view --json number,state` per node.
    const viewCalls = viewStub.calls();
    expect(viewCalls).toHaveLength(3);
    for (const argv of viewCalls) {
      expect(argv.slice(0, 2)).toEqual(['issue', 'view']);
      expect(argv).toContain('--json');
      expect(argv).toContain('number,state');
    }

    // The ledger now shows every node done.
    const status = runCli(['program', 'status', '--program', ID], { cwd: repo });
    const rollup = status.json() as { counts: { done: number; emitted: number } };
    expect(rollup.counts.done).toBe(3);
    expect(rollup.counts.emitted).toBe(0);
  });

  it('the audit chain is valid across the run and never leaks a goal verbatim', () => {
    const repo = freshOverlay();
    withTracker(repo, 'enforce');
    const spec = writeSpec(repo, TWO_NODE_SPEC);
    const stub = installGhStub({ mode: 'record' });
    const env = ghStubEnv(stub);

    runCli(['program', 'decompose', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID], {
      cwd: repo,
    });
    runCli(['program', 'create', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID], {
      cwd: repo,
    });
    runCli(['program', 'emit', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID, '--execute'], {
      cwd: repo,
      env,
    });
    runCli(
      [
        'program',
        'advance',
        '--program',
        ID,
        '--node',
        'prog.1',
        '--state',
        'emitted',
        '--ref',
        'https://github.com/kernloop-e2e/sandbox/issues/1',
      ],
      { cwd: repo },
    );
    runCli(['program', 'status', '--program', ID], { cwd: repo });

    const verify = runCli(['audit', '--op', 'verify'], { cwd: repo });
    expect(verify.code).toBe(0);
    expect((verify.json() as { result: { ok: boolean } }).result.ok).toBe(true);

    const types = new Set(auditEvents(repo).map((e) => e.type));
    for (const t of [
      'cli.program.decompose',
      'cli.program.create',
      'cli.program.status',
      'cli.program.advance',
      'cli.program.emit',
    ]) {
      expect(types).toContain(t);
    }
    // Neither the program goal nor any node goal is ever written verbatim.
    const text = auditText(repo);
    expect(text).not.toContain(PROGRAM_GOAL);
    expect(text).not.toContain('Build the auth module');
  });

  it('fails closed with a NONZERO exit on real error paths (not just exit 0)', () => {
    // The clean-error JSON is written to STDERR with exit code 1 (not stdout/0).
    const errOf = (r: { stderr: string }): string =>
      (JSON.parse(r.stderr) as { error: string }).error;
    // (a) emit --execute with no tracker configured → a clean exit 1, not a
    // crash/0 (a pure dry-run previews without a tracker since #94; only an
    // actual --execute requires the block).
    const repo = freshOverlay();
    const spec = writeSpec(repo, TWO_NODE_SPEC);
    const noTracker = runCli(
      ['program', 'emit', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID, '--execute'],
      {
        cwd: repo,
      },
    );
    expect(noTracker.code).toBe(1);
    expect(errOf(noTracker)).toBe('ProgramInputError');

    // (b) status of a program that was never created → a clean exit 1.
    const unknown = runCli(['program', 'status', '--program', 'never-made'], { cwd: repo });
    expect(unknown.code).toBe(1);
    expect(errOf(unknown)).toBe('ProgramInputError');
  });
});
