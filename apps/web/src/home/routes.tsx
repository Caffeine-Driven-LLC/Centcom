import { createRoute } from '@tanstack/react-router';
import React from 'react';
import { rootRoute } from '../app/root.js';
import type { RouteModule } from '../app/types.js';
import { Card, EmptyState } from '../ui/index.js';

const home = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <Card title="Centcom"><EmptyState title="Nothing here yet">Sessions, the fleet and your workspace appear here as they are built.</EmptyState></Card> });
export const routeModule: RouteModule = { routes: [home], nav: [{ id: 'home', labelKey: 'nav.home', to: '/', icon: 'home' }] };
export default routeModule;
