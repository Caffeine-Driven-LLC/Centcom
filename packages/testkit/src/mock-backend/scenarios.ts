/** Scenario files: a name and a list of steps that script the mock, each run at a virtual time (`at_ms`) or when a frame
 *  kind passes through the relay (`on`). This module owns the file format, its validation and the bundled set in
 *  packages/testkit/scenarios/. It does not run steps (server.ts does) and it never touches the network. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { ERROR_TABLE } from '@centcom/protocol';

export const SCENARIO_ACTIONS = ['disconnect', 'notice', 'error', 'delay', 'drop', 'duplicate', 'reorder', 'peer_send', 'set_entitlement'] as const;
export type ScenarioAction = (typeof SCENARIO_ACTIONS)[number];
/** One step. No `at_ms` and no `on` means "now". `on.nth` counts matching frames from 1 (default 1). */
export interface ScenarioStep { at_ms?: number; on?: { kind: string; nth?: number }; do: ScenarioAction; args: Record<string, unknown> }
export interface ScenarioFile { name: string; seed?: number; steps: ScenarioStep[] }
/** A violation in a scenario (or seed data) file, located by JSON pointer. */
export interface FileIssue { file?: string; pointer: string; message: string }

/** Thrown for a malformed scenario or seed-data file; `issues` lists every violation. The CLI turns it into exit code 2. */
export class MockInputError extends Error {
  constructor(readonly issues: FileIssue[], where: string) {
    super(`${where} is not valid:\n${issues.map((i) => `  ${i.file ? `${i.file}#` : ''}${i.pointer || '/'}: ${i.message}`).join('\n')}`);
    this.name = 'MockInputError';
  }
}

/** The session scenarios act on when a step names no `sid`. Tests and dev tools join this one. */
export const DEFAULT_SID = 'ses_01JTEST0000000000000000001';
/** Close codes from CT-WS-ENVELOPE that a scenario (or the control plane) may force. */
export const CLOSE_CODES = [1000, 1001, 4400, 4401, 4403, 4404, 4408, 4409, 4426, 4429, 4503] as const;
/** `sys.notice` codes from CT-WS-SESSION-EVENTS with their level and the params each one carries. */
export const NOTICE_CODES: Record<string, { level: 'info' | 'warn' | 'error'; params: string[] }> = {
  usage_warning: { level: 'warn', params: ['pct', 'resets_at'] },
  quota_reached: { level: 'error', params: ['resets_at'] },
  plan_changed: { level: 'info', params: ['plan'] },
  member_limit_near: { level: 'warn', params: ['limit', 'count'] },
  maintenance_soon: { level: 'warn', params: ['starts_at', 'minutes'] },
  client_update_available: { level: 'info', params: ['version', 'channel'] },
  history_retention_changed: { level: 'info', params: ['days'] },
};

const SID = { type: 'string', pattern: '^ses_[0-9A-HJKMNP-TV-Z]{26}$' };
const MEM = { type: 'string', pattern: '^mem_[0-9A-HJKMNP-TV-Z]{26}$' };
const ROLE = { enum: ['host', 'editor', 'viewer'] };
const COUNT = { type: 'integer', minimum: 1, maximum: 10_000 };
const args = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required });
/** What `args` may hold for each action. Closed shapes: a typo is a violation, not a silently ignored field. */
const ARGS: Record<ScenarioAction, object> = {
  disconnect: args({ sid: SID, member: MEM, role: ROLE, code: { enum: [...CLOSE_CODES] }, retry_after_s: { type: 'integer', minimum: 0, maximum: 86_400 }, reason: { enum: ['kicked', 'superseded', 'server_restart'] }, error: { enum: Object.keys(ERROR_TABLE) } }, ['code']),
  notice: {
    ...args({ sid: SID, code: { enum: Object.keys(NOTICE_CODES) }, level: { enum: ['info', 'warn', 'error'] }, params: { type: 'object' } }, ['code', 'params']),
    allOf: Object.entries(NOTICE_CODES).map(([code, n]) => ({ if: { properties: { code: { const: code } } }, then: { properties: { params: { required: n.params } } } })),
  },
  error: {
    ...args({ code: { enum: Object.keys(ERROR_TABLE) }, count: COUNT, retry_after_s: { type: 'integer', minimum: 0, maximum: 86_400 }, channel: { enum: ['rest', 'ws'] }, sid: SID, sticky: { type: 'boolean' }, after: { type: 'integer', minimum: 0 }, min_version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+' } }, ['code']),
    allOf: [
      { if: { required: ['after'] }, then: { properties: { code: { const: 'rate_limited' } } } },
      { if: { required: ['min_version'] }, then: { properties: { code: { const: 'client_too_old' } } } },
      { if: { required: ['channel'], properties: { channel: { const: 'ws' } } }, then: { not: { anyOf: [{ required: ['sticky'] }, { required: ['after'] }, { required: ['min_version'] }] } } },
    ],
  },
  delay: args({ sid: SID, ms: { type: 'integer', minimum: 1, maximum: 600_000 }, count: COUNT }, ['ms']),
  drop: args({ sid: SID, count: COUNT }),
  duplicate: args({ sid: SID, count: COUNT }),
  reorder: args({ sid: SID }),
  peer_send: args({
    sid: SID, name: { type: 'string', minLength: 1, maxLength: 40 }, role: ROLE, t: { enum: ['event', 'queue', 'control'] },
    k: { type: 'string', pattern: '^[a-z_]+(\\.[a-z_]+)*$', maxLength: 64 }, id: { type: 'string', pattern: '^msg_[0-9A-HJKMNP-TV-Z]{26}$' }, p: { type: 'object' },
    ct_bytes: { type: 'integer', minimum: 4, maximum: 262_144 }, count: COUNT,
  }, ['k']),
  set_entitlement: args({ workspace: { type: 'string', pattern: '^wsp_[0-9A-HJKMNP-TV-Z]{26}$' }, entitlements: { type: 'object' } }, ['entitlements']),
};

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['name', 'steps'],
  properties: {
    name: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
    seed: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
    steps: {
      type: 'array', maxItems: 10_000,
      items: {
        type: 'object', additionalProperties: false, required: ['do', 'args'],
        not: { required: ['at_ms', 'on'] },
        properties: {
          at_ms: { type: 'integer', minimum: 0, maximum: 86_400_000 },
          on: { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { type: 'string', pattern: '^[a-z_]+(\\.[a-z_]+)*$', maxLength: 64 }, nth: { type: 'integer', minimum: 1 } } },
          do: { enum: [...SCENARIO_ACTIONS] },
          args: { type: 'object' },
        },
        allOf: SCENARIO_ACTIONS.map((a) => ({ if: { properties: { do: { const: a } }, required: ['do'] }, then: { properties: { args: ARGS[a] } } })),
      },
    },
  },
};

