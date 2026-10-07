/** Who may send which kind of frame (CT-RBAC session actions and the catalogue of CT-WS-SESSION-EVENTS). Decided from the live roster, never from what a frame claims. */
export type Role = 'host' | 'editor' | 'viewer'; export type Mode = 'command_post' | 'branch';
export const HOST_ONLY = new Set(['queue.approve', 'queue.reject', 'queue.reorder', 'queue.drop', 'queue.claim', 'queue.done', 'control.kick', 'control.mute', 'control.unmute', 'control.role', 'control.transfer_host', 'control.end', 'control.policy', 'control.rotate_request']);
export const SERVER_ONLY = new Set(['queue.state', 'control.member_joined', 'control.member_left', 'control.roster', 'control.host_changed', 'control.session_state', 'control.rotate_key']);
/** The kinds the catalogue marks `host, editor*`: in a command post only the host sends them, in branch mode the agent's owner does too. */
export const AGENT_KINDS = new Set(['message.user', 'message.assistant.delta', 'message.assistant.done', 'message.system', 'tool.request', 'approval.request', 'tool.result', 'agent.spawn', 'agent.state', 'agent.exit', 'branch.update', 'file.lock', 'agent.handoff', 'conflict.detected', 'diff.share']);
export const VIEWER_OK = new Set(['reaction', 'comment.add']);
export type Verdict = 'ok' | 'forbidden';
export interface AuthInput { role: Role; kind: string; type: string; muted: boolean; locked: boolean; mode: Mode }
export function authorizeFrame(a: AuthInput): Verdict {
  if (a.type === 'presence') return a.role === 'viewer' && a.kind !== 'presence.update' ? 'forbidden' : 'ok'; /* presence is never blocked by a mute; a viewer may only say it is there */
  if (HOST_ONLY.has(a.kind)) return a.role === 'host' ? 'ok' : 'forbidden';
  if (a.role === 'viewer') return VIEWER_OK.has(a.kind) && !a.muted ? 'ok' : 'forbidden';
  if (a.muted && (a.type === 'event' || a.type === 'queue')) return 'forbidden';
  if (a.kind === 'queue.submit' && a.locked && a.role !== 'host') return 'forbidden';
  if (a.kind === 'approval.decision') return a.role === 'host' ? 'ok' : 'ok'; /* who exactly is decided against the request, in the approval router */
  if (AGENT_KINDS.has(a.kind) && a.mode === 'command_post' && a.role !== 'host') return 'forbidden';
  return 'ok';
}
