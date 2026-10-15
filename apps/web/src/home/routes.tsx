import { createRoute } from '@tanstack/react-router';
import React from 'react';
import { rootRoute } from '../app/root.js';
import type { RouteModule } from '../app/types.js';
import { Card, EmptyState } from '../ui/index.js';
import { LocalPage } from '../local/routes.js';
import { localBridge } from '../local/use-local.js';

const home = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => (localBridge() ? <LocalPage /> : <Card title="Centcom"><EmptyState title="Open a session from a link">A session opens from the watch or invite link someone sends you. To manage your team and plan, use Workspaces and Billing.</EmptyState></Card>) });
export const routeModule: RouteModule = { routes: [home], nav: [{ id: 'home', labelKey: 'nav.home', to: '/', icon: 'home' }] };
export default routeModule;
