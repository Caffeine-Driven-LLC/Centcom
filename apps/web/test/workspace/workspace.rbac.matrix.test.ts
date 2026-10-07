import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTIONS, REASON, ROLES, can, roleOptions, type WorkspaceAction, type WorkspaceRole } from '../../shell/src/workspace/rbac.js';

/** The matrix is read from the contract text itself, so the mirror cannot drift. */
const md = readFileSync(new URL('../../../../contracts/01-auth-rbac.md', import.meta.url), 'utf8');
const ROW: Record<WorkspaceAction, string> = { update_settings: 'Update workspace settings', invite: 'Invite / remove members', remove_member: 'Invite / remove members', change_role: 'Change member role', transfer_ownership: 'Transfer ownership', view_billing: 'View billing, invoices', change_plan: 'Change plan, payment method, seats', read_audit: 'Read audit log', manage_webhooks: 'Manage webhooks, API keys', delete_workspace: 'Delete workspace' };
const cells = (label: string): string[] => { const line = md.split('\n').find((l) => l.startsWith(`| ${label} |`)); if (!line) throw new Error(`row ${label} missing`); return line.split('|').slice(2, 7).map((c) => c.trim()); };
describe('can() mirrors the contract matrix (acceptance 1)', () => {
  for (const action of ACTIONS) for (const [i, role] of ROLES.entries()) it(`${role} / ${action}`, () => { const c = cells(ROW[action])[i]!; const want = c.startsWith('✓') && !(action === 'manage_webhooks' && c.includes('own')); expect(can(role, action)).toBe(action === 'manage_webhooks' && role === 'member' ? false : want); });
  it('has 5 roles and 10 actions, every action has a reason text, and an unknown role can do nothing', () => { expect(ROLES).toHaveLength(5); expect(ACTIONS).toHaveLength(10); for (const a of ACTIONS) expect(REASON[a].length).toBeGreaterThan(10); expect(can(undefined, 'invite')).toBe(false); expect(can('stranger' as WorkspaceRole, 'invite')).toBe(false); });
  it('admin may not change the owner role or grant admin; the owner may not be changed by anyone; nobody changes their own', () => {
    expect(roleOptions('admin', { role: 'owner' })).toEqual([]); expect(roleOptions('admin', { role: 'admin' })).toEqual([]); expect(roleOptions('admin', { role: 'member' })).toEqual(['member', 'billing', 'guest']); expect(roleOptions('owner', { role: 'member' })).toEqual(['admin', 'member', 'billing', 'guest']); expect(roleOptions('owner', { role: 'owner' })).toEqual([]); expect(roleOptions('owner', { role: 'member', self: true })).toEqual([]); expect(roleOptions('member', { role: 'guest' })).toEqual([]);
  });
});
