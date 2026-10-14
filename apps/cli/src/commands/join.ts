/**
 * `centcom join <link|session-id> [--name <name>]`: joins somebody else's session from the terminal: an invite link, a watch-only link or the
 * id of a session in your workspace. It prints what the host's agent says and does as it happens; an editor can type a line to ask the
 * agent for something (the host decides whether it runs), a viewer only watches. Ctrl-C leaves.
 * Must not: print a key, a token or the link's secret part; need an account for a watch-only link.
 */
import type { GuestState } from '@centcom/guest';
import type { JoinedSession } from '@centcom/tui';
import { MESSAGES } from '@centcom/tui';

export interface JoinDeps {
  account: { join(input: string, o?: { displayName?: string }): Promise<{ joined: JoinedSession | JoinedLike; how: 'invite' | 'session' | 'watch' }> };
  out(line: string): void; err(line: string): void;
  /** lines typed by the person (null at the end of input); only called for someone who may ask */ lines?: AsyncIterable<string>;
  signal?: AbortSignal;
}
/** The part of a joined session this command uses (tests pass fakes). */
export interface JoinedLike { state(): GuestState; subscribe(f: (s: GuestState) => void): () => void; people(): { id: string; name: string; role: string; you: boolean }[]; role: string; ask(text: string): Promise<unknown>; leave(): Promise<void> }
/** What the host sends is not trusted: no terminal escape sequences, no carriage returns or other control characters reach this terminal (newlines and tabs stay). */
export function clean(text: string): string {
  return text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '') // CSI (colours, cursor moves, clipboard and title requests ride on these and on OSC below)
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '') // OSC (window title, hyperlinks, clipboard)
    .replace(/\u001b[P^_X][^\u001b]*(?:\u001b\\)?/g, '') // DCS, PM, APC, SOS strings
    .replace(/\u001b./gs, '') // any other two-character escape
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ''); // the rest of the control characters (CR, BEL, backspace, C1)
}
const WHO: Record<string, string> = { host: 'host', editor: 'can edit', viewer: 'view only' };

const failure = (e: unknown): string => {
  const code = (e as { code?: string; rawCode?: string })?.code ?? (e as { rawCode?: string })?.rawCode; const msg = e instanceof Error ? e.message : '';
  if (code === 'bad_target' || code === 'not_signed_in') return code === 'not_signed_in' ? 'Sign in first: run `centcom login`. (A watch-only link needs no account.)' : msg;
  if (code === 'invite_invalid' || code === 'invite_expired' || code === 'invite_revoked') return 'That invite is no longer valid. Ask for a new one.';
  if (code === 'session_not_found' || code === 'not_found') return 'That session was not found, or you are not allowed in it.';
  if (code === 'not_a_member') return 'You are not a member of that session. Ask the host for an invite.';
  if (/fetch failed|ECONNREFUSED|network/i.test(msg)) return 'Could not reach the Centcom server. Check your connection.';
  return msg && msg.length < 160 ? msg : 'Joining did not work. Try again.';
};

export async function runJoin(argv: string[], deps: JoinDeps): Promise<number> {
  const d: JoinDeps = { ...deps, out: (l) => deps.out(clean(l)), err: (l) => deps.err(clean(l)) };
  let target: string | undefined; let displayName: string | undefined; let bad: string | undefined;
  for (let i = 0; i < argv.length; i++) { const a = argv[i]!; if (a === '--name') { displayName = argv[++i]; if (!displayName) bad = 'Give --name a value.'; } else if (a.startsWith('--')) bad = `Unknown option ${a}.`; else if (!target) target = a; else bad = 'Give one link or session id.'; }
  if (!target || bad) { d.err(bad ?? 'Usage: centcom join <invite link | watch-only link | session id> [--name <name>]'); return 1; }
  let joined: JoinedSession | JoinedLike; let how: string;
  try { ({ joined, how } = await d.account.join(target, displayName ? { displayName } : {})); } catch (e) { d.err(failure(e)); return 1; }
  d.out(`Joined (${how === 'invite' ? 'by invite' : how === 'watch' ? 'watch-only link' : 'in your workspace'}) as ${WHO[joined.role] ?? joined.role}. ${joined.role === 'viewer' ? 'You can watch but not send.' : 'Type a line to ask the host\'s agent for something; Ctrl-C leaves.'}`);
  const shown = new Map<string, number>(); let phase = ''; let lastPeople = '';
  /** Whose account runs a prompt typed here (C105): the host's, in a command post. Said before the first prompt can be sent; unknown means nothing is sent. */
  const hostName = (): string | undefined => joined.people().find((p) => p.role === 'host')?.name || undefined; let noticeFor = '';
  const payerNotice = (): void => { const h = hostName(); if (joined.role === 'viewer' || !h || h === noticeFor) return; noticeFor = h; d.out(MESSAGES['provider.guest_notice']({ host: h })); };
  const print = (s: GuestState): void => {
    if (s.phase !== phase) { phase = s.phase; if (phase === 'waiting_for_key') d.out('… waiting for the host to let you read'); else if (phase === 'reconnecting') d.out('… reconnecting'); else if (phase === 'ended') d.out('The session has ended.'); else if (phase === 'kicked') d.out('You were removed from this session.'); }
    const people = joined.people().map((p) => `${p.you ? 'you' : p.name} (${WHO[p.role] ?? p.role})`).join(', '); if (people !== lastPeople) { lastPeople = people; d.out(`In the session: ${people}`); payerNotice(); }
    for (const e of s.transcript) {
      const key = e.id; const done = e.kind === 'assistant' ? e.done : true; if (!done || shown.has(key)) continue; shown.set(key, 1);
      if (e.kind === 'user') { const p = joined.people().find((x) => x.id === e.from); d.out(`${p ? (p.you ? 'you' : p.name) : 'someone'}> ${e.text}`); } else if (e.kind === 'assistant') d.out(e.text); else if (e.kind === 'system') d.out(`· ${e.text}`);
      else if (e.kind === 'tool_request') d.out(`› ${e.name}: ${e.summary}`.slice(0, 300)); else if (e.kind === 'tool_result') d.out(`  ${e.status}: ${e.summary}`.slice(0, 300)); else if (e.kind === 'approval') d.out(`⚑ the host is asked: ${e.summary}`.slice(0, 300));
    }
  };
  const off = joined.subscribe(print); const ended = new Promise<void>((resolve) => { const check = joined.subscribe((s) => { if (s.phase === 'ended' || s.phase === 'kicked') resolve(); }); d.signal?.addEventListener('abort', () => { check(); resolve(); }); });
  const reader = joined.role !== 'viewer' && d.lines ? (async () => { try { for await (const line of d.lines!) { const t = line.trim(); if (!t) continue; if (!hostName()) { d.err('Not sent: it is not known yet whose account would run your prompt. Try again in a moment.'); continue; } payerNotice(); try { await joined.ask(t); d.out('(asked: waiting for the host)'); } catch (e) { d.err(failure(e)); } } } catch { /* input closed */ } })() : undefined;
  await ended; void reader; off(); await joined.leave();
  return 0;
}
