/**
 * resolveServedFor (#271) — the ONE composition-root rule that maps a node's
 * {@link ModelRequirement} + a candidate adapter NAME to the {@link ServedModel}
 * that name will serve: a registered ENDPOINT id resolves on the api path
 * (resolveServedApi over its apiDefinitionFor), every other name on the CLI path
 * (resolveServed).
 *
 * This exists so the rule lives in exactly one place. The identity-fitness
 * selector's PREDICTION (loop/adapter-fitness.ts) and the loop's CALL-TIME
 * binding (loop/node-bind.ts) both call it, so `predicted == served` — the
 * honesty invariant CLM-0130 rests on — is guarded STRUCTURALLY by a shared
 * function, not by two hand-kept-identical copies that could silently drift
 * (the #270 review's standing concern). Pure: no I/O, no env read, no secret
 * (apiDefinitionFor carries the env-var NAME, never a key). Throws for a name
 * that resolves to neither (an unknown CLI adapter) — callers that tolerate that
 * (the selector) catch and score it neutral.
 *
 * @module cli/loop/resolve-served
 */
import { type AdapterName } from '@kernloop/kernel';
import type { ModelRequirement } from '@kernloop/contracts';
import { resolveServed, type ServedModel } from './node-seam.js';
import { resolveServedApi } from './api-seam.js';
import { apiDefinitionFor, type Endpoints } from '../endpoints.js';

/**
 * Resolve the {@link ServedModel} a candidate `name` serves `req` with: the api
 * path when `name` is a registered endpoint, else the CLI path. The single
 * source of truth for predicted==served (#271, CLM-0130). Throws (via
 * resolveServed) for an unknown CLI adapter name.
 */
export function resolveServedFor(
  req: ModelRequirement,
  name: string,
  endpoints: Endpoints,
): ServedModel {
  const endpoint = endpoints[name];
  return endpoint === undefined
    ? resolveServed(req, name as AdapterName)
    : resolveServedApi(req, apiDefinitionFor(name, endpoint));
}
