// Shows a push notification from its keys only: the server sends no display text.
const T = { 'notif.approval_needed.title': 'Approval needed', 'notif.queue_turn.title': 'Your turn in the queue', 'notif.mention.title': 'You were mentioned', 'notif.member_joined.title': 'Someone joined', 'notif.member_left.title': 'Someone left', 'notif.agent_done.title': 'An agent finished', 'notif.ci_failed.title': 'A check failed', 'notif.pr_merged.title': 'A pull request was merged', 'notif.usage_warning.title': 'Usage warning', 'notif.quota_reached.title': 'Quota reached', 'notif.billing_issue.title': 'Billing needs attention', 'notif.invite_received.title': 'You were invited', 'notif.security_alert.title': 'Security alert', 'notif.system_notice.title': 'Update from Centcom' };
self.addEventListener('push', (e) => {
  let k = ''; try { k = String((e.data && e.data.json().title_key) || ''); } catch (_) { /* no usable payload */ }
  e.waitUntil(self.registration.showNotification(Object.prototype.hasOwnProperty.call(T, k) ? T[k] : 'Update from Centcom', { tag: 'centcom', icon: undefined }));
});
self.addEventListener('notificationclick', (e) => { e.notification.close(); e.waitUntil(self.clients.openWindow('/notifications')); });
