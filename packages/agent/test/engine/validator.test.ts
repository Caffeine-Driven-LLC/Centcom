import { describe, expect, it } from 'vitest';
import { EventStreamValidator, ProviderError, validated } from '../../src/index.js';
import type { EventBody } from '../../src/types.js';
import { APR, START, mk, reset, stream } from './helpers.js';

const run = (bodies: EventBody[], seqs?: number[]) => { reset(); const v = new EventStreamValidator('fake'); bodies.forEach((b, i) => v.check(mk(b, seqs ? seqs[i] : i + 1))); v.end(); };
const T: EventBody = { type: 'turn.started', turn_id: 't' }; const D: EventBody = { type: 'turn.done', outcome: 'ok' };
const tool = (id = 'a'): EventBody => ({ type: 'tool.requested', tool_id: id, name: 'Read', input_summary: '', risk: 'low' }); const res = (id = 'a'): EventBody => ({ type: 'tool.result', tool_id: id, status: 'ok', summary: '' });
const delta = (m = 'm1'): EventBody => ({ type: 'text.delta', message_id: m, index: 0, text: 'x' }); const done = (m = 'm1'): EventBody => ({ type: 'text.done', message_id: m });

describe('EventStreamValidator', () => {
  it('accepts a complete turn with tools, approvals and text', () => { expect(() => run([START, T, delta(), done(), tool(), { type: 'approval.requested', approval_id: APR, tool_id: 'a', summary: '', risk: 'low' }, { type: 'approval.resolved', approval_id: APR, decision: 'approve', scope: 'once', by: 'user' }, res(), D])).not.toThrow(); });
  it.each<[string, EventBody[], number[]?]>([
    ['tool.result without a tool.requested', [START, T, res(), D]], ['two turn.done in one turn', [START, T, D, D]], ['text.delta after text.done of the same message', [START, T, delta(), done(), delta(), D]],
    ['seq that is not previous+1', [START, T, D], [1, 2, 4]], ['seq not starting at 1', [START], [2]], ['a tool left open at turn.done', [START, T, tool(), D]], ['an approval left open at turn.done', [START, T, { type: 'approval.requested', approval_id: APR, tool_id: 'a', summary: '', risk: 'low' }, D]],
    ['a text message not closed at turn.done', [START, T, delta(), D]], ['approval.resolved without a request', [START, T, { type: 'approval.resolved', approval_id: APR, decision: 'deny', scope: 'once', by: 'user' }, D]], ['text before session.started', [T, delta(), done(), D]],
    ['a second session.started', [START, START]], ['a fatal error not followed by turn.done error', [START, T, { type: 'error', code: 'provider_protocol_error', tool_message: '', fatal: true }, delta()]], ['a fatal error followed by turn.done ok', [START, T, { type: 'error', code: 'provider_protocol_error', tool_message: '', fatal: true }, D]],
    ['duplicate tool.requested', [START, T, tool(), tool()]], ['a stream that ends inside a turn', [START, T]],
  ])('rejects %s with provider_protocol_error', (_n, bodies, seqs) => { try { run(bodies, seqs); throw new Error('did not throw'); } catch (e) { expect(e).toBeInstanceOf(ProviderError); expect((e as ProviderError).code).toBe('provider_protocol_error'); } });
  it('a fatal error followed by turn.done error is fine, and status/warnings may sit in between', () => { expect(() => run([START, T, { type: 'error', code: 'provider_protocol_error', tool_message: '', fatal: true }, { type: 'status', state: 'error' }, { type: 'turn.done', outcome: 'error' }])).not.toThrow(); });
  it('tolerates unknown event types and neutral events', () => { expect(() => run([START, T, { type: 'brand.new' } as never, { type: 'usage.report', input_tokens: 1, output_tokens: 1, cost_is_estimate: true } as never, { type: 'status', state: 'x' }, D])).not.toThrow(); });
  it('validated() checks a stream as it flows and stops at the first violation', async () => {
    const seen: number[] = []; await expect((async () => { for await (const e of validated((async function* () { for (const e of stream([START, T, res()])) yield e; })())) seen.push(e.seq); })()).rejects.toMatchObject({ code: 'provider_protocol_error' }); expect(seen).toEqual([1, 2]);
  });
});
