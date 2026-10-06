/** Non-interactive mode: `centcom -p "prompt"`. No screen, no prompts: text goes to stdout, problems to stderr.
 *  Exit codes: 0 done, 1 error, 2 bad usage, 3 finished but an action needed an approval and was declined. */
import { AppController, SessionStore, buildRuntime } from '@centcom/tui';
import type { AgentEngine, NormalisedEvent, PermissionMode } from '@centcom/agent';

export interface PrintOptions {
  /** Where permissions.json lives (tests point it at a temp folder). */ configDir?: string;
  engine: AgentEngine; demo: boolean; cwd: string; branch: string; version: string; mode: PermissionMode; prompt: string;
  format: 'text' | 'json' | 'stream-json'; save: boolean; resume?: string; model?: string; out?: NodeJS.WritableStream; err?: NodeJS.WritableStream;
}

export async function readStdin(stdin: NodeJS.ReadableStream = process.stdin): Promise<string> {
  let t = ''; stdin.setEncoding('utf8'); for await (const c of stdin) t += c; return t;
}

/** Combine `-p "text"` with piped input so `cat file | centcom -p "summarise"` works. */
export function buildPrompt(arg: string | undefined, piped: string | undefined): string {
  const a = (arg ?? '').trim(); const p = (piped ?? '').trim();
  return a && p ? `${a}\n\n${p}` : a || p;
}

export async function runPrint(o: PrintOptions): Promise<number> {
  const out = o.out ?? process.stdout; const err = o.err ?? process.stderr;
  if (!o.prompt) { err.write('Give Centcom something to do: centcom -p "your task" (or pipe text in).\n'); return 2; }
  const declined: string[] = []; let failed = ''; let streamed = false;
  // the same permission policy as the app (hard denies, saved rules); what would need a person is declined below and reported
  const rt = await buildRuntime({ cwd: o.cwd, engineId: o.engine.id, demo: o.demo, dangerous: o.mode === 'bypassPermissions', checkpoints: false, ...(o.configDir ? { configDir: o.configDir } : {}) });
  const ctl: AppController = new AppController({ ...rt.options,
    engine: o.engine, demo: o.demo, cwd: o.cwd, branch: o.branch, version: o.version, permissionMode: o.mode, skills: [], dangerous: o.mode === 'bypassPermissions',
    settings: o.model ? { model: o.model } : undefined, sessions: o.save ? new SessionStore() : undefined, resume: o.resume,
    onEvent: (ev: NormalisedEvent) => {
      if (o.format === 'stream-json') out.write(JSON.stringify(ev) + '\n');
      else if (o.format === 'text' && ev.type === 'text.delta') { out.write(ev.text); streamed = true; }
      if (ev.type === 'text.done' && o.format === 'text' && streamed) { out.write('\n'); streamed = false; }
      if (ev.type === 'error' && ev.fatal) failed = ev.tool_message;
    },
  });
  rt.bind(ctl);
  await ctl.start();
  // nobody is there to answer, so anything that still needs an approval is declined and reported
  const unsub = ctl.store.subscribe(() => { const a = ctl.state.approvals[0]; if (a) { declined.push(`${a.req.tool}: ${a.req.summary}`); ctl.answerApproval('deny'); } });
  await ctl.submit(o.prompt);
  await new Promise<void>((resolve) => {
    const check = () => { if (!ctl.state.busy && ctl.state.approvals.length === 0) { unsub2(); resolve(); } };
    const unsub2 = ctl.store.subscribe(check); setTimeout(check, 50);
  });
  unsub();
  const s = ctl.state; const me = s.agents.find((a) => a.mine)!;
  const answer = [...s.items].reverse().filter((i) => i.kind === 'assistant').map((i) => (i.kind === 'assistant' ? i.text : '')).slice(0, 1)[0] ?? '';
  const notice = [...s.items].reverse().find((i) => i.kind === 'notice' && i.level === 'error');
  if (!failed && notice && notice.kind === 'notice') failed = notice.detail ?? notice.text;
  for (const d of declined) err.write(`Declined (needs approval): ${d}\n`);
  if (declined.length) err.write('Re-run with --mode acceptEdits or --dangerously-skip-permissions to allow it.\n');
  if (o.format === 'json') out.write(JSON.stringify({ result: answer, is_error: !!failed, error: failed || undefined, session_id: s.sessionId, model: me.model, usage: { input_tokens: me.inTok, output_tokens: me.outTok, context_percent: me.ctxPct }, cost_usd: me.cost || undefined, cost_is_estimate: true, declined }, null, 2) + '\n');
  else if (o.format === 'text' && !failed && !answer) err.write('(no reply)\n');
  if (failed) err.write(`Error: ${failed}\n`);
  ctl.stop();
  return failed ? 1 : declined.length ? 3 : 0; // 1 = error, 3 = finished but something needed an approval nobody could give
}