const ajv = new Ajv2020({ strict: false, allErrors: true });
const check = ajv.compile(SCHEMA);
const humanise = (keyword: string, params: Record<string, unknown>, message?: string) =>
  keyword === 'additionalProperties' ? `unknown field "${String(params.additionalProperty)}"` : keyword === 'not' ? 'use at_ms or on, not both' : keyword === 'required' ? `missing "${String(params.missingProperty)}"` : message ?? keyword;

/** Validate a parsed scenario. Every violation is reported, each with the JSON pointer of the offending value. */
export function validateScenario(x: unknown): { ok: true; value: ScenarioFile } | { ok: false; issues: FileIssue[] } {
  if (check(x)) return { ok: true, value: x as unknown as ScenarioFile };
  const seen = new Set<string>(); const issues: FileIssue[] = [];
  for (const e of check.errors ?? []) {
    if (e.keyword === 'if') continue; /* "must match then": the real cause is reported separately */
    const it = { pointer: e.instancePath, message: humanise(e.keyword, e.params as Record<string, unknown>, e.message) };
    const key = `${it.pointer} ${it.message}`; if (!seen.has(key)) { seen.add(key); issues.push(it); }
  }
  return { ok: false, issues };
}

/** Where the bundled scenarios live. */
export const SCENARIO_DIR = fileURLToPath(new URL('../../scenarios/', import.meta.url));

/** Parse and validate scenario text; `where` names the file in the error. */
export function parseScenario(text: string, where: string): ScenarioFile {
  let raw: unknown; try { raw = JSON.parse(text); } catch (e) { throw new MockInputError([{ pointer: '', message: `not JSON (${(e as Error).message})` }], where); }
  const r = validateScenario(raw); if (!r.ok) throw new MockInputError(r.issues, where); return r.value;
}

/** Resolve `name` (a bundled scenario) or a path to a `.json` file into a validated scenario. */
export function loadScenario(nameOrPath: string): ScenarioFile {
  const bundled = join(SCENARIO_DIR, `${nameOrPath}.json`);
  const path = /^[a-z0-9-]+$/.test(nameOrPath) && existsSync(bundled) ? bundled : nameOrPath.endsWith('.json') ? nameOrPath : undefined;
  if (!path || !existsSync(path)) throw new Error(`unknown scenario ${nameOrPath} (bundled: ${BUNDLED_SCENARIOS.join(', ')})`);
  return parseScenario(readFileSync(path, 'utf8'), path === bundled ? `scenario ${nameOrPath}` : path);
}

/** Names of the scenarios shipped in packages/testkit/scenarios/. */
export const BUNDLED_SCENARIOS: readonly string[] = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
/** Every bundled scenario, validated, by name. */
export const SCENARIOS: Readonly<Record<string, ScenarioFile>> = Object.fromEntries(BUNDLED_SCENARIOS.map((n) => [n, loadScenario(n)]));
