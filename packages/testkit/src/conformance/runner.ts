/** Runs the suites against the fixtures and builds one entry per contract. */
import type { ContractReport, Suite, SuiteContext, Waiver } from './types.js';

export async function runSuites(o: { suites: Suite[]; contracts: string[]; only?: string[]; ctx: SuiteContext; waivers: Waiver[] }): Promise<ContractReport[]> {
  const out: ContractReport[] = []; const ids = o.only?.length ? o.contracts.filter((c) => o.only!.includes(c)) : o.contracts;
  for (const id of ids) {
    const suite = o.suites.find((s) => s.contract === id); const waiver = o.waivers.find((w) => w.contract === id);
    const none = (): ContractReport => (waiver ? { id, status: 'waived', fixtures_total: 0, fixtures_passed: 0, waiver: { issue: waiver.issue, reason: waiver.reason, expires: waiver.expires } } : { id, status: 'skipped', fixtures_total: 0, fixtures_passed: 0 });
    if (!suite) { out.push(none()); continue; }
    let r; try { r = await suite.run(o.ctx); } catch (e) { out.push({ id, status: 'fail', fixtures_total: 0, fixtures_passed: 0, failures: [`suite crashed: ${(e as Error).message}`] }); continue; }
    if (r.fixtures_total === 0 && r.cases.length === 0) { out.push(none()); continue; }
    const failed = r.cases.filter((c) => !c.ok); out.push({ id, status: failed.length ? 'fail' : 'pass', fixtures_total: r.fixtures_total, fixtures_passed: r.fixtures_passed, ...(failed.length ? { failures: failed.slice(0, 20).map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ''}`) } : {}) });
  }
  return out;
}
