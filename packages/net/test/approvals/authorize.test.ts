import { describe, expect, it } from 'vitest';
import { authorize, type MemberInfo } from '../../src/index.js';

const m = (id: string, role: MemberInfo['role']): MemberInfo => ({ id, role, slot: 0 });
const base = { requester: 'mem_R', policy: {}, hostId: 'mem_H', owners: new Set<string>() };
const ok = (decider: MemberInfo | undefined, approver: string, extra: Partial<Parameters<typeof authorize>[0]> = {}) => authorize({ ...base, decider, approver, ...extra });

describe('who may decide (the matrix)', () => {
  it('the host always; nobody unknown; no viewer; nobody else for their own request', () => {
    for (const a of ['host', 'owner', 'any_editor']) { expect(ok(m('mem_H', 'host'), a)).toEqual({ ok: true }); expect(ok(m('mem_V', 'viewer'), a)).toEqual({ ok: false, reason: 'viewer' }); expect(ok(undefined, a)).toEqual({ ok: false, reason: 'unknown_member' }); expect(ok(m('mem_R', 'editor'), a)).toEqual({ ok: false, reason: 'requester' }); }
    expect(ok(m('mem_H', 'host'), 'host', { requester: 'mem_H' })).toEqual({ ok: true }); /* a host may answer its own agent */
  });
  it('approver host: editors cannot; approver any_editor: any editor can; approver owner: only the owners marked', () => {
    expect(ok(m('mem_E', 'editor'), 'host')).toEqual({ ok: false, reason: 'not_allowed' }); expect(ok(m('mem_E', 'editor'), 'any_editor')).toEqual({ ok: true }); expect(ok(m('mem_E', 'editor'), 'owner')).toEqual({ ok: false, reason: 'not_allowed' }); expect(ok(m('mem_E', 'editor'), 'owner', { owners: new Set(['mem_E']) })).toEqual({ ok: true });
    expect(ok(m('mem_E', 'editor'), 'something_new')).toEqual({ ok: false, reason: 'not_allowed' });
  });
  it('members listed in the policy may decide (delegated approvers), except viewers and the requester', () => {
    const policy = { approvers: ['mem_D', 'mem_V', 'mem_R'] }; expect(ok(m('mem_D', 'editor'), 'host', { policy })).toEqual({ ok: true }); expect(ok(m('mem_V', 'viewer'), 'host', { policy }).ok).toBe(false); expect(ok(m('mem_R', 'editor'), 'host', { policy }).ok).toBe(false);
  });
});
