import { readFileSync } from 'node:fs';

export interface EventStep { line: number; at_ms: number; event: { type: string; [k: string]: unknown } }
export type ExpectStep = { line: number; expect: 'send'; prompt?: string } | { line: number; expect: 'interrupt' } | { line: number; expect: 'approval'; decision: 'approve' | 'deny' };
export type TranscriptStep = EventStep | ExpectStep;
export interface Transcript { header: { transcript: 1; engine: string; recorded_with?: string }; steps: TranscriptStep[] }

/** `*.transcript.jsonl`: a header line, then `{"at_ms":120,"event":{...}}` (an event minus v/seq/ts/agent_id) or `{"expect":"send"|"interrupt"|"approval",...}` steps. Errors name the line. */
export function parseTranscript(text: string, name = 'transcript'): Transcript {
  const lines = text.split('\n'); let header: Transcript['header'] | undefined; const steps: TranscriptStep[] = [];
  lines.forEach((raw, i) => {
    const line = i + 1; if (!raw.trim()) return; const fail = (m: string): never => { throw new Error(`${name}:${line}: ${m}`); };
    let j: any; try { j = JSON.parse(raw); } catch { return fail('not valid JSON'); }
    if (!header) { if (j?.transcript !== 1 || typeof j.engine !== 'string') fail('first line must be {"transcript":1,"engine":...}'); header = j; return; }
    if (j.event) { if (typeof j.event.type !== 'string') fail('event has no type'); steps.push({ line, at_ms: Number(j.at_ms ?? 0), event: j.event }); return; }
    switch (j.expect) {
      case 'send': steps.push({ line, expect: 'send', ...(typeof j.prompt === 'string' ? { prompt: j.prompt } : {}) }); break;
      case 'interrupt': steps.push({ line, expect: 'interrupt' }); break;
      case 'approval': if (j.decision !== 'approve' && j.decision !== 'deny') fail('approval step needs decision approve or deny'); steps.push({ line, expect: 'approval', decision: j.decision }); break;
      default: fail(`unknown expect step "${String(j.expect)}"`);
    }
  });
  if (!header) throw new Error(`${name}: empty transcript`); return { header, steps };
}
export const loadTranscript = (path: string): Transcript => parseTranscript(readFileSync(path, 'utf8'), path);
