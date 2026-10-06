import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { SessionStore } from '@centcom/tui';
import { chooseSession, pickSession } from '../src/commands/resume.js';

const A = 'ses_01JTEST000000000000000000A', B = 'ses_01JTEST000000000000000000B';
const store = () => new SessionStore(mkdtempSync(join(tmpdir(), 'cc-resume-')));
const meta = (id: string, cwd: string, at: number) => ({ id, cwd, engine: 'claude-code', title: id, createdAt: at, updatedAt: at, messages: 1 });
const user = (t: string) => ({ kind: 'user' as const, id: 'u', text: t, ts: 1 });

describe('--continue and --resume', () => {
  it('--continue picks the newest conversation in this folder; none: exit 1 with one line', () => {
    const st = store(); st.save(meta(A, '/w', 1), [user('older')]); st.save(meta(B, '/w', 99_999_999_999_999), [user('newer')]); st.close();
    expect(chooseSession(st, { cwd: '/w', continue: true })).toEqual({ id: B });
    expect(chooseSession(st, { cwd: '/elsewhere', continue: true })).toEqual({ exit: 1, message: 'No session to continue in this directory.' });
  });
  it('--resume <id> opens it; an unknown id is one line and exit 1; an unsupported format too, without a stack', () => {
    const st = store(); st.save(meta(A, '/w', 1), [user('hi')]); st.close(); expect(chooseSession(st, { cwd: '/w', resume: true, id: A })).toEqual({ id: A });
    expect(chooseSession(st, { cwd: '/w', resume: true, id: B })).toEqual({ exit: 1, message: `No saved conversation ${B}.` });
    mkdirSync(join(st.dir, B)); writeFileSync(join(st.dir, B, 'log.jsonl'), '{"fmt":"centcom.localsession","v":9}\n'); const r = chooseSession(st, { cwd: '/w', resume: true, id: B }); expect(r).toMatchObject({ exit: 1 }); expect((r as { message: string }).message).not.toContain('\n');
  });
  it('--resume alone lists the last 20 and takes a number', async () => {
    const st = store(); st.save(meta(A, '/w', 1), [user('first task')]); st.close(); const c = chooseSession(st, { cwd: '/w', resume: true }); expect('pick' in c).toBe(true);
    const input = new PassThrough(); const output = new PassThrough(); let shown = ''; output.on('data', (d) => (shown += d)); const p = pickSession((c as { pick: never[] }).pick, { input, output }); input.write('1\n');
    expect(await p).toBe(A); expect(shown).toContain(` 1  ${A}`);
  });
});
