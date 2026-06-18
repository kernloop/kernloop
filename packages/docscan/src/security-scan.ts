/**
 * Built-in, MODEL-FREE security smell scanner (#277, P2 AppSec / spec §5.3) — the
 * quality gate's first security signal over MODEL-GENERATED deliverable code,
 * which otherwise ships with ZERO security check (a model can write
 * `eval(userInput)` or commit an API key and pass clean). Ratified Option C
 * (consensus_vote): ALWAYS-ON (no external binary, so it never degrades to
 * no-signal — the fail-open posture the constitution forbids) over a CURATED
 * HIGH-CONFIDENCE, LOW-FALSE-POSITIVE ruleset. It is NOT a general SAST and makes
 * no completeness claim — it flags a small set of high-signal smells:
 *  - DYNAMIC CODE EXECUTION: `eval(x)` / `new Function(…, body)` where the
 *    argument is NOT a string literal (a literal is the safe, intentional form).
 *  - SHELL COMMAND INJECTION: `exec(x)` / `execSync(x)` (the SHELL-invoking
 *    child_process family — NOT the safe argv-array `spawn`/`execFile`) with a
 *    non-literal command, in a file that imports `child_process`.
 *  - HARDCODED SECRETS: known-FORMAT credentials (AWS/GitHub/Google/Slack keys,
 *    PEM private keys) — formats, not entropy, to keep false positives near zero.
 *
 * Reads source as DATA via the AST + regex; it NEVER executes the scanned code,
 * runs IN-PROCESS (no model, no network), and reuses the shared no-symlink-follow
 * {@link walkFiles} + byte budgets so an untrusted workspace cannot escape the
 * tree or OOM the loop. Findings are advisory (the faculty-gates manifest tier);
 * promotion to enforce is a separate evidence-gated ratification.
 *
 * @module docscan/security-scan
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Finding } from '@kernloop/contracts';
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, walkFiles } from './fs-walk.js';

/** Extensions parsed with the TS compiler API for the code-execution rules. */
const CODE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/** Extensions the secret-format scan reads (code + common config/text). */
const TEXT_EXTS = new Set([
  ...CODE_EXTS,
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.env',
  '.txt',
  '.md',
  '.sh',
  '.properties',
]);

/** Known-FORMAT credential patterns (format-anchored, so false positives are near zero). */
const SECRET_PATTERNS: ReadonlyArray<{ readonly re: RegExp; readonly label: string }> = [
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key id' },
  { re: /\bgh[posru]_[A-Za-z0-9]{36}\b/, label: 'GitHub token' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, label: 'Google API key' },
  { re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/, label: 'Slack token' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, label: 'PEM private key' },
];

/** A `path:line` locator and the 1-based line for a byte offset in `text`. */
function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/** True when `node` is a plain string literal — the SAFE, intentional argument form. */
function isLiteralString(node: ts.Node | undefined): boolean {
  return (
    node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  );
}

/** The shell-invoking child_process call names (argv-array `spawn`/`execFile` are SAFE, excluded). */
const SHELL_EXEC_NAMES = new Set(['exec', 'execSync']);

/**
 * Max AST depth the visitor descends — bounds its own recursion so a crafted
 * deeply-nested file (which TS parses but whose tree is thousands deep) cannot
 * overflow the stack and crash the in-process gate. Far deeper than any real
 * eval/exec nesting; deeper nodes are simply not scanned (#277 security round).
 */
const MAX_AST_DEPTH = 1_500;

/** The callee's simple name for an `exec`-style call, or null if it is not one we score. */
function execCalleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text; // destructured: `exec(...)`
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text; // member: `cp.exec(...)`
  return null;
}

/** Push a finding for a flagged AST call (eval / new Function / exec) with a non-literal arg. */
function codeFinding(severity: Finding['severity'], message: string, loc: string): Finding {
  return { severity, message, path: loc };
}

