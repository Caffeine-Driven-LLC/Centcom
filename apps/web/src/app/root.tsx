import { Outlet, createRootRoute } from '@tanstack/react-router';
import React from 'react';
import { Frame } from './Frame.js';
import { ErrorBoundary } from '../lib/ErrorBoundary.js';
import { Card, EmptyState } from '../ui/index.js';
/** Every area hangs its routes on this one: `getParentRoute: () => rootRoute`. */
/** An address no area registered shows a page inside the frame, not the router's bare default. */
const NotFound = (): React.JSX.Element => <Card title="Centcom"><EmptyState title="Page not found">This address does not lead anywhere. Use the menu to go back.</EmptyState></Card>;
export const rootRoute = createRootRoute({ notFoundComponent: NotFound, component: () => <ErrorBoundary><Frame><Outlet /></Frame></ErrorBoundary> });
