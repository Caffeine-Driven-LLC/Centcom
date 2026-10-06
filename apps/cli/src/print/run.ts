/** Non-interactive mode (lane C050): `centcom -p "prompt"`. No screen, no prompts. stdout carries only data (text, one result
 *  object, or normalised events); everything for people goes to stderr. Exit codes are in exit-codes.ts. */
import { AppController, SessionStore, buildRuntime } from '@centcom/tui';
import { redact } from '@centcom/protocol';
import type { AgentEngine, NormalisedEvent, PermissionMode } from '@centcom/agent';
import { EXIT_CODES, exitCodeFor } from './exit-codes.js';
import { formatResult, streamLine, type PrintResult } from './format.js';

export interface PrintOptions {
  /** Where permissions.json lives (tests point it at a temp folder). */ configDir?: string;
  engine: AgentEngine; demo: boolean; cwd: string; branch: string; version: string; mode: PermissionMode; prompt: string;
  /** Where ctrl+c comes from (tests pass an emitter). */ proc?: NodeJS.Process;
  format: 'text' | 'json' | 'stream-json'; save: boolean; resume?: string; model?: string; out?: NodeJS.WritableStream; err?: NodeJS.WritableStream;
  /** Extra allow rules for this run, in the permission rule syntax (`Bash(npm test)`, `Edit(src/**)`). */ allow?: string[];
  /** Stop after this many seconds (exit 124). */ timeoutS?: number;
  /** Stop after this many agent steps (tool results); default 50. */ maxTurns?: number;
  /** Where the conversation logs live (tests). */ dataDir?: string;
  clock?: { now(): number; setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void };
}
export { buildPrompt, readStdin } from './stdin.js';

const realClock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout) };

