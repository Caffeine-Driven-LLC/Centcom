/** What the app's state says to the header and footer lines (lane C039). The words and the order are the status module's; this only reads the state. */
import type { AppState } from '../state/model.js';
import { counts as nightCounts } from '../night/model.js';
import { formatReset, formatTokens, truncate } from '../util/text.js';
import type { StatusFields } from './layout.js';

const MODE = { default: 'ask', acceptEdits: 'accept-edits', plan: 'plan', bypassPermissions: 'bypass' } as const;
const WIN: Record<string, string> = { five_hour: 'session', seven_day: 'week' };

/** Header and footer fields from the app state. `home` is the folder to show as `~`. */
export function statusFieldsFor(s: AppState, o: { home?: string; now?: number } = {}): StatusFields {
  const me = s.agents.find((a) => a.mine); const others = s.agents.filter((a) => !a.mine);
  const kind = me?.loginKind === 'subscription' ? 'subscription' : me?.loginKind === 'api_key' ? 'API key' : me?.loginKind === 'cloud' ? 'cloud' : s.demo ? 'demo' : '';
  const engine = [s.engineLabel, me?.model ? truncate(me.model, 22) : '', kind].filter(Boolean).join(' · ');
  const cost = s.agents.reduce((n, a) => n + (a.cost || 0), 0); const need = others.filter((a) => a.state === 'awaiting-approval').length + s.approvals.length;
  const night = s.night.running || s.night.armed || s.night.tasks.length ? (() => { const c = nightCounts(s.night); return s.night.running ? `night ${c.done + c.failed}/${c.total}` : c.queued ? `night · ${c.queued} queued` : 'night ready'; })() : undefined;
  return {
    cwd: s.cwd, home: o.home, branch: s.branch || undefined, engine, agents: s.agents.length, costMicroUsd: cost > 0 ? Math.round(cost * 1_000_000) : undefined, showCost: s.settings.showCost !== false,
    connectivity: s.net === 'backend-down' ? 'down' : s.net && s.net !== 'online' ? s.net : undefined,
    mode: MODE[s.settings.permissionMode], night, ...(s.share ? { runsOn: s.share.runsOn, ...(s.share.guests ? { guests: { text: s.share.guests, stale: s.share.guestsStale } } : {}) } : {}),
    state: me && s.busy ? me.state.replace(/-/g, ' ') : 'idle', needYou: need || undefined,
    context: me?.ctxPct !== undefined ? { pct: me.ctxPct, tokens: me.ctxTokens && me.ctxWindow ? `${formatTokens(me.ctxTokens)}/${formatTokens(me.ctxWindow)}` : undefined } : undefined,
    limits: s.limits.map((l) => ({ name: WIN[l.name] ?? l.name.replace(/_/g, ' '), pct: l.utilization * 100, resets: l.resets_at ? formatReset(l.resets_at, o.now) : undefined })),
    tokens: me && me.inTok + me.outTok ? `↑${formatTokens(me.inTok)} ↓${formatTokens(me.outTok)}` : undefined,
    hints: ['? help', 'ctrl+k palette'],
  };
}
