/** Which model each agent uses (lane C028): what the engines report, the user's aliases, a cache; passing the choice stays in the engine adapters. */
import type { EngineId } from '../types.js';
import type { Current, ModelSelection, ModelDeps, ModelRegistry, ReportedModel } from './types.js';

interface AgentRec { engine: EngineId; setModel(m: string): void; flag?: string; override?: string; reported?: string; busy: boolean; pending?: { name: string; reason: 'user' | 'config' }; applied?: string | null; previous?: string | null }
interface CacheFile { v: 1; engines: Record<string, { at: number; version?: string; models: ReportedModel[] }> }
const PASS_AS: Record<string, ModelSelection['passAs']> = { 'claude-code': 'flag', codex: 'protocol' };

export function createModelRegistry(d: ModelDeps): ModelRegistry {
  const agents = new Map<string, AgentRec>(); let cache: CacheFile | undefined;
  const passAs = (e: EngineId): ModelSelection['passAs'] => PASS_AS[e] ?? 'flag';
  const aliases = (): ReportedModel[] => { const a = d.config().aliases; const ids = Array.isArray(a) ? a : Object.keys(a ?? {}); return ids.map((id) => ({ id, label: Array.isArray(a) ? undefined : (a as Record<string, string>)[id], reportedBy: 'alias' as const })); };
  async function loadCache(): Promise<CacheFile> {
    if (cache) return cache; try { const j = JSON.parse((await d.fs.read(d.cachePath)) ?? ''); cache = j?.v === 1 && j.engines ? j : { v: 1, engines: {} }; } catch { cache = { v: 1, engines: {} }; } /* a damaged cache is ignored */ return cache!;
  }
  const rec = (id: string): AgentRec => { const a = agents.get(id); if (!a) throw new Error(`unknown agent ${id}`); return a; };
  const effective = (a: AgentRec): { model: string | null; source: Current['source'] } => {
    if (a.override !== undefined) return { model: a.override, source: 'override' };
    if (a.flag) return { model: a.flag, source: 'flag' };
    const c = d.config(); const cfg = c.projectModel || c.model; if (cfg) return { model: cfg, source: 'config' };
    return { model: a.reported ?? null, source: 'engine-reported' };
  };
  /** The model the agent is given at spawn: flag, then override, then project config, then user config, else nothing. */
  function resolveFor(a: AgentRec, input?: string): string | null { if (input) return input; if (a.flag) return a.flag; if (a.override) return a.override; const c = d.config(); return c.projectModel || c.model || null; }
  function apply(id: string, a: AgentRec, name: string, reason: 'user' | 'config') {
    const from = a.applied ?? effective(a).model; a.previous = from; a.override = name; a.applied = name; a.setModel(name); d.bus.emit('model.changed', { agent_id: id, from, to: name, reason }); d.log?.debug('model.changed');
  }
  return {
    attach: (x) => { agents.set(x.agentId, { engine: x.engine, setModel: x.setModel, flag: x.flag, busy: false }); },
    resolve(agentId, input) { const a = rec(agentId); return { engine: a.engine, model: resolveFor(a, input), passAs: passAs(a.engine) }; },
    current(agentId) { const a = rec(agentId); const e = effective(a); return { engine: a.engine, model: e.model, source: e.source }; },
    async list(engine) {
      const eng = d.engines.get(engine); const ver = eng?.version?.(); const c = await loadCache(); const ttl = (d.config().cacheTtlHours ?? 24) * 3_600_000; const hit = c.engines[engine];
      const reported = [...agents.values()].filter((a) => a.engine === engine && a.reported).map((a): ReportedModel => ({ id: a.reported!, reportedBy: 'init-event', ...(ver ? { engineVersion: ver } : {}) }));
      let listed: ReportedModel[];
      if (hit && d.clock.now() - hit.at < ttl && hit.version === ver) listed = hit.models;
      else if (eng?.capabilities().has('models.list') && eng.listModels) {
        try { listed = (await eng.listModels()).map((m) => ({ id: m.id, label: m.label, reportedBy: 'model-command' as const, ...(ver ? { engineVersion: ver } : {}) })); c.engines[engine] = { at: d.clock.now(), version: ver, models: listed }; await d.fs.write(d.cachePath, JSON.stringify(c)).catch(() => undefined); }
        catch { listed = hit?.models ?? []; }
      } else listed = [];
      const seen = new Set<string>(); const out: ReportedModel[] = [];
      for (const m of [...reported, ...listed, ...aliases()]) if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
      return out;
    },
    async switchTo(agentId, name, reason) {
      const a = rec(agentId); const choice = (): ModelSelection => ({ engine: a.engine, model: name, passAs: passAs(a.engine) });
      const cur = a.pending?.name ?? a.applied ?? effective(a).model;
      if (cur === name) return { ...choice(), note: `Already using ${name}.` };
      if (a.busy) { a.pending = { name, reason }; return { ...choice(), note: `Switching to ${name} after this turn.` }; }
      apply(agentId, a, name, reason); return choice();
    },
    onRejected(agentId, text) {
      const a = agents.get(agentId); if (!a || a.previous === undefined) return; const failed = a.applied; const prev = a.previous;
      a.override = prev ?? undefined; a.applied = prev; if (prev) a.setModel(prev); a.previous = undefined;
      d.notify?.('warn', `Couldn't switch to ${failed}. Still using ${prev ?? 'the default'}.`, text); /* the tool's own words, verbatim */
    },
    onEvent(agentId, ev) {
      const a = agents.get(agentId); if (!a) return;
      if (ev.type === 'session.started' && typeof ev.model === 'string' && ev.model) a.reported = ev.model;
      else if (ev.type === 'turn.started') a.busy = true;
      else if (ev.type === 'turn.done') { a.busy = false; if (a.pending) { const p = a.pending; a.pending = undefined; apply(agentId, a, p.name, p.reason); } }
    },
    async describe(agentId) {
      const a = rec(agentId); const cur = effective(a).model; const models = await this.list(a.engine); const eng = d.engines.get(a.engine);
      const lines = models.map((m) => `${m.id === cur ? '*' : ' '} ${m.id}${m.label && m.label !== m.id ? `  ${m.label}` : ''}`.slice(0, 80));
      if (!eng?.capabilities().has('models.list')) lines.push('This engine did not report a model list.');
      if (!lines.length) lines.push(`Using ${cur ?? 'the engine default'}.`);
      return lines;
    },
  };
}
