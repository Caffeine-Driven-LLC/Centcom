/**
 * Where do the tokens go? Reads recorded Claude Code transcripts (or none, to measure Centcom's own launch) and prints the numbers in docs/cost.md.
 *
 *     pnpm exec tsx tools/dev/cost-report.ts [--json] [<session.jsonl> [<session folder with subagents/>]]
 *
 * Makes no model call. The same report is `centcom doctor --cost`. Without a transcript it also sizes the text Centcom adds in front of a prompt.
 */
import { buildDigest } from '../../packages/agent/src/board/digest.js';
import { sizeOf, type AddOn } from '../../packages/agent/src/cost/turns.js';
import { injection } from '../../packages/skills/src/index.js';
import { runCost } from '../../apps/cli/src/doctor/cost.js';

const argv = process.argv.slice(2);
const io = { out: (l: string) => console.log(l), err: (l: string) => console.error(l) };
const code = await runCost(argv, io);
if (code === 0 && !argv.some((a) => !a.startsWith('--')) && !argv.includes('--json')) {
  const now = Date.now(); const author = { kind: 'agent' as const, id: 'other', name: 'Agent 2' };
  const entries = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: `e${i}`, ts: now - i * 60_000, author, type: 'finding' as const, text: `The ${i}th finding about the layout of the module and why it matters to the next change that touches it.`, refs: { files: [`src/area${i}/index.ts`], commands: [] }, scope: 'fleet' as const, pinned: false }));
  const digest = buildDigest({ entries, agent: { id: 'me', name: 'you' }, touched: [], delivered: new Set(), now, budgetTokens: 500 });
  const skill = (n: number) => ({ skill: { name: `skill-${n}`, description: 'Use when the task needs a careful, repeatable approach to this kind of work and its checks.', kind: 'skill' as const, source: 'user', path: `/x/skill-${n}/SKILL.md` }, score: 5, why: ['word'] });
  const rows: AddOn[] = [
    sizeOf('board digest (a full 500-token budget)', 'message', digest?.text ?? '', 'only when other agents posted something new'),
    sizeOf('auto skills (3 matches)', 'message', injection([skill(1), skill(2), skill(3)]), 'only when the prompt matches a skill'),
  ];
  console.log('\nText Centcom can put in front of a prompt (about 4 characters per token):');
  for (const r of rows) console.log(`  ${r.name.padEnd(42)} ${String(r.tokens).padStart(5)} tokens  in the ${r.where}; ${r.when}`);
}
process.exit(code);
