export type Severity = 'low' | 'medium' | 'high' | 'critical';
export interface Finding { severity: Severity; location: string; message: string }
export type CheckStatus = 'pass' | 'fail' | 'waived';
export interface CheckResult { id: string; status: CheckStatus; findings: Finding[] }
export interface Waiver { id: string; issue: string; expires: string; reason?: string }
export interface SecurityReport { schema_version: 1; generated_at: string; checks: CheckResult[]; waivers: Waiver[] }
/** A check that cannot run is a failure, never a pass. */
export const unavailable = (id: string, why: string): CheckResult => ({ id, status: 'fail', findings: [{ severity: 'high', location: id, message: `tool_unavailable: ${why}` }] });
export const isBlocking = (f: Finding): boolean => f.severity === 'high' || f.severity === 'critical';
export const result = (id: string, findings: Finding[]): CheckResult => ({ id, status: findings.some(isBlocking) ? 'fail' : 'pass', findings });
