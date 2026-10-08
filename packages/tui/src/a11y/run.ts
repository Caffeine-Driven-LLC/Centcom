/** The whole app as plain lines, for screen readers: no alternate screen, no colour, no boxes, no redraws. Events become sentences, approvals and lists are asked in text. */
import { createInterface } from 'node:readline';
import type { AppController } from '../controller.js';
import { COMMANDS } from '../state/commands.js';
import { createLinearRenderer, plain } from './linear.js';

export interface LinearIO { input: NodeJS.ReadableStream; output: { write(s: string): unknown } }

/** Runs until the input ends or `stop` resolves (the /quit command). Nothing is ever answered on your behalf: no timeouts, no defaults. */
export async function runLinear(ctl: AppController, io: LinearIO = { input: process.stdin, output: process.stdout }, stop: Promise<void> = new Promise(() => undefined)): Promise<void> {
  const out = io.output; const w = (t: string) => out.write(plain(t).replace(/\n+$/, '') + '\n');
  const rl = createInterface({ input: io.input, terminal: false }); const buffered: string[] = []; const asks: ((l: string | undefined) => void)[] = []; let promptWaiter: ((l: string | undefined) => void) | undefined; let ended = false; let stopped = false;
  const closeAll = () => { for (const n of asks.splice(0)) n(undefined); const p = promptWaiter; promptWaiter = undefined; p?.(undefined); };
  /* a question (approval, list) always gets the next line before the main prompt does, wherever it arrived from */
  rl.on('line', (l) => { const next = asks.shift(); if (next) { next(l); return; } const p = promptWaiter; if (p) { promptWaiter = undefined; p(l); } else buffered.push(l); });
  rl.on('close', () => { ended = true; closeAll(); });
  void stop.then(() => { stopped = true; closeAll(); });
  const read = (prompt: string, kind: 'ask' | 'prompt'): Promise<string | undefined> => { out.write(prompt); return new Promise((res) => { if (buffered.length) res(buffered.shift()); else if (ended || stopped) res(undefined); else if (kind === 'ask') asks.push(res); else promptWaiter = res; }); };
  const readLine = (prompt: string) => read(prompt, 'ask');
  const renderer = createLinearRenderer({ out, readLine });

  /* what the agent does: one line per event (errors are explained by the notice that follows them) */
  ctl.addObserver((_a, ev) => { if (ev.type === 'error' || (ev.type === 'status' && (ev.state === 'awaiting-approval' || ev.state === 'asking-question'))) return; renderer.handle(ev); }); // the question itself says what is awaited

  /* notices and toasts the app would show on screen */
  const seen = new Set<string>(); for (const i of ctl.state.items) seen.add(i.id); for (const t of ctl.state.toasts) seen.add(t.id);
  const flushNotices = () => {
    for (const i of ctl.state.items) if (!seen.has(i.id)) { seen.add(i.id); if (i.kind === 'notice') { w(`${i.level === 'error' ? 'Error' : 'Status'}: ${i.text}`); if (i.detail) w(i.detail); } }
    for (const t of ctl.state.toasts) if (!seen.has(t.id)) { seen.add(t.id); w(`${t.level === 'error' || t.level === 'warn' ? 'Error' : 'Status'}: ${t.text}`); }
  };

  let asking = false;
  const react = async () => {
    flushNotices(); if (asking) return; const s = ctl.state;
    if (ctl.awaitingAnswer) { // the agent asked something with no choices: the next line you type is the answer (Enter alone declines)
      asking = true; const line = await readLine('Your answer (just press Enter to decline): ');
      if (!line?.trim()) ctl.cancelAnswer(); else await ctl.submit(line);
      asking = false; void react(); return;
    }
    if (s.approvals[0]) {
      asking = true; const a = s.approvals[0]!.req; const high = a.risk === 'high';
      const ans = await renderer.ask({ command: a.command, cwd: a.cwd, tool: a.tool, summary: a.path ?? a.summary });
      if (ans === 'n') ctl.answerApproval('deny'); else if (ans === 'a' && !high) ctl.answerApproval('approve', 'always'); else ctl.answerApproval('approve');
      asking = false; void react(); return;
    }
    if (s.mode === 'pick' && s.pick) {
      asking = true; const p = s.pick; w(p.title); if (p.note) w(p.note);
      p.options.forEach((o, i) => w(`${i + 1}. ${o.label}${o.hint ? `: ${o.hint}` : ''}${p.checked.includes(o.id) ? ' (current)' : ''}`));
      for (;;) {
        const line = await readLine(p.multi ? 'Type the numbers you want, separated by commas, "all", or just press Enter to cancel: ' : 'Type a number, or just press Enter to cancel: ');
        const t = (line ?? '').trim().toLowerCase();
        if (!t) { ctl.pickAnswer(undefined); break; }
        const nums = t === 'all' && p.multi ? p.options.map((_, i) => i + 1) : t.split(/[\s,]+/).map(Number);
        if (nums.length && nums.every((n) => Number.isInteger(n) && n >= 1 && n <= p.options.length) && (p.multi || nums.length === 1)) { ctl.pickAnswer(nums); break; }
        w(`Please type ${p.multi ? 'numbers' : 'one number'} from 1 to ${p.options.length}.`);
      }
      asking = false; void react(); return;
    }
    /* screens that only make sense on a canvas: say so in words and go back to the prompt */
    if (s.mode === 'help') { w('Commands:'); for (const c of COMMANDS) w(`/${c.name}${c.args ? ' ' + c.args : ''}: ${c.desc}`); w('Type a message to the agent, or a / command. Press Ctrl+D to leave.'); ctl.patch({ mode: 'chat' }); }
    else if (s.mode === 'palette') { w('The command palette is not used in screen-reader mode. Type / commands instead; /help lists them.'); ctl.patch({ mode: 'chat' }); }
    else if (s.mode === 'gallery') { w('The animation gallery is not available in screen-reader mode.'); ctl.patch({ mode: 'chat' }); }
    else if (s.mode === 'models') { w('Choose a model with /model followed by its name.'); ctl.patch({ mode: 'chat' }); }
  };
  const unsubscribe = ctl.store.subscribe(() => { void react(); });
  w('Centcom, in screen-reader mode. Type a message and press Enter. /help lists the commands. Press Ctrl+D to leave.');

  const idle = () => new Promise<void>((res) => { const check = () => { const s = ctl.state; if (!s.busy && !s.approvals.length && s.mode !== 'pick' && !asking) { off(); res(); } }; const off = ctl.store.subscribe(check); check(); });
  try {
    for (;;) {
      if (asking) { await idle(); continue; }
      const line = await read('> ', 'prompt'); if (line === undefined) break; if (!line.trim()) continue;
      await ctl.submit(line); flushNotices(); await react(); await idle(); flushNotices();
    }
  } finally { unsubscribe(); rl.close(); }
}
