import { describe, expect, it } from 'vitest';
import doc from '../src/generated/openapi.json' with { type: 'json' };
import { OPERATIONS } from '../src/index.js';

describe('operation table', () => {
  it('an operation is public when it has no security, or `{}` is one of the alternatives (optional auth)', () => {
    let n = 0; for (const item of Object.values(doc.paths as Record<string, Record<string, { operationId?: string; security?: Record<string, unknown>[] }>>)) for (const op of Object.values(item)) { if (!op?.operationId) continue; const sec = op.security; const expected = Array.isArray(sec) && (sec.length === 0 || sec.some((r) => Object.keys(r).length === 0)); expect((OPERATIONS as Record<string, { public: boolean }>)[op.operationId]!.public, op.operationId).toBe(expected); n++; }
    expect(n).toBe(Object.keys(OPERATIONS).length);
  });
  it('the optional-auth endpoints the contract names are public, and an ordinary one is not', () => { expect(OPERATIONS.ingestTelemetry.public).toBe(true); expect(OPERATIONS.getFlags.public).toBe(true); expect(OPERATIONS.getMe.public).toBe(false); expect(OPERATIONS.startDeviceAuthorization.public).toBe(true); });
});
