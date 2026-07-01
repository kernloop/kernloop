import { describe, it, expect } from 'vitest';
import {
  buildBody,
  assertMessagesValid,
  assertMaxTokens,
  ChatMessageSchema,
  MessagesSchema,
  API_MAX_TOKENS_CEILING,
  MAX_MESSAGES,
  MAX_MESSAGE_CONTENT_CHARS,
  type ChatMessage,
} from './api-body.js';
import { AdapterRequestError } from './errors.js';
import type { ApiInvocation } from './api.js';

// #510: the api adapter's request-body assembly. These pin the two behaviours
// #509's vote panel depends on: a caller-supplied system/user/assistant array is
// sent VERBATIM, and an absent/empty array falls back to the single user message
// so every existing caller is byte-for-byte unchanged.

const base: ApiInvocation = { prompt: 'hello', model: 'm', maxTokens: 256, timeoutMs: 1_000 };

describe('buildBody — messages array vs single-user fallback', () => {
  it('falls back to a single user message from prompt when messages is absent', () => {
    const body = JSON.parse(buildBody(base)) as Record<string, unknown>;
    expect(body['messages']).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body['model']).toBe('m');
    expect(body['max_tokens']).toBe(256); // ALWAYS present (spend ceiling)
    expect('reasoning_effort' in body).toBe(false);
  });

  it('sends a caller-supplied system+user array verbatim (not the prompt fallback)', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a voter.' },
      { role: 'user', content: 'Approve or reject: <proposal>' },
    ];
    const body = JSON.parse(buildBody({ ...base, messages })) as Record<string, unknown>;
    expect(body['messages']).toEqual(messages);
  });

  it('serializes an assistant-bearing multi-turn array unchanged and in order', () => {
    // The contrarian/architect condition: prove the assistant role is pure
    // pass-through DATA (no per-role branch), not an unwired path.
    const messages: ChatMessage[] = [
      { role: 'system', content: 'persona' },
      { role: 'user', content: 'turn 1' },
      { role: 'assistant', content: 'reply 1' },
      { role: 'user', content: 'turn 2' },
    ];
    const body = JSON.parse(buildBody({ ...base, messages })) as Record<string, unknown>;
    expect(body['messages']).toEqual(messages); // order + content byte-identical
  });

  it('falls back to the prompt when messages is an empty array (belt-and-suspenders)', () => {
    const body = JSON.parse(buildBody({ ...base, messages: [] })) as Record<string, unknown>;
    expect(body['messages']).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('rides reasoning_effort when the served model resolved one', () => {
    const body = JSON.parse(buildBody({ ...base, effort: 'high' })) as Record<string, unknown>;
    expect(body['reasoning_effort']).toBe('high');
  });

  it('sends the configured max_tokens (per-endpoint ceiling threads through)', () => {
    const body = JSON.parse(buildBody({ ...base, maxTokens: 32_000 })) as Record<string, unknown>;
    expect(body['max_tokens']).toBe(32_000);
  });
});

describe('assertMessagesValid — fail-closed message-shape guard', () => {
  it('is a no-op when messages is undefined (the fallback path)', () => {
    expect(() => assertMessagesValid('ep', undefined)).not.toThrow();
  });

  it('accepts a valid non-empty array', () => {
    expect(() => assertMessagesValid('ep', [{ role: 'system', content: 'x' }])).not.toThrow();
  });

  it('rejects an empty array (a provided-but-empty array is malformed, not a fallback)', () => {
    expect(() => assertMessagesValid('ep', [])).toThrow(AdapterRequestError);
  });

  it('rejects an unknown role', () => {
    const bad = [{ role: 'tool', content: 'x' }] as unknown as ChatMessage[];
    expect(() => assertMessagesValid('ep', bad)).toThrow(AdapterRequestError);
  });

  it('rejects empty content (an empty turn is a malformed request)', () => {
    expect(() => assertMessagesValid('ep', [{ role: 'user', content: '' }])).toThrow(
      AdapterRequestError,
    );
  });

  it('names the endpoint and the messages field in the typed error', () => {
    const err = (() => {
      try {
        assertMessagesValid('my-endpoint', []);
      } catch (e) {
        return e as AdapterRequestError;
      }
      throw new Error('expected throw');
    })();
    expect(err).toBeInstanceOf(AdapterRequestError);
    expect(err.message).toContain('my-endpoint');
    expect(err.message).toContain('messages');
  });
});

describe('assertMaxTokens — kernel-side spend ceiling (#510 MED-1)', () => {
  it('accepts a positive integer within the ceiling', () => {
    expect(() => assertMaxTokens('ep', 4_096)).not.toThrow();
    expect(() => assertMaxTokens('ep', API_MAX_TOKENS_CEILING)).not.toThrow();
  });

  it('rejects a non-positive or non-integer value', () => {
    expect(() => assertMaxTokens('ep', 0)).toThrow(AdapterRequestError);
    expect(() => assertMaxTokens('ep', -1)).toThrow(AdapterRequestError);
    expect(() => assertMaxTokens('ep', 4096.5)).toThrow(AdapterRequestError);
    expect(() => assertMaxTokens('ep', Number.POSITIVE_INFINITY)).toThrow(AdapterRequestError);
    expect(() => assertMaxTokens('ep', Number.NaN)).toThrow(AdapterRequestError);
  });

  it('rejects a value above the hard ceiling regardless of caller (not only overlay parse)', () => {
    // MED-1: the ceiling is a kernel invariant, so a producer that builds an
    // ApiInvocation directly (bypassing the overlay clamp) still can't inflate it.
    expect(() => assertMaxTokens('ep', API_MAX_TOKENS_CEILING + 1)).toThrow(AdapterRequestError);
    expect(() => assertMaxTokens('ep', 1_000_000_000)).toThrow(AdapterRequestError);
  });
});

describe('MessagesSchema — defence-in-depth input caps (#510 MED-2)', () => {
  it('rejects more than MAX_MESSAGES messages', () => {
    const many = Array.from({ length: MAX_MESSAGES + 1 }, () => ({
      role: 'user' as const,
      content: 'x',
    }));
    expect(MessagesSchema.safeParse(many).success).toBe(false);
    expect(() => assertMessagesValid('ep', many)).toThrow(AdapterRequestError);
  });

  it('accepts exactly MAX_MESSAGES', () => {
    const ok = Array.from({ length: MAX_MESSAGES }, () => ({
      role: 'user' as const,
      content: 'x',
    }));
    expect(MessagesSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects a message whose content exceeds MAX_MESSAGE_CONTENT_CHARS', () => {
    const huge = 'a'.repeat(MAX_MESSAGE_CONTENT_CHARS + 1);
    expect(ChatMessageSchema.safeParse({ role: 'user', content: huge }).success).toBe(false);
  });
});

describe('ChatMessageSchema — the OpenAI-compatible role set', () => {
  it.each(['system', 'user', 'assistant'] as const)('accepts role %s', (role) => {
    expect(ChatMessageSchema.safeParse({ role, content: 'x' }).success).toBe(true);
  });
  it('rejects an extra property (strict object)', () => {
    expect(ChatMessageSchema.safeParse({ role: 'user', content: 'x', name: 'bob' }).success).toBe(
      false,
    );
  });
});
