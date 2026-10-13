/** Auto-update integration (lane C095): install method, schedule, apply with health check and rollback, crash recovery, policy, too-old handling, notices.
 *  The checks, download, hash and signature verification are the update client's (packages/net/src/update, lane C068). */
export * from './apply.js';
export * from './install-method.js';
export * from './keys.js';
export * from './notices.js';
export * from './policy.js';
export * from './ports.js';
export * from './schedule.js';
export * from './startup.js';
export * from './too-old.js';