/** The finding for ONE node if it matches a code rule (eval / new Function / exec), else null. */
function nodeFinding(node: ts.Node, loc: string, importsChildProcess: boolean): Finding | null {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'eval'
  ) {
    if (!isLiteralString(node.arguments[0]))
      return codeFinding(
        'error',
        'dynamic code execution: eval() with a non-literal argument',
        loc,
      );
  } else if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'Function'
  ) {
    const body = node.arguments?.[node.arguments.length - 1];
    if (node.arguments !== undefined && !isLiteralString(body))
      return codeFinding(
        'error',
        'dynamic code execution: new Function() with a non-literal body',
        loc,
      );
  } else if (ts.isCallExpression(node) && importsChildProcess) {
    const name = execCalleeName(node);
    if (name !== null && SHELL_EXEC_NAMES.has(name) && !isLiteralString(node.arguments[0]))
      return codeFinding(
        'error',
        `shell command from a non-literal (possible injection): ${name}()`,
        loc,
      );
  }
  return null;
}

/** AST rules: dynamic code execution + shell-command injection with a non-literal argument. */
function scanCodeAst(text: string, rel: string): Finding[] {
  const findings: Finding[] = [];
  const importsChildProcess = /['"](?:node:)?child_process['"]/.test(text);
  let source: ts.SourceFile;
  try {
    source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  } catch {
    return findings; // unparseable generated code → no code findings (secrets still scanned)
  }
  const visit = (node: ts.Node, depth: number): void => {
    // Bound the recursion: TS parses a pathological deep chain (`a.b.b.b…`,
    // `a()()()…`) into an AST thousands deep that would overflow THIS visit's
    // stack — past the cap we stop descending (a real eval/exec is never nested
    // that deep). Deterministic, so it never RangeErrors out of the gate (#277
    // security round). The try around visit() below is defense-in-depth.
    if (depth > MAX_AST_DEPTH) return;
    const loc = `${rel}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    const finding = nodeFinding(node, loc, importsChildProcess);
    if (finding !== null) findings.push(finding);
    ts.forEachChild(node, (child) => visit(child, depth + 1));
  };
  try {
    visit(source, 0);
  } catch {
    // Defense in depth: any throw from the parser/visitor (a deeper-than-expected
    // construct, a TS API edge) degrades to the findings collected so far — the
    // in-process gate must NEVER crash on one crafted file (#277 security round).
  }
  return findings;
}

/** Secret rules: known-format hardcoded credentials, one finding per pattern per file. */
function scanSecrets(text: string, rel: string): Finding[] {
  const findings: Finding[] = [];
  for (const { re, label } of SECRET_PATTERNS) {
    const match = re.exec(text);
    if (match !== null)
      findings.push({
        severity: 'error',
        message: `hardcoded secret: a ${label} appears in source — move it to an env var / secret store`,
        path: `${rel}:${lineOf(text, match.index)}`,
      });
  }
  return findings;
}

/**
 * Scan a model-generated workspace for high-confidence security smells (#277,
 * CLM-0132): dynamic code execution, shell-command injection, and known-format
 * hardcoded secrets. Always returns Findings (never throws); a curated,
 * low-false-positive signal, NOT exhaustive SAST. Reads at most {@link
 * MAX_FILE_BYTES} per file and {@link MAX_TOTAL_BYTES} overall, following no
 * symlinks.
 */
export function scanSecuritySmells(workspaceDir: string): Finding[] {
  const findings: Finding[] = [];
  let total = 0;
  for (const file of walkFiles(workspaceDir)) {
    const ext = path.extname(file);
    if (!TEXT_EXTS.has(ext)) continue;
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_BYTES || total + size > MAX_TOTAL_BYTES) continue;
    total += size;
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(workspaceDir, file);
    if (CODE_EXTS.has(ext)) findings.push(...scanCodeAst(text, rel));
    findings.push(...scanSecrets(text, rel));
  }
  return findings;
}