export async function runPrint(o: PrintOptions): Promise<number> {
  const out = o.out ?? process.stdout; const err = o.err ?? process.stderr; const clock = o.clock ?? realClock; const t0 = clock.now(); const json = o.format !== 'text';
  const say = (t: string) => err.write(redact(t) + '\n');
  if (!o.prompt) { say('Give Centcom something to do: centcom -p "your task" (or pipe text in).'); return EXIT_CODES.usage; }
  const declined: string[] = []; let failure: { code: string; message: string } | undefined; let streamed = false; let steps = 0; let gone = false; let stopped: number | undefined;
  const usage: PrintResult['usage'] = {};
  // stdout closed early (`| head -1`): stop quietly, no stack trace
  const onOutErr = (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') { gone = true; finish?.(); } };
  out.on?.('error', onOutErr);
  const write = (t: string) => { if (!gone) { try { out.write(t); } catch (e) { onOutErr(e as NodeJS.ErrnoException); } } };
  let rt; try { rt = await buildRuntime({ cwd: o.cwd, engineId: o.engine.id, demo: o.demo, dangerous: o.mode === 'bypassPermissions', checkpoints: false, allow: o.allow, ...(o.configDir ? { configDir: o.configDir } : {}) }); }
  catch (e) { say(String((e as Error).message ?? e)); return EXIT_CODES.usage; }
  let finish: (() => void) | undefined;
  const ctl: AppController = new AppController({ ...rt.options,
    engine: o.engine, demo: o.demo, cwd: o.cwd, branch: o.branch, version: o.version, permissionMode: o.mode, skills: [], dangerous: o.mode === 'bypassPermissions',
    settings: o.model ? { model: o.model } : undefined, sessions: o.save ? new SessionStore(o.dataDir) : undefined, resume: o.resume,
    onEvent: (ev: NormalisedEvent) => {
      if (o.format === 'stream-json') { const l = streamLine(ev); if (l) write(l); }
      else if (o.format === 'text' && ev.type === 'text.delta') { write(redact(ev.text)); streamed = true; }
      if (ev.type === 'text.done' && o.format === 'text' && streamed) { write('\n'); streamed = false; }
      if (ev.type === 'error' && ev.fatal) failure = { code: ev.code, message: ev.tool_message };
      if (ev.type === 'usage.report') { usage.input_tokens = (usage.input_tokens ?? 0) + (ev.input_tokens ?? 0); usage.output_tokens = (usage.output_tokens ?? 0) + (ev.output_tokens ?? 0); if (ev.cache_read_tokens) usage.cache_read_tokens = (usage.cache_read_tokens ?? 0) + ev.cache_read_tokens; if (typeof ev.cost_usd === 'number') usage.cost_usd_estimate = ev.cost_usd; }
      if (ev.type === 'tool.result' && ++steps >= (o.maxTurns ?? 50)) { failure ??= { code: 'max_turns', message: `Stopped after ${o.maxTurns ?? 50} steps (--max-turns).` }; void ctl.interrupt(); }
    },
  });
  rt.bind(ctl);
  await ctl.start();
  // nobody is there to answer, so anything that still needs an approval is declined and reported
  const unsub = ctl.store.subscribe(() => { const a = ctl.state.approvals[0]; if (a) { declined.push(`${a.req.tool}: ${a.req.summary}`); ctl.answerApproval('deny'); } });
  // ctrl+c stops the turn (exit 130); a second one within 1 s forces it
  const offSig = ctl.interrupts.onSignal(o.proc ?? process, { exit: (code) => { stopped = code || EXIT_CODES.interrupted; finish?.(); }, hint: () => undefined });
  const offTurn = ctl.store.subscribe(() => { if (ctl.turnInterrupted() && stopped === undefined && !failure) stopped = EXIT_CODES.interrupted; });
  const timer = o.timeoutS ? clock.setTimeout(() => { stopped = EXIT_CODES.timeout; void ctl.interrupt(true); finish?.(); }, o.timeoutS * 1000) : undefined;
  if (!gone) await ctl.submit(o.prompt);
  await new Promise<void>((resolve) => {
    finish = resolve; if (gone) { resolve(); return; }
    const check = () => { if (!ctl.state.busy && ctl.state.approvals.length === 0) { unsub2(); resolve(); } };
    const unsub2 = ctl.store.subscribe(check); setTimeout(check, 50);
  });
  if (timer !== undefined) clock.clearTimeout(timer);
  unsub(); offSig(); offTurn(); out.off?.('error', onOutErr);
  if (gone) { void ctl.interrupt(true); ctl.stop(); return EXIT_CODES.ok; } // the reader went away: not our failure
  const s = ctl.state;
  const answer = [...s.items].reverse().find((i) => i.kind === 'assistant'); const text = answer && answer.kind === 'assistant' ? answer.text : '';
  const notice = [...s.items].reverse().find((i) => i.kind === 'notice' && i.level === 'error');
  if (!failure && notice && notice.kind === 'notice') failure = { code: 'error', message: notice.detail ?? notice.text };
  for (const d of declined) say(`Declined (needs approval): ${d}`);
  if (declined.length) say('Allow it with --allow "<rule>" (e.g. --allow "Bash(npm test)") or --permission-mode accept-edits.');
  const code = stopped ?? (failure ? exitCodeFor(failure.code === 'max_turns' ? 'failure' : failure.code) : declined.length ? EXIT_CODES.denied : EXIT_CODES.ok);
  const errorOut = stopped === EXIT_CODES.timeout ? { code: 'timeout', message: `Stopped after ${o.timeoutS} s (--timeout).` } : stopped ? { code: 'interrupted', message: 'Interrupted.' } : failure;
  if (json) write(formatResult({ is_error: code !== EXIT_CODES.ok && code !== EXIT_CODES.denied, result: text, usage, session_id: s.sessionId, engine: o.engine.id, duration_ms: clock.now() - t0, ...(errorOut && code !== EXIT_CODES.ok && code !== EXIT_CODES.denied ? { error: errorOut } : {}) }));
  else if (!failure && !stopped && !text) say('(no reply)');
  if (errorOut && code !== EXIT_CODES.ok) say(errorOut.code === 'interrupted' || errorOut.code === 'timeout' ? errorOut.message : `Error: ${errorOut.message}`);
  ctl.stop();
  return code;
}
