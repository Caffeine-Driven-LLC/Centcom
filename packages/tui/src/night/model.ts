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
  /** You allowed pushing work branches and opening pull requests (never main, never force, never merging). */ allowPush: boolean;
}
export const NIGHT_MAX_TASKS = 200; export const MAX_TASK_CHARS = 4000; export const DEFAULT_TASK_TIMEOUT_MIN = 60;
export const initialNight = (): NightState => ({ armed: false, running: false, tasks: [], taskTimeoutMin: DEFAULT_TASK_TIMEOUT_MIN, allowPush: false });

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
export interface NightPolicy { /** Work branches may be pushed and pull requests opened (never a protected branch, never force, never merging). */ allowPush?: boolean; /** The branch the project is on now (for a bare `git push`). */ branch?: string }
const OUTWARD = [/\bgit\s+push\b/, /\bnpm\s+(publish|unpublish|deprecate)\b/, /\b(pnpm|yarn)\s+publish\b/, /\bgh\s+(pr\s+(merge|comment|close|review|reopen|ready|create|edit)|issue\s+(create|comment|close|edit|reopen|delete)|release|repo\s+(delete|archive|create|edit)|secret|workflow|label)\b/, /\bgh\s+api\b[^|]*-X/, /\bdocker\s+push\b/, /\bterraform\s+(apply|destroy)\b/, /\bkubectl\s+(apply|delete|exec)\b/, /\baws\s+\S+\s+(delete|rm|terminate)/, /\bcurl\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, /\bssh\b/, /\bscp\b/, /\brsync\b[^|]*:/];
export const PROTECTED_BRANCHES = /^(main|master|trunk|develop|dev|production|prod|release[\w/.-]*|stable)$/;
/** With pushing allowed: a plain push of a work branch, and read-only or create/edit pull-request commands. Nothing else outward. */
export function allowedPush(command: string, branch?: string): boolean {
  const parts = command.split(/&&|;|\|\||\n/).map((x) => x.trim()).filter(Boolean); if (!parts.length) return false;
  return parts.every((c) => {
    if (/^gh\s+pr\s+(create|edit|view|list|status|checks|diff)\b/.test(c)) return true;
    if (/^gh\s+(run\s+(list|view)|api\s+repos\/[^\s]*\/(pulls|actions)\b[^|]*$)/.test(c) && !/-X\s*(POST|PUT|PATCH|DELETE)/i.test(c)) return true;
    const m = /^git\s+push\b(.*)$/.exec(c); if (!m) return !OUTWARD.some((re) => re.test(c));
    const args = m[1]!.trim().split(/\s+/).filter(Boolean); if (args.some((a) => /^(-f|--force.*|--delete|-d|--mirror|--all|--tags|--prune)$/.test(a) || a.startsWith('+') || a.includes(':+'))) return false;
    const pos = args.filter((a) => !a.startsWith('-')); const refs = pos.slice(1); const target = (r: string) => r.replace(/^.*:/, '').replace(/^refs\/heads\//, '');
    if (!refs.length) return !!branch && !PROTECTED_BRANCHES.test(branch) && branch !== 'HEAD'; // a bare push goes to the current branch
    return refs.every((r) => !PROTECTED_BRANCHES.test(target(r)) && target(r) !== 'HEAD' && /^[\w./-]+(:[\w./-]+)?$/.test(r));
  });
}
/** The rule for approvals while nobody is there: questions are refused (decide yourself), high risk and anything that leaves the machine is refused, everything else is allowed once. Hard blocks (credentials, outside the project, .git) happen before this is asked. */
export function nightDecision(r: { tool: string; risk: Risk; command?: string }, p: NightPolicy = {}): NightDecision {
  if (/question|^ask/i.test(r.tool)) return { decision: 'deny', reason: 'Nobody is available to answer. Decide yourself, state your assumption, and continue.' };
  if (r.risk === 'high' && !(p.allowPush && r.command && /^\s*git\s+push\b/.test(r.command) && allowedPush(r.command, p.branch))) return { decision: 'deny', reason: 'Night cycle does not run high-risk actions unattended. Find a safer way or leave it for the morning.' };
  if (r.command && OUTWARD.some((re) => re.test(r.command!)) && !(p.allowPush && allowedPush(r.command, p.branch))) return { decision: 'deny', reason: p.allowPush ? 'Night cycle only pushes work branches (never main, never force) and opens pull requests; it never merges, publishes or deploys.' : 'Night cycle does not push, publish, deploy or connect to other machines. Leave it for the morning.' };
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
