/**
 * Request-body assembly for the api adapter (#510, [CLM-0187]).
 *
 * The OpenAI-compatible `chat/completions` body: a caller-supplied `messages`
 * array (system / user / assistant roles) when present, else the single
 * user-message fallback assembled from `prompt` — so every existing caller (a
 * lone assembled prompt) is unchanged while a role-aware caller (#509's vote
 * panel: a system persona + a user proposal) can send a structured turn. The
 * bounded `max_tokens` spend-length ceiling is ALWAYS present, and
 * `reasoning_effort` rides when the served model resolved one.
 *
 * Split out of api.ts so the message-shape schema lives next to the body it
 * guards (and to keep api.ts within its LOC budget). The schema is the SINGLE
 * validation point the adapter's {@link module:kernel/adapters/api} calls before
 * egress — an empty array, an unknown role, or empty content is a fail-closed
 * typed error, never a silently malformed request.
 * @module kernel/adapters/api-body
 */
import { z } from 'zod';
import type { ApiInvocation } from './api.js';
import { AdapterRequestError } from './errors.js';

/**
 * Hard upper bound on any api-adapter `max_tokens` — the SINGLE source enforced
 * at BOTH boundaries: the overlay parse (endpoints.ts, which re-exports this) and
 * the kernel invocation check ({@link assertMaxTokens}). So neither a hostile
 * overlay nor a future {@link ApiInvocation} producer (#509) can inflate the
 * completion ceiling past a sane cap. 128k covers long-reasoning output windows.
 */
export const API_MAX_TOKENS_CEILING = 128_000;

/** Max messages in a caller-supplied array (#510) — defence-in-depth against an
 * unbounded request body (the response cap guards only the reply, `max_tokens`
 * only completion). Generous vs any real turn; run BUDGET [CLM-0077] is the
 * aggregate input-spend backstop. */
export const MAX_MESSAGES = 64;

/** Max characters in one message's `content` (#510, 256 KiB) — the per-message
 * half of the same unbounded-request-body defence as {@link MAX_MESSAGES}. */
export const MAX_MESSAGE_CONTENT_CHARS = 262_144;

/**
 * One chat message. Roles are the OpenAI-compatible set the adapter faithfully
 * forwards; `content` must be non-empty (an empty turn is a malformed request,
 * not a valid one) and bounded ({@link MAX_MESSAGE_CONTENT_CHARS}). `assistant`
 * is permitted so a caller MAY supply prior-turn context — the adapter serializes
 * whatever valid array it is given verbatim (one pass-through path, no per-role
 * branch); multi-turn conversation history has no loop producer yet (deferred, #522).
 */
export const ChatMessageSchema = z.strictObject({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1).max(MAX_MESSAGE_CONTENT_CHARS),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * A caller-supplied messages array: non-empty, at most {@link MAX_MESSAGES}, every
 * element a valid {@link ChatMessageSchema}. `.min(1)` makes an empty-array-if-provided
 * a fail-closed error rather than a silently empty request the body fallback would mask.
 */
export const MessagesSchema = z.array(ChatMessageSchema).min(1).max(MAX_MESSAGES);

/**
 * Fail-closed validation of a caller-supplied messages array, called by the
 * adapter's invocation check BEFORE the key read and any egress (an empty
 * array, unknown role, empty/oversized content, or too many messages is a typed
 * {@link AdapterRequestError}, never a malformed POST). A no-op when `messages`
 * is undefined (the fallback path).
 */
export function assertMessagesValid(adapter: string, messages: ApiInvocation['messages']): void {
  if (messages === undefined) return;
  const parsed = MessagesSchema.safeParse(messages);
  if (!parsed.success) {
    throw new AdapterRequestError(adapter, `messages: ${z.prettifyError(parsed.error)}`);
  }
}

/**
 * Fail-closed `max_tokens` guard: a positive integer within
 * {@link API_MAX_TOKENS_CEILING}. Enforced KERNEL-SIDE (not only at overlay
 * parse) so the completion ceiling holds regardless of which caller built the
 * invocation — the guarantee is a kernel invariant, not a config-layer courtesy.
 */
export function assertMaxTokens(adapter: string, maxTokens: number): void {
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new AdapterRequestError(adapter, 'maxTokens must be a positive integer (spend ceiling)');
  }
  if (maxTokens > API_MAX_TOKENS_CEILING) {
    throw new AdapterRequestError(
      adapter,
      `maxTokens ${String(maxTokens)} exceeds the hard ceiling ${String(API_MAX_TOKENS_CEILING)}`,
    );
  }
}

/**
 * Build the request body. Uses the caller's `messages` verbatim when present &
 * non-empty (validated upstream by {@link MessagesSchema} in the adapter's
 * invocation check, BEFORE this runs), else the single user-message fallback
 * from `prompt`. `max_tokens` is ALWAYS present (spend ceiling); the empty-array
 * guard here is belt-and-suspenders so a body is never silently message-less.
 */
export function buildBody(invocation: ApiInvocation): string {
  const messages =
    invocation.messages !== undefined && invocation.messages.length > 0
      ? invocation.messages
      : [{ role: 'user', content: invocation.prompt }];
  return JSON.stringify({
    model: invocation.model,
    messages,
    max_tokens: invocation.maxTokens,
    ...(invocation.effort === undefined ? {} : { reasoning_effort: invocation.effort }),
  });
}
