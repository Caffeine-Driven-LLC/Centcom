import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../app/root.js';
import type { RouteModule } from '../app/types.js';
import { SessionPage } from './page.js';

export const routeModule: RouteModule = { routes: [createRoute({ getParentRoute: () => rootRoute, path: '/s/$sessionId', component: SessionPage })] };
export default routeModule;
