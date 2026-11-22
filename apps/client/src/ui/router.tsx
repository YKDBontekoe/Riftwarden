// Out-of-game screens are routes (architecture v2 section 11): the main menu sections and co-op invite links.
// Hash history (`/?test#/account`) keeps automation query strings intact and needs no fallback on static hosting.
// The Babylon canvas and the in-game screens live outside routing: the router only decides which menu sheet shows.
import { createHashHistory, createRootRoute, createRoute, createRouter, RouterProvider, useNavigate, useRouterState } from '@tanstack/react-router';
import type { Flow } from '../core/Flow';
import { App } from './App';

export const MENU_SECTIONS = {
  briefing: 'Briefing',
  'co-op': 'Co-op',
  account: 'Account',
  settings: 'Settings',
  controls: 'Controls',
} as const;
export type MenuSection = keyof typeof MENU_SECTIONS;

/** The whole UI renders at the root route (so every screen can read and change the route); child routes are only
 * names for menu sheets. */
export function createAppRouter(getFlow: () => Flow | null) {
  const rootRoute = createRootRoute({ component: () => <App getFlow={getFlow} /> });
  const routes = [
    createRoute({ getParentRoute: () => rootRoute, path: '/' }),
    ...(Object.keys(MENU_SECTIONS) as MenuSection[]).map((s) => createRoute({ getParentRoute: () => rootRoute, path: `/${s}` })),
    createRoute({ getParentRoute: () => rootRoute, path: '/join/$code' }),
  ];
  return createRouter({ routeTree: rootRoute.addChildren(routes), history: createHashHistory() });
}

/** The menu section the current route shows (an invite link opens co-op). */
export function useMenuSection(): [MenuSection | null, (s: MenuSection | null) => void] {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const section = path.startsWith('/join/') ? 'co-op' : ((path.slice(1) as MenuSection) in MENU_SECTIONS ? (path.slice(1) as MenuSection) : null);
  return [section, (s) => void navigate({ to: s ? `/${s}` : '/' })];
}

/** Join code from an invite link: `#/join/CODE` (or the older `?join=CODE`). */
export function inviteCode(): string {
  const m = /^#\/join\/([^/?#]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : (new URLSearchParams(location.search).get('join') ?? '');
}

export function Root({ router }: { router: ReturnType<typeof createAppRouter> }) {
  return <RouterProvider router={router} />;
}
