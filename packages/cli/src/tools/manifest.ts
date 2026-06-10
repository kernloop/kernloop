/**
 * `manifest` — registry view/ack (spec §3.4): list, get, or register
 * manifests in the kernel's ManifestRegistry (the single source of
 * capability truth, spec §3.1). Registration zod-validates through the
 * registry itself and is audited kernel-side.
 */
import { z } from 'zod';
import { ManifestSchema, type Manifest } from '@kernloop/contracts';
import type { Kernloop } from '../kernel.js';

/** Input to the `manifest` tool — a discriminated op. */
export const ManifestInputSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('list') }),
  z.strictObject({
    op: z.literal('get'),
    name: z.string().min(1),
    version: z.string().min(1).optional(),
  }),
  z.strictObject({ op: z.literal('register'), manifest: ManifestSchema }),
]);
export type ManifestInput = z.input<typeof ManifestInputSchema>;

/** What `manifest` returns, per op. */
export type ManifestResult =
  | { op: 'list'; manifests: Manifest[] }
  | { op: 'get'; found: true; manifest: Manifest }
  | { op: 'get'; found: false; name: string }
  | { op: 'register'; registered: Manifest };

/** The `manifest` tool. See module docs. */
export function manifestTool(kern: Kernloop, input: ManifestInput): ManifestResult {
  const parsed = ManifestInputSchema.parse(input);
  switch (parsed.op) {
    case 'list':
      return { op: 'list', manifests: kern.registry.list() };
    case 'get': {
      const manifest = kern.registry.get(parsed.name, parsed.version);
      return manifest === undefined
        ? { op: 'get', found: false, name: parsed.name }
        : { op: 'get', found: true, manifest };
    }
    case 'register':
      return { op: 'register', registered: kern.registry.register(parsed.manifest) };
  }
}
