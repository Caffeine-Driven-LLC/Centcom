import { Outlet, createRootRoute } from '@tanstack/react-router';
import React from 'react';
import { Frame } from './Frame.js';
import { ErrorBoundary } from '../lib/ErrorBoundary.js';
/** Every area hangs its routes on this one: `getParentRoute: () => rootRoute`. */
export const rootRoute = createRootRoute({ component: () => <ErrorBoundary><Frame><Outlet /></Frame></ErrorBoundary> });
