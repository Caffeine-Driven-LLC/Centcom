import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDoctor } from '../../src/doctor/index.js';
import { resolveTranscripts, runCost } from '../../src/doctor/cost.js';

const io = () => { const out: string[] = []; const err: string[] = []; return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } }; };
const line = (id: string, w: number, o: number) => JSON.stringify({ type: 'assistant', message: { id, model: 'm', content: [], usage: { input_tokens: 1, cache_creation_input_tokens: w, cache_read_input_tokens: 0, output_tokens: o } } });

describe('centcom doctor --cost', () => {
  it('reads a session file and the sub-agent files in its folder', async () => {
    const d = mkdtempSync(join(tmpdir(), 'cost-')); mkdirSync(join(d, 's', 'subagents'), { recursive: true });
    writeFileSync(join(d, 's.jsonl'), line('a', 100, 10) + '\n'); writeFileSync(join(d, 's', 'subagents', 'x.jsonl'), line('b', 100, 20) + '\n');
    expect(typeof resolveTranscripts([join(d, 's.jsonl'), join(d, 's')])).toBe('object');
    const t = io(); expect(await runCost([join(d, 's.jsonl'), join(d, 's'), '--cost'], t.io)).toBe(0);
    expect(t.out.join('\n')).toContain('1 main + 1 sub-agent'); expect(t.out.join('\n')).not.toContain(d);
  });
  it('prints json, refuses unknown options and missing files', async () => {
    const d = mkdtempSync(join(tmpdir(), 'cost-')); writeFileSync(join(d, 's.jsonl'), line('a', 100, 10) + '\n');
    const j = io(); expect(await runCost(['--cost', '--json', join(d, 's.jsonl')], j.io)).toBe(0); expect(JSON.parse(j.out[0]!).requests.main).toBe(1);
    const e = io(); expect(await runCost(['--cost', '--nope'], e.io)).toBe(2); expect(await runCost(['--cost', join(d, 'missing.jsonl')], e.io)).toBe(2);
  });
  it('without a transcript reports the launch flags and a byte-identical prefix; doctor routes --cost here', async () => {
    const t = io(); expect(await runCost(['--cost'], t.io)).toBe(0); expect(t.out.join('\n')).toContain('byte-identical');
    const t2 = io(); expect(await runDoctor(['--cost'], undefined as never, t2.io)).toBe(0); expect(t2.out.join('\n')).toContain('Centcom launch report');
  });
});
