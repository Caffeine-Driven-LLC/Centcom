/** Named, scripted situations. Each is a plain list of control-plane steps, so a test or a human can replay the same thing. */
export interface ScenarioStep { op: string; body?: Record<string, unknown> }
export const SCENARIOS: Record<string, ScenarioStep[]> = {
  /** The very first API call fails twice with 503, then works: exercises retry with backoff. */
  'flaky-start': [{ op: 'errors', body: { code: 'service_unavailable', count: 2, retry_after_s: 1 } }],
  /** The service is down for maintenance (every call except /status answers 503). */
  'maintenance': [{ op: 'maintenance', body: { on: true } }],
  /** The next request is told the client is too old. */
  'client-too-old': [{ op: 'min-client', body: { version: '99.0.0' } }],
  /** The account is rate limited after 3 more calls. */
  'rate-limited': [{ op: 'rate-limit', body: { remaining: 3, retry_after_s: 7 } }],
  /** A session with a host and two editors already in the roster. */
  'busy-session': [
    { op: 'session', body: { id: 'ses_01JTEST0000000000000000001' } },
  ],
};
