/** The workspace permission matrix of CT-RBAC, for the UI only: it hides and disables controls, the server decides. */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'billing' | 'guest';
export type WorkspaceAction = 'update_settings' | 'invite' | 'remove_member' | 'change_role' | 'transfer_ownership' | 'view_billing' | 'change_plan' | 'read_audit' | 'manage_webhooks' | 'delete_workspace';
export const ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'member', 'billing', 'guest'];
export const ACTIONS: readonly WorkspaceAction[] = ['update_settings', 'invite', 'remove_member', 'change_role', 'transfer_ownership', 'view_billing', 'change_plan', 'read_audit', 'manage_webhooks', 'delete_workspace'];
const M: Record<WorkspaceAction, readonly WorkspaceRole[]> = {
  update_settings: ['owner', 'admin'], invite: ['owner', 'admin'], remove_member: ['owner', 'admin'], change_role: ['owner', 'admin'], transfer_ownership: ['owner'], view_billing: ['owner', 'admin', 'billing'], change_plan: ['owner', 'billing'], read_audit: ['owner', 'admin'], manage_webhooks: ['owner', 'admin'], delete_workspace: ['owner'],
};
export const can = (role: WorkspaceRole | undefined, action: WorkspaceAction): boolean => !!role && M[action].includes(role);
/** Why a control is off, for its tooltip. */
export const REASON: Record<WorkspaceAction, string> = { update_settings: 'Only owners and admins can change settings.', invite: 'Only owners and admins can invite people.', remove_member: 'Only owners and admins can remove members.', change_role: 'Only owners and admins can change roles.', transfer_ownership: 'Only the owner can transfer ownership.', view_billing: 'Billing is for owners, admins and the billing role.', change_plan: 'Only the owner and the billing role can change the plan.', read_audit: 'Only owners and admins can read the audit log.', manage_webhooks: 'Only owners and admins can manage webhooks.', delete_workspace: 'Only the owner can delete the workspace.' };
/** Which role changes the actor may make to a member: an admin cannot touch the owner, cannot grant or remove admin, and nobody changes their own role here. */
export function roleOptions(actor: WorkspaceRole | undefined, target: { role: WorkspaceRole; self?: boolean }): WorkspaceRole[] {
  if (!can(actor, 'change_role') || target.self || target.role === 'owner') return [];
  return actor === 'owner' ? ['admin', 'member', 'billing', 'guest'] : target.role === 'admin' ? [] : ['member', 'billing', 'guest'];
}
