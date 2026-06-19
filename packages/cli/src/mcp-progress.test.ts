/**
 * The MCP progress-notification sink (#336 P1, CLM-0148). Asserts the SERVER
 * EMISSION contract — one `notifications/progress` per milestone, keyed to the
 * host's progressToken, monotonic counter, no faked `total` — and the two vote
 * conditions: a no-op when the host sent no token, and best-effort (a transport
 * failure never propagates). This tests EMISSION, not whether Claude Code
 * renders it (a client concern this unit cannot observe).
 */
import { describe, expect, it } from 'vitest';
import { makeProgressSink } from './mcp.js';

interface Notification {
  method: string;
  params: { progressToken: string | number; progress: number; message: string; total?: number };
}

describe('makeProgressSink (#336 P1)', () => {
  it('emits one notifications/progress per message with a monotonic counter and no total', () => {
    const sent: Notification[] = [];
    const sink = makeProgressSink(
      { sendNotification: (n) => void sent.push(n as Notification) },
      'tok-1',
    );
    expect(sink).toBeDefined();
    sink?.('routed → coder');
    sink?.('spend → $0.05');
    expect(sent).toEqual([
      {
        method: 'notifications/progress',
        params: { progressToken: 'tok-1', progress: 1, message: 'routed → coder' },
      },
      {
        method: 'notifications/progress',
        params: { progressToken: 'tok-1', progress: 2, message: 'spend → $0.05' },
      },
    ]);
    expect(sent[0]?.params.total).toBeUndefined(); // never fake a denominator
  });

  it('returns undefined (zero notifications) when the host sent no progressToken', () => {
    const sent: Notification[] = [];
    const sink = makeProgressSink(
      { sendNotification: (n) => void sent.push(n as Notification) },
      undefined,
    );
    expect(sink).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it('swallows a sendNotification failure — progress never breaks the tool call', () => {
    const thrower = makeProgressSink(
      {
        sendNotification: () => {
          throw new Error('transport down');
        },
      },
      'tok',
    );
    expect(() => thrower?.('x')).not.toThrow();
    const rejecter = makeProgressSink(
      { sendNotification: () => Promise.reject(new Error('nope')) },
      'tok',
    );
    expect(() => rejecter?.('y')).not.toThrow();
  });
});
