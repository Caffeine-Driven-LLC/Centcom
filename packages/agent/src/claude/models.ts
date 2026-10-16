/**
 * What Claude Code itself says about its models. The free `initialize` control request (no prompt, no model call) answers with every model's
 * `value` (the alias or id `--model` takes), what it resolves to, and whether it takes `--effort` and at which levels. Centcom uses that
 * instead of a list of its own, so a model without effort (Haiku) or without a level (the 4.6 models have no xhigh) is never sent one.
 */
import { CLAUDE_MODELS, type ModelChoice } from '../models.js';

/** Every level Claude Code knows, lowest first. Used to order and to find the closest level. */
export const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** FALLBACK ONLY: what Centcom assumed before it asked the CLI. Used when the `initialize` query fails; every model in a live answer overrides it. */
export const FALLBACK_EFFORTS: readonly string[] = EFFORT_ORDER;
/** FALLBACK ONLY: for a model the CLI did not list (an id typed by hand): the levels every effort-capable model takes. */
export const UNLISTED_EFFORTS: readonly string[] = ['low', 'medium', 'high'];

/** The `initialize` control request (one JSON line). */
export const INITIALIZE_REQUEST = JSON.stringify({ type: 'control_request', request_id: 'centcom_init', request: { subtype: 'initialize' } });

/** The argument list of the model query (no prompt, no `--model`): how a stand-in `claude` tells it from a turn. */
export const MODELS_QUERY_ARGS: readonly string[] = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
export const isModelsQuery = (args: readonly string[]): boolean => args.length === MODELS_QUERY_ARGS.length && args.every((a, i) => a === MODELS_QUERY_ARGS[i]);

/** A model of the CLI's list: `efforts` is the real list, or `[]` when the model has no effort setting. */
export interface ClaudeModel extends ModelChoice { /** The full id the alias resolves to. */ resolved?: string }

/** Reads `response.response.models` out of one `control_response` line; undefined when the line is not that or lists nothing usable. */
export function parseInitializeModels(line: string): ClaudeModel[] | undefined {
  let j: any; try { j = JSON.parse(line); } catch { return undefined; }
  if (j?.type !== 'control_response' || j.response?.subtype !== 'success') return undefined;
  const raw = j.response?.response?.models; if (!Array.isArray(raw)) return undefined;
  const out: ClaudeModel[] = [];
  for (const m of raw) {
    if (!m || typeof m.value !== 'string') continue;
    const levels = m.supportsEffort && Array.isArray(m.supportedEffortLevels) ? (m.supportedEffortLevels as unknown[]).map(String).filter((e) => (EFFORT_ORDER as readonly string[]).includes(e)).sort((a, b) => EFFORT_ORDER.indexOf(a as never) - EFFORT_ORDER.indexOf(b as never)) : [];
    const isDefault = m.value === 'default';
    out.push({ id: isDefault ? '' : m.value, label: String(m.displayName ?? m.value), note: String(m.description ?? '').slice(0, 80), provider: 'anthropic', efforts: levels, ...(m.resolvedModel ? { resolved: String(m.resolvedModel) } : {}), ...(isDefault ? { isDefault: true } : {}) });
  }
  return out.length ? out : undefined;
}

/** FALLBACK ONLY (the live query failed): the static model list with the assumed levels. Anything named Haiku gets none: the safe side, since sending no effort is never wrong (the live list says which Haiku takes it). */
export function fallbackModels(base: ModelChoice[]): ClaudeModel[] {
  return base.map((m) => ({ ...m, ...(m.id === '' ? { isDefault: true } : {}), efforts: /haiku/i.test(m.id) ? [] : [...FALLBACK_EFFORTS] }));
}

/**
 * The entry for `model` the way the CLI resolves it: by `value` (an alias such as `sonnet`), then by the full id an alias resolves to, so
 * `claude-sonnet-5-5` finds the Sonnet 5.5 row. Empty = the CLI's default model. undefined = not in the list.
 */
export function resolveModel(list: readonly ClaudeModel[], model: string | undefined): ClaudeModel | undefined {
  const want = (model ?? '').trim().toLowerCase();
  if (!want) return list.find((m) => m.isDefault);
  return list.find((m) => m.id.toLowerCase() === want) ?? list.find((m) => m.resolved?.toLowerCase() === want);
}

/** The levels `--effort` may take for `model`: the CLI's list; `[]` for a model without effort; the common levels for one the CLI did not list (none when its name says Haiku: the safe side, nothing is sent that might be refused). */
export function effortsFor(list: readonly ClaudeModel[], model: string | undefined): string[] {
  if (!list.length) list = fallbackModels(CLAUDE_MODELS); // no list at all (the query failed, or an engine that cannot be asked): FALLBACK
  const hit = resolveModel(list, model); if (hit) return hit.efforts ?? [];
  if (/haiku/i.test(model ?? '')) return [];
  return [...UNLISTED_EFFORTS];
}

/** The level to use instead of `want` among `levels`: `want` itself, else the closest one (on a tie the lower), so xhigh on a model without it gives high. '' when nothing is supported or nothing was wanted. */
export function fitEffort(want: string, levels: readonly string[]): string {
  if (!want || !levels.length) return ''; if (levels.includes(want)) return want;
  const w = EFFORT_ORDER.indexOf(want as never); if (w < 0) return '';
  let best = ''; let bd = Infinity; let bi = Infinity;
  for (const l of levels) { const i = EFFORT_ORDER.indexOf(l as never); if (i < 0) continue; const d = Math.abs(i - w); if (d < bd || (d === bd && i < bi)) { best = l; bd = d; bi = i; } }
  return best;
}
