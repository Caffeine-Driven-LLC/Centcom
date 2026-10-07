import { createRouter, type AnyRoute } from '@tanstack/react-router';
import { rootRoute } from './root.js';
import { collectModules } from './modules.js';
import type { NavItem } from './types.js';

type Tree = Parameters<typeof createRouter>[0]['routeTree'];
/** Builds the router from the route modules found under `src/<area>/routes.tsx`. The route tree is assembled at run time, so its static type is erased here. */
export function buildRouter(found: Record<string, unknown>, history?: Parameters<typeof createRouter>[0]['history']): { router: ReturnType<typeof createRouter>; nav: NavItem[]; problems: string[] } {
  const { modules, nav, problems } = collectModules(found); const tree = (rootRoute as unknown as { addChildren(c: AnyRoute[]): unknown }).addChildren(modules.flatMap((m) => m.routes)) as Tree;
  return { router: createRouter({ routeTree: tree, defaultPreload: 'intent', ...(history ? { history } : {}) } as never), nav, problems };
}
