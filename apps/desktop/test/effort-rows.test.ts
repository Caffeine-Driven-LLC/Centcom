import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseInitializeModels } from '@centcom/agent';
import { row } from '../src/local/service.js';

const fixture = (v: string) => parseInitializeModels(readFileSync(resolve(__dirname, `../../../packages/agent/test/fixtures/claude-initialize-${v}.jsonl`), 'utf8'))!.map(row);

describe('the desktop protocol carries each model\'s effort levels', () => {
  it('a model with effort lists its levels, the 4.6 models without xhigh', () => {
    const rows = fixture('2.1.301');
    expect(rows.find((r) => r.id === 'sonnet')!.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(rows.find((r) => r.id === 'claude-opus-4-6')!.efforts).toEqual(['low', 'medium', 'high', 'max']);
  });
  it('a model without effort has an empty list (the window shows no control) and the alias carries the id it stands for', () => {
    const rows = fixture('2.1.301');
    expect(rows.find((r) => r.id === 'claude-haiku-4-5-20251001')!.efforts).toEqual([]);
    expect(rows.find((r) => r.id === 'haiku')).toMatchObject({ resolved: 'claude-haiku-5-5' });
    expect(fixture('2.1.289').find((r) => r.id === 'haiku')).toMatchObject({ resolved: 'claude-haiku-4-5-20251001', efforts: [] });
  });
});
