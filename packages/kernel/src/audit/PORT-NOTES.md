# Port notes — v1 audit → kernel AuditChain

Port-by-evidence (spec §10 item 1, AGENTS.md "v1 as quarry") from
`nexus-substrate/nexus-agents` `packages/nexus-agents/src/audit/`. The v1
implementation and tests were read; nothing was copied wholesale and no v1
package is imported. This file records the deltas, file by file.

## v1 `audit-logger.ts` → `envelope.ts` + `store.ts` + `verify.ts`

**Kept (as evidence):**

- SHA-256 hash chain with `prevHash` linkage and a first-failure-wins
  verifier ("does NOT continue past the first failure, since one tamper
  invalidates everything downstream").
- Discriminated verification result (`ok: true | false` with a named reason
  and the failing position).
- Hash computed over the event content _including_ `prevHash`, excluding the
  event's own `hash`.

**Changed:**

- v1 hashed only a subset of fields (`id, timestamp, category, action,
outcome, actor, previousHash`) via `JSON.stringify` of an object literal —
  payload/metadata edits were invisible to the hash, and hashing depended on
  key insertion order. Kernloop hashes **every field** of the envelope
  (minus `hash`) over a **documented canonical serialization** (sorted keys,
  recursive — `canonical.ts`), so any field edit breaks the hash and the
  canonical form is reproducible by independent implementations.
- v1's `ChainVerification` had three reasons (`hash_mismatch`,
  `previous_hash_mismatch`, `missing_hash`). Kernloop has six:
  `hash_mismatch`, `prev_hash_mismatch`, plus `malformed_line`,
  `invalid_envelope`, `seq_mismatch`, `length_mismatch`. `missing_hash` is
  gone because un-hashed envelopes cannot exist (see below); `seq` +
  `expectedLength` add deletion/reorder/truncation detection that v1's
  in-memory verifier could not express.
- v1 `previousHash` was `undefined` for the first event. Kernloop uses a
  documented genesis constant (`GENESIS_PREV_HASH`, 64 zero hex chars) so the
  first envelope is structurally identical to every other and absence of
  linkage is never encoded as a missing field.
- v1 verified an in-memory `AuditEvent[]`; kernloop's `verifyChain` verifies
  the **stored JSONL file** — what is on disk is what is checked.
- Monotonic `seq` added to the envelope (not in v1): detects line deletion,
  duplication, and reordering even where prev-hash linkage alone would
  report a less precise signal.
- Synchronous append (no queue): an audit append completes or throws before
  the action proceeds (constitutional rule 7, "no silent actions").

**Dropped (P0 scope; reason):**

- `enableHashChain: false` mode and legacy un-chained compat — kernloop
  chains are always on; an unverifiable audit log violates spec §3.1.
- `AuditLogger` class, severity/category filtering, convenience methods
  (`logToolInvocation`, `logPolicyDecision`, …), buffered queue +
  flush-timer + drop-oldest backpressure, system actor — v1's logger served
  a resident MCP server; P0 ships plain library functions (`appendEvent` /
  `verifyChain`). The MCP `audit` tool wraps these in P1.
- Random event ids (`aud_<ts>_<rand>`) — `seq` + `hash` identify an envelope;
  random ids added nondeterminism without integrity value.

## v1 `audit-types.ts` → `envelope.ts`

- Kept: zod-validated event schema; SIEM-aligned "each line is
  self-contained JSON".
- Changed: v1's wide taxonomy (category/severity/outcome/actor/resource +
  12 optional correlation fields) collapses to the minimal envelope
  `{seq, ts, contractsVersion, type, payload, prevHash, hash}` — all fields
  required, `.strict()`. Structured detail lives in `payload`; taxonomy can
  return via contracts when a claim pulls it.
- Added: `contractsVersion` stamped from `@kernloop/contracts` on every
  envelope (seed Step 4), validated as semver.

## v1 `audit-storage.ts` → `store.ts`

- Kept: JSONL, one JSON event per line, append-mode writes.
- Dropped: file rotation/pruning (rotation breaks a single verifiable chain;
  retention policy is a future claim), path-traversal validation layer
  (kernloop stores write where the caller — kernel/CLI — points them; v1
  hardened a server boundary that does not exist in P0), write streams +
  buffering (sync `appendFileSync` is the durability-first choice), and the
  whole `query()` surface (the `audit` MCP tool's job, P1).

## v1 tests → `*.test.ts` here

- `audit-chain-verify.test.ts` cases carried over and re-targeted at the
  stored file: clean-chain ok, tamper-without-rehash → hash mismatch,
  mid-chain deletion → broken linkage/seq, first-failure-wins, failure
  identifies the position. The "legacy un-chained log passes" case is
  deliberately **inverted**: such a log now fails `invalid_envelope`.
- Added beyond v1: truncation via `expectedLength`, reorder, forged-rehash
  (edit + recompute hash, downstream linkage breaks), bad
  `contractsVersion` format, malformed lines, and a seeded property test
  (any single-byte mutation anywhere in the file fails verification).
