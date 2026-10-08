/** Night cycle: a queue of tasks the agent works through unattended. Everything here is pure; the runner and the panel build on it. */
import type { Risk } from '@centcom/agent';

export type NightStatus = 'queued' | 'running' | 'done' | 'failed' | 'timeout';
export interface NightTask { id: string; text: string; status: NightStatus; startedAt?: number; endedAt?: number; /** The agent's last message for this task. */ summary?: string; error?: string; approved: number; denied: number }
export interface NightState {
  /** The panel and queue are open for adding tasks. */ armed: boolean;
  /** Tasks are being worked on right now. */ running: boolean;
  startedAt?: number; endedAt?: number; tasks: NightTask[];
  /** Why the cycle stopped before the queue was empty (you stopped it, usage limit, signed out…). */ stopped?: string;
  reportPath?: string;
  /** Per-task time limit in minutes. */ taskTimeoutMin: number;
}
export const NIGHT_MAX_TASKS = 200; export const MAX_TASK_CHARS = 4000; export const DEFAULT_TASK_TIMEOUT_MIN = 60;
export const initialNight = (): NightState => ({ armed: false, running: false, tasks: [], taskTimeoutMin: DEFAULT_TASK_TIMEOUT_MIN });

const BULLET = /^\s*(?:[-*•]\s+(?:\[[ xX]\]\s+)?|\d{1,3}[.)]\s+|\[[ xX]\]\s+)/;
/** One task per line (bullets, numbers and checkboxes are stripped); if the text has blank lines, each paragraph is one task instead. */
export function parseTasks(text: string): string[] {
  const t = text.replace(/\r\n?/g, '\n').trim(); if (!t) return [];
  const clean = (s: string) => s.replace(BULLET, '').trim();
  const parts = /\n\s*\n/.test(t) ? t.split(/\n\s*\n/).map((p) => p.split('\n').map((l, i) => (i === 0 ? clean(l) : l.trim())).filter(Boolean).join(' ')) : t.split('\n').map(clean);
  return parts.map((p) => p.trim()).filter(Boolean).map((p) => p.slice(0, MAX_TASK_CHARS));
}

/** What the agent is told for each task. Nobody is there to answer, so it must decide, say what it assumed, and stay inside the project. */
export function taskPrompt(task: Pick<NightTask, 'text'>, index: number, total: number): string {
  return `[NIGHT CYCLE · task ${index} of ${total}]
Nobody is at the keyboard and nobody will answer questions until morning. So:
- Do not ask questions and do not wait for input. If something is unclear, pick the most reasonable interpretation, keep going, and list your assumptions in your last message.
- Finish the task end to end: make the change, run the project's tests, linter and build where they exist, and fix what you broke.
- Work only inside this project. Do not push, publish, deploy, force-push, delete things you did not create, or touch credentials; those requests will be refused. Commit locally in small steps if the project uses git.
- If you are truly blocked, stop, say exactly what blocked you and what you tried, and leave the project in a clean state. The next task starts after you finish.
- End with a short summary: what you did, what you checked, what you assumed, what is left.

Task:
${task.text}`;
}

export interface NightDecision { decision: 'approve' | 'deny'; reason?: string }
const OUTWARD = [/\bgit\s+push\b/, /\bnpm\s+(publish|unpublish|deprecate)\b/, /\b(pnpm|yarn)\s+publish\b/, /\bgh\s+(pr\s+merge|release|repo\s+(delete|archive)|secret|workflow\s+run)\b/, /\bdocker\s+push\b/, /\bterraform\s+(apply|destroy)\b/, /\bkubectl\s+(apply|delete|exec)\b/, /\baws\s+\S+\s+(delete|rm|terminate)/, /\bcurl\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, /\bssh\b/, /\bscp\b/, /\brsync\b[^|]*:/];
/** The rule for approvals while nobody is there: questions are refused (decide yourself), high risk and anything that leaves the machine is refused, everything else is allowed once. Hard blocks (credentials, outside the project, .git) happen before this is asked. */
export function nightDecision(r: { tool: string; risk: Risk; command?: string }): NightDecision {
  if (/question|^ask/i.test(r.tool)) return { decision: 'deny', reason: 'Nobody is available to answer. Decide yourself, state your assumption, and continue.' };
  if (r.risk === 'high') return { decision: 'deny', reason: 'Night cycle does not run high-risk actions unattended. Find a safer way or leave it for the morning.' };
  if (r.command && OUTWARD.some((re) => re.test(r.command!))) return { decision: 'deny', reason: 'Night cycle does not push, publish, deploy or connect to other machines. Leave it for the morning.' };
  return { decision: 'approve' };
}

export const counts = (s: NightState) => ({ total: s.tasks.length, done: s.tasks.filter((t) => t.status === 'done').length, failed: s.tasks.filter((t) => t.status === 'failed' || t.status === 'timeout').length, queued: s.tasks.filter((t) => t.status === 'queued').length, running: s.tasks.filter((t) => t.status === 'running').length });
export const finished = (s: NightState): number => { const c = counts(s); return c.done + c.failed; };

const mins = (ms: number): string => { const m = Math.round(ms / 60000); return m < 1 ? `${Math.max(1, Math.round(ms / 1000))} s` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
export const durationText = mins;
/** The morning report, in Markdown. */
export function renderReport(s: NightState, now: number): string {
  const c = counts(s); const span = s.startedAt !== undefined ? mins((s.endedAt ?? now) - s.startedAt) : '';
  const mark: Record<NightStatus, string> = { done: '✓', failed: '✗', timeout: '!', queued: '○', running: '●' };
  const lines = [`# Night cycle report`, '', `${c.done} of ${c.total} tasks done${c.failed ? `, ${c.failed} failed` : ''}${c.queued ? `, ${c.queued} not started` : ''}${span ? ` · ${span}` : ''}`, ...(s.stopped ? ['', `Stopped early: ${s.stopped}`] : [])];
  s.tasks.forEach((t, i) => {
    lines.push('', `## ${i + 1}. ${mark[t.status]} ${t.text.split('\n')[0]!.slice(0, 100)}`, '', `Status: ${t.status}${t.startedAt && t.endedAt ? ` · ${mins(t.endedAt - t.startedAt)}` : ''} · ${t.approved} actions allowed, ${t.denied} refused`);
    if (t.error) lines.push('', `Problem: ${t.error}`);
    if (t.summary) lines.push('', t.summary.trim());
  });
  return lines.join('\n') + '\n';
}
export const reportName = (d: Date): string => { const p = (n: number) => String(n).padStart(2, '0'); return `night-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.md`; };
