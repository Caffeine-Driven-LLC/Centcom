import { createRoute } from '@tanstack/react-router';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { rootRoute } from '../app/root.js';
import type { RouteModule } from '../app/types.js';
import { Button, Card, Skeleton } from '../ui/index.js';
import { ConflictList, FleetBoard } from './components.js';
import type { FleetStore } from './model.js';

/** The session page (lane C083) provides the store its frames feed; until then the route says it is waiting. */
const Ctx = createContext<FleetStore | undefined>(undefined); export const FleetProvider = Ctx.Provider;
export function FleetPage(): React.JSX.Element {
  const store = useContext(Ctx); const [ver, bump] = useState(0); const [owner, setOwner] = useState(''); const [state, setState] = useState(''); const [view, setView] = useState<'cards' | 'table'>('cards'); const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const u = store?.subscribe(() => bump((x) => x + 1)); const h = setInterval(() => setNow(Date.now()), 1000); return () => { u?.(); clearInterval(h); }; }, [store]);
  const cards = useMemo(() => store?.cards({ ...(owner ? { owner } : {}), ...(state ? { state } : {}) }) ?? [], [store, owner, state, now, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!store) return <Skeleton lines={3} />; void ver; const all = store.cards(); const owners = [...new Map(all.map((c) => [c.owner, c.ownerName])).entries()]; const states = [...new Set(all.map((c) => c.state))];
  return <Card title="Fleet"><div className="cc-row"><label className="cc-label" htmlFor="fo">Owner</label><select id="fo" className="cc-input" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Everyone</option>{owners.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select><label className="cc-label" htmlFor="fs">State</label><select id="fs" className="cc-input" value={state} onChange={(e) => setState(e.target.value)}><option value="">Any</option>{states.map((s) => <option key={s} value={s}>{s}</option>)}</select><Button onClick={() => setView(view === 'cards' ? 'table' : 'cards')}>{view === 'cards' ? 'Compact table' : 'Cards'}</Button></div>
    <ConflictList cards={all} /><FleetBoard cards={cards} now={now} view={view} /></Card>;
}
export const routeModule: RouteModule = { routes: [createRoute({ getParentRoute: () => rootRoute, path: '/s/$sessionId/fleet', component: FleetPage })] };
export default routeModule;
