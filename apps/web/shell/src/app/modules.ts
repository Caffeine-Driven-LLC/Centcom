import type { NavItem, RouteModule } from './types.js';
/** Picks up every `src/<area>/routes.tsx` (or a fixture map in tests): no file in `src/app/` names an area. */
export function collectModules(found: Record<string, unknown>): { modules: RouteModule[]; nav: NavItem[]; problems: string[] } {
  const modules: RouteModule[] = []; const problems: string[] = []; const seen = new Set<string>();
  for (const [path, m] of Object.entries(found).sort(([a], [b]) => a.localeCompare(b))) {
    const mod = (m as { default?: unknown; routeModule?: unknown }); const cand = (mod.routeModule ?? mod.default ?? m) as Partial<RouteModule>;
    if (!cand || !Array.isArray(cand.routes)) { problems.push(`${path}: no routes exported`); continue; }
    for (const n of cand.nav ?? []) { if (seen.has(n.id)) { problems.push(`${path}: nav id ${n.id} is already taken`); continue; } seen.add(n.id); }
    modules.push(cand as RouteModule);
  }
  return { modules, nav: modules.flatMap((m) => m.nav ?? []).filter((n, i, a) => a.findIndex((x) => x.id === n.id) === i), problems };
}
/** Hides what the person may not use; the server stays the authority. */
export function visibleNav(nav: NavItem[], who: { role?: string; entitlements?: string[] }): NavItem[] {
  return nav.filter((n) => (!n.requires?.role || (who.role !== undefined && (n.requires.role as string[]).includes(who.role))) && (!n.requires?.entitlement || (who.entitlements ?? []).includes(n.requires.entitlement)));
}
