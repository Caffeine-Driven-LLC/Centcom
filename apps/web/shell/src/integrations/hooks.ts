import { useEffect, useState } from 'react';
import { useHttp } from '../lib/http-context.js';
import { ulid } from '../workspace/data.js';
import type { WorkspaceRole } from '../workspace/rbac.js';
import type { Ent } from './data.js';
export { ulid };
/** Your role in this workspace and its plan limits. Nothing else is fetched until the role says you may: admin pages never ask for what they will be refused. */
export function useWsRole(ws: string): { role?: WorkspaceRole; ent?: Ent; loaded: boolean } {
  const http = useHttp(); const [s, setS] = useState<{ role?: WorkspaceRole; ent?: Ent; loaded: boolean }>({ loaded: false });
  useEffect(() => { let on = true; void (async () => { try { const w = (await http.call('getWorkspace', { id: ws })).data as { role?: WorkspaceRole }; let ent: Ent | undefined; if (w.role === 'owner' || w.role === 'admin') ent = (await http.call('getEntitlements', { id: ws }).catch(() => undefined))?.data as Ent | undefined; if (on) setS({ role: w.role, ent, loaded: true }); } catch { if (on) setS({ loaded: true }); } })(); return () => { on = false; }; }, [http, ws]);
  return s;
}
