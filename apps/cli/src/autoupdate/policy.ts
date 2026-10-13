/** The rules about WHAT may be installed and WHEN without asking. Pure; the commands and the start-up check both call these. */
import { compareVersions, type Channel } from '@centcom/net';
import { autoDefault, type InstallMethod } from './install-method.js';

/** A version lower than the one installed is refused unless the user said `--allow-downgrade` (this stops a replayed old manifest from rolling people back). */
export function downgradeDecision(installed: string, offered: string, allowDowngrade: boolean): 'newer' | 'same' | 'downgrade_allowed' | 'downgrade_refused' {
  const c = compareVersions(offered, installed); if (c > 0) return 'newer'; if (c === 0) return 'same'; return allowDowngrade ? 'downgrade_allowed' : 'downgrade_refused';
}
export interface SwitchInput { from: Channel; to: Channel; yes: boolean }
/** Moving to another channel. Nightly is the only one that needs a yes (`--yes` or a typed answer) and shows a warning; beta shows a note. */
export function channelSwitch(i: SwitchInput): { needsConfirm: boolean; warning?: string } {
  if (i.from === i.to) return { needsConfirm: false };
  if (i.to === 'nightly') return { needsConfirm: !i.yes, warning: 'Nightly builds are made every day, are not tested by people first and can break. You can go back to stable with: centcom update --channel stable' };
  if (i.to === 'beta') return { needsConfirm: false, warning: 'Beta builds are previews: newer than stable and less settled.' };
  return { needsConfirm: false };
}
export interface AutoInput { auto: boolean; method: InstallMethod; channel: Channel; /** The channel came from the user's own settings or flags, not from the default. */ channelChosen: boolean; ci?: boolean }
/**
 * May Centcom bring a new version in without being asked? Only a standalone install, only when `update.auto` is on, never in CI, and on beta or nightly only
 * when the user picked that channel themselves.
 */
export function mayAutoUpdate(i: AutoInput): boolean {
  if (i.ci || !i.auto || i.method !== 'standalone') return false;
  if (i.channel !== 'stable' && !i.channelChosen) return false;
  return true;
}
/** The value `update.auto` takes when the user has not set it. */
export const defaultAuto = autoDefault;
