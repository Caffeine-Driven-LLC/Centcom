import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runKeys } from '../src/commands/keys.js';

const dirs: string[] = []; afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const file = (text?: string) => { const d = mkdtempSync(join(tmpdir(), 'centcom-keys-')); dirs.push(d); const f = join(d, 'keybindings.json'); if (text !== undefined) writeFileSync(f, text); return f; };
describe('centcom keys (acceptance 8)', () => {
  it('--json is a stable array of {id, group, description, keys, context}', () => { const out: string[] = []; expect(runKeys(['--json'], { out: (l) => out.push(l), err: () => undefined }, file())).toBe(0); const j = JSON.parse(out.join('\n')); expect(Array.isArray(j)).toBe(true); expect(j.find((r: { id: string }) => r.id === 'palette.open')).toEqual({ id: 'palette.open', group: 'General', description: 'Open the command palette', keys: ['ctrl+k'], context: 'global' }); expect(j.map((r: { id: string }) => r.id)).toEqual([...j.map((r: { id: string }) => r.id)].sort()); });
  it('an invalid file: warnings on stderr, still exit 0, defaults used', () => { const err: string[] = []; const out: string[] = []; expect(runKeys([], { out: (l) => out.push(l), err: (l) => err.push(l) }, file('{broken'))).toBe(0); expect(err[0]).toMatch(/not valid JSON/); expect(out.join('\n')).toContain('ctrl+k'); });
  it('the user file applies', () => { const out: string[] = []; runKeys(['--json'], { out: (l) => out.push(l), err: () => undefined }, file(JSON.stringify({ unbind: ['ctrl+k'], bindings: [{ key: 'ctrl+p', action: 'palette.open' }] }))); expect(JSON.parse(out.join('\n')).find((r: { id: string }) => r.id === 'palette.open').keys).toEqual(['ctrl+p']); });
});
