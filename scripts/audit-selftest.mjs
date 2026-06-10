import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { appendEvent, createAuditStore, verifyChain } from '@kernloop/kernel';

/**
 * CI audit self-test (seed Step 5): build a small chain, verify it, then
 * mutate it and assert verification fails. A green run proves the shipped
 * verifier catches tampering on this exact build — not just in unit tests.
 */
export function runSelfTest(dir) {
  const file = path.join(dir, 'audit.jsonl');
  const store = createAuditStore(file);
  const N = 25;
  for (let i = 1; i <= N; i++) {
    appendEvent(store, { type: 'selftest.event', payload: { i } });
  }

  const pristine = verifyChain(store, { expectedLength: N });
  if (!pristine.ok) return `pristine chain failed verification: ${pristine.reason}`;

  const original = fs.readFileSync(file);
  const mutated = Buffer.from(original);
  const mid = Math.floor(mutated.length / 2);
  mutated[mid] = mutated[mid] === 0x61 ? 0x62 : 0x61; // flip one byte
  fs.writeFileSync(file, mutated);
  const tampered = verifyChain(store, { expectedLength: N });
  if (tampered.ok) return 'tampered chain passed verification — verifier is broken';

  fs.writeFileSync(file, original);
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  fs.writeFileSync(file, lines.slice(0, N - 3).join('\n') + '\n');
  const truncated = verifyChain(store, { expectedLength: N });
  if (truncated.ok) return 'truncated chain passed verification with a length witness';

  return null;
}

export function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-audit-selftest-'));
  const failure = runSelfTest(dir);
  if (failure) {
    console.error(`audit-selftest ✗ ${failure}`);
    return 1;
  }
  console.log('audit-selftest ✓ chain verifies; bit-flip and truncation both detected');
  return 0;
}

/* v8 ignore start -- CLI entry guard; logic above is covered directly */
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  process.exit(main());
}
/* v8 ignore stop */
