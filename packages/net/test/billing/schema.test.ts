import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VirtualClock } from '@centcom/testkit';
import { validateAgainst } from '@centcom/protocol';
import { ContractViolationError, EntitlementsClient } from '../../src/index.js';
import { json, scripted } from '../http/helpers.js';
import { WSP, fixtures, tmp, until } from '../support.js';

const fetchOne = async (body: unknown) => {
  const { client } = scripted([json(200, body)]); const dir = tmp('ent');
  const c = new EntitlementsClient({ http: client, workspaceId: () => WSP, clock: new VirtualClock(), cacheDir: dir });
  return { v: await c.get(), c, dir };
};

describe('contracts/fixtures/entitlements (CT-ENTITLEMENTS)', () => {
  const all = fixtures();
  it('the fixture set is the one the contract ships', () => { expect(all.map((f) => f.name)).toEqual(['bad_plan', 'free', 'lan_false', 'missing_limit', 'past_due', 'pro', 'team']); });

  for (const f of all) {
    it(`${f.name}: the C003 strict validator says ${f.valid ? 'valid' : 'invalid'}`, () => { expect(validateAgainst('entitlements', f.data, 'strict').ok).toBe(f.valid); });
  }

  for (const f of all.filter((x) => x.valid)) {
    it(`${f.name}: accepted by the client as served`, async () => { const { v } = await fetchOne(f.data); expect(v.source).toBe('network'); expect(v.ent.plan).toBe(f.data.plan); expect(v.ent.rev).toBe(42); expect(v.error).toBeUndefined(); });
  }

  it('lan_false and missing_limit are refused (ContractViolationError, nothing cached)', async () => {
    for (const name of ['lan_false', 'missing_limit']) { const { v, c } = await fetchOne(all.find((f) => f.name === name)!.data); expect(v.error, name).toBeInstanceOf(ContractViolationError); expect(v.source).toBe('defaults'); expect(c.can('relay_access')).toBe(false); }
  });

  it('bad_plan: an unknown plan name is tolerated on read (CT-VER) and decides nothing: gates follow the limits only', async () => {
    const { v, c } = await fetchOne(all.find((f) => f.name === 'bad_plan')!.data); expect(v.source).toBe('network'); expect(v.ent.plan).toBe('enterprise'); expect(c.can('relay_access')).toBe(false);
  });

  it('unknown fields are ignored: extra top-level fields are dropped from the cache, unknown limit keys are kept for display but never unlock', async () => {
    const base = all.find((f) => f.name === 'pro')!.data;
    const { v, c, dir } = await fetchOne({ ...base, stripe_customer: 'cus_123', future: { x: 1 }, limits: { ...base.limits, teleport: true, warp_slots: null } });
    expect(v.source).toBe('network'); expect(c.can('teleport')).toBe('unknown'); expect(c.can('warp_slots')).toBe('unknown'); expect(c.limit('teleport')).toBe(true);
    const f = join(dir, 'entitlements', `${WSP}.json`); await until(() => existsSync(f)); const text = readFileSync(f, 'utf8');
    expect(text).not.toContain('stripe_customer'); expect(text).not.toContain('future'); expect(text).toContain('teleport');
  });
});
