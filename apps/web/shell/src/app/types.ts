import type { AnyRoute } from '@tanstack/react-router';
export type PixelIconName = string; export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'billing' | 'guest';
export type NavItem = { id: string; labelKey: string; to: string; icon: PixelIconName; requires?: { role?: WorkspaceRole[]; entitlement?: string } };
/** Every area exports one of these from `src/<area>/routes.tsx`; the shell registers it without any edit in `src/app/`. */
export type RouteModule = { routes: AnyRoute[]; nav?: NavItem[] };
