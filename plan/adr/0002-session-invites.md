# ADR 0002: invite one person to one session without a seat

Status: proposed (contract PR, needs one approver from each side) · Lane: B105 (backend), client follow-up in the apps

## Context
Free has no relay; Pro has `max_seats: 1`; Team has 5. A workspace invite makes the person a member, which uses a seat for owner, admin and member roles. So on Pro a host cannot bring a collaborator who has an account into a session at all, and the pricing decision is "the host pays, collaborators join free". Share-link guests are viewers only and need no account, so they do not cover editors.

## Options
a. **Session invites**: an invite for one session, role `editor` or `viewer`, accepted by a signed-in user, no workspace membership.
b. Let the workspace `guest` role join sessions as an editor. This changes the meaning of `guest` (at most viewer everywhere in CT-RBAC) and still shows the person in the workspace's member list.
c. Raise Pro's seats. A pricing change, and it makes every collaborator a billable seat.

## Decision
(a). It adds nothing to the workspace model; the only limit is the session's `max_session_members`; the relay admits by the same session membership rows as today. It reuses the invite token, the preview and accept routes, revoke, and the sealed key bundle (so a collaborator receives keys without the host online).

## Shape
- `POST/GET /v1/sessions/{id}/invites` (host); `Invite.session`, roles `editor`/`viewer`; `InvitePreview.session_name`; `SessionInviteAcceptance` for accept; the host may revoke.
- Accepting records the right to join that session. The join token route admits the holder at the invited role, counting against `max_session_members` and a slot like any member.
- Requires the session workspace's `relay_access`; no seat check or use.

## Consequences
An invitee who was never in the workspace can read the session and its members only after joining. Revoking the invite withdraws the right; removing the member (kick) ends the live membership. The version bump (minor, additive) is left to the merger.
