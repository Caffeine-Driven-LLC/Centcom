import { createMemoryHistory, createRoute } from '@tanstack/react-router';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { buildRouter } from '../../src/app/router.js';
import { collectModules, visibleNav } from '../../src/app/modules.js';
import { rootRoute } from '../../src/app/root.js';
import type { RouteModule } from '../../src/app/types.js';

const area = (path: string, id: string): RouteModule => ({ routes: [createRoute({ getParentRoute: () => rootRoute, path, component: () => <p>{id}</p> })], nav: [{ id, labelKey: `nav.${id}`, to: path, icon: 'home' }] });
describe('plug-in routes (acceptance 5)', () => {
  it('a new area with a RouteModule resolves its path with nothing edited in src/app', async () => {
    const found = { './x/routes.tsx': { routeModule: area('/x', 'x') }, './y/routes.tsx': { default: area('/y', 'y') } }; const { router, nav, problems } = buildRouter(found, createMemoryHistory({ initialEntries: ['/x'] }));
    await router.load(); expect(problems).toEqual([]); expect(router.state.matches.map((m) => m.routeId)).toContain('/x'); expect(nav.map((n) => n.id)).toEqual(['x', 'y']); router.history.push('/y'); await router.load(); expect(router.state.location.pathname).toBe('/y');
  });
  it('a module without routes or a duplicate nav id is reported, not fatal', () => { const { modules, problems } = collectModules({ './bad/routes.tsx': { nothing: 1 }, './a/routes.tsx': { default: area('/a', 'same') }, './b/routes.tsx': { default: area('/b', 'same') } }); expect(modules).toHaveLength(2); expect(problems).toHaveLength(2); });
  it('the navigation hides what the role or plan does not allow', () => { const nav = [{ id: 'a', labelKey: 'a', to: '/a', icon: 'x' }, { id: 'b', labelKey: 'b', to: '/b', icon: 'x', requires: { role: ['owner' as const, 'admin' as const] } }, { id: 'c', labelKey: 'c', to: '/c', icon: 'x', requires: { entitlement: 'fleet' } }]; expect(visibleNav(nav, { role: 'member' }).map((n) => n.id)).toEqual(['a']); expect(visibleNav(nav, { role: 'admin', entitlements: ['fleet'] }).map((n) => n.id)).toEqual(['a', 'b', 'c']); });
});
