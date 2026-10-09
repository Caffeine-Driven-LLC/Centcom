import { createRouter, type AnyRoute } from '@tanstack/react-router';
import React from 'react';
import { rootRoute } from './root.js';
import { collectModules } from './modules.js';
import type { NavItem } from './types.js';

type Tree = Parameters<typeof createRouter>[0]['routeTree'];
/** Builds the router from the route modules found under `src/<area>/routes.tsx`. The route tree is assembled at run time, so its static type is erased here. */
/** What an address that matches no route shows (without one the router warns and shows a bare message). A route area may still set its own. */
export function NotFound() { return <main role="alert"><h1>Page not found</h1><p>This address does not lead anywhere.</p><a href="/">Back to the start</a></main>; }
export function buildRouter(found: Record<string, unknown>, history?: Parameters<typeof createRouter>[0]['history']): { router: ReturnType<typeof createRouter>; nav: NavItem[]; problems: string[] } {
  const { modules, nav, problems } = collectModules(found); const tree = (rootRoute as unknown as { addChildren(c: AnyRoute[]): unknown }).addChildren(modules.flatMap((m) => m.routes)) as Tree;
  return { router: createRouter({ routeTree: tree, defaultPreload: 'intent', defaultNotFoundComponent: NotFound, ...(history ? { history } : {}) } as never), nav, problems };
}
