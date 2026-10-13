export type Status = 'pass' | 'warn' | 'fail' | 'skip';
export interface CheckResult { status: Status; summary: string; /** Exactly one thing to do next (fail and warn only). */ next_step?: string }
export interface Reply { status: number; headers: Record<string, string>; json?: unknown }
export interface DoctorContext {
  version: string; contract: string; env: Record<string, string | undefined>; platform: string; arch: string; node: string; home: string; stateDir: string; apiBase: string;
  term: { tier: string; unicode: boolean; cols: number; rows: number; isTTY: boolean };
  now(): number;
  /** A GET with its own timeout. Rejects on timeout or network failure. */ get(url: string, o: { timeoutMs: number }): Promise<Reply>;
  keychain: { get(a: string): Promise<string | undefined>; set(a: string, v: string): Promise<void>; delete(a: string): Promise<void> };
  git(): Promise<string | undefined>;
  /** The hosted relay's address (ws or wss), when known: the check asks whether it answers. */ relayUrl?: string;
  /** Who is signed in, if anyone, as the service sees it (one request, made only when the check runs): `failed` means the sign-in is stored but the service did not accept it or could not be reached. */ account?(): Promise<{ signedIn: boolean; plan?: string; failed?: boolean }>;
  readFile(p: string): { text: string; mode: number } | undefined; exists(p: string): boolean;
}
export interface DoctorCheck { id: string; /** Whether this check needs the network (its own 3 s limit). */ network?: boolean; run(ctx: DoctorContext): Promise<CheckResult> }
export interface CheckReport { id: string; status: Status; summary: string; next_step?: string; duration_ms: number }
export interface DoctorReport { schema_version: 1; version: string; contract: string; checks: CheckReport[] }
