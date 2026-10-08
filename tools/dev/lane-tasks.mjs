#!/usr/bin/env node
/** Prints the lanes CLAUDE.md says are eligible to build next, as night-cycle tasks (one line each). `--seed` also writes them to ~/.centcom/night/queue.json (with pushing work branches allowed) so `centcom` finds them queued. Needs `git fetch origin main` to be current. */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const status = JSON.parse(readFileSync(join(root, 'plan/STATUS.json'), 'utf8'));
const lanes = status.lanes ?? {};
const log = execSync('git log origin/main --format=%s', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const ids = readdirSync(join(root, 'plan/lanes/client')).filter((f) => /^C\d+\.json$/.test(f)).map((f) => f.slice(0, -5));
const subjects = log.split('\n');
const named = (id) => subjects.some((s) => new RegExp(`^(Progress: [^\\n]*)?(C\\d+\\+)*${id}(\\+C\\d+)*[:\\s,]`).test(s) || new RegExp(`^C\\d+(\\+C\\d+)*:`).test(s) && s.split(':')[0].split('+').includes(id));
const done = (id) => id === 'C001' || id === 'C002' || (lanes[id]?.pct ?? 0) >= 0.95 || named(id);
const protectedRe = /^(contracts\/|plan\/|\.github\/|tools\/(plan|ci)\/|pnpm-workspace\.yaml|\.claude\/|\.mcp\.json|\.npmrc|\.pnpmfile)|(^|\/)CLAUDE\.md$/;
const needsInfra = /\b(workflow|CI job|matrix|schedule|signing key|app-store|credentials|real account|runner)\b/i;
const order = [...(status.next ?? []).flatMap((n) => n.title.match(/C\d{3}(?:-C\d{3})?/g) ?? []).flatMap((r) => { const [a, b] = r.split('-'); if (!b) return [a]; const o = []; for (let n = +a.slice(1); n <= +b.slice(1); n++) o.push('C' + String(n).padStart(3, '0')); return o; }), ...ids].filter((v, i, a) => a.indexOf(v) === i);
const eligible = [];
for (const id of order.filter((i) => ids.includes(i))) {
  if (done(id) || (lanes[id]?.pct ?? 0) > 0) continue;
  const card = JSON.parse(readFileSync(join(root, `plan/lanes/client/${id}.json`), 'utf8'));
  if ((card.depends_on ?? []).some((d) => !done(d))) continue;
  if ((card.deliverables ?? []).some((d) => protectedRe.test(d))) continue;
  if (needsInfra.test(JSON.stringify([card.acceptance, card.scope_in]))) continue;
  eligible.push({ id, title: card.title });
}
const task = (l) => `Build lane ${l.id} (${l.title}) following CLAUDE.md "Lane loop" steps 2 and 3: branch from a fresh main, build only the card's deliverables with a test per acceptance item, run tools/ci/gates.sh (not piped), push the branch, open the PR titled "${l.id}: ${l.title}", add the claude-automerge label, then stop. Never merge, approve or comment on the PR, and never push to the branch again.`;
if (!eligible.length) { console.error('No eligible lanes (see CLAUDE.md step 1). Partly built lanes need a human decision.'); process.exit(0); }
for (const l of eligible) console.log(task(l));
if (process.argv.includes('--seed')) {
  const dir = join(homedir(), '.centcom', 'night'); mkdirSync(dir, { recursive: true, mode: 0o700 }); const file = join(dir, 'queue.json');
  const cur = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  writeFileSync(file, JSON.stringify({ taskTimeoutMin: Math.max(cur.taskTimeoutMin ?? 0, 120), allowPush: true, tasks: [...(cur.tasks ?? []), ...eligible.map(task)] }));
  console.error(`Seeded ${eligible.length} task(s) into ${file} (pushing work branches allowed, 120 min per task).`);
}
