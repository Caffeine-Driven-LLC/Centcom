import { CONTRACT_VERSION } from '@centcom/protocol';
import { denyKey, redactString } from './redact.js';
import type { LogRecord } from './logger.js';

export interface DiagDeps {
  version: string; os: { platform: string; arch: string; release?: string }; node: string; colorTier: string; home?: string;
  /** key, where it came from, and its value (dropped here if the key is sensitive) */
  config: { key: string; layer: string; value: unknown }[]; ring?: { snapshot(): LogRecord[] };
}
export interface Diagnostics { version: string; contract: string; os: { platform: string; arch: string; release?: string }; node: string; colorTier: string; config: { key: string; layer: string; value?: unknown; hidden?: true }[]; recent: LogRecord[] }

/** Everything needed to understand a bug report, and nothing private. Data only: writing or zipping it is the CLI's job. */
export function collectDiagnostics(d: DiagDeps): Diagnostics {
  const config = d.config.map((c) => {
    const sensitive = denyKey(c.key.split('.').pop() ?? c.key) || typeof c.value === 'string' && redactString(c.value, d.home) !== c.value;
    return sensitive ? { key: c.key, layer: c.layer, hidden: true as const } : { key: c.key, layer: c.layer, value: c.value };
  });
  return { version: d.version, contract: CONTRACT_VERSION, os: d.os, node: d.node, colorTier: d.colorTier, config, recent: (d.ring?.snapshot() ?? []).slice(-500) };
}
