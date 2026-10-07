import '../../../../assets/theme/theme.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import { RouterProvider } from '@tanstack/react-router';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { buildRouter } from './app/router.js';
import { ShellCtx } from './app/Frame.js';
import { parseEnv } from './lib/env.js';
import { makeApi } from './lib/api.js';
import { useConnectivity } from './lib/connectivity.js';
import { initTheme } from './theme/theme.js';
import { ToastProvider } from './ui/index.js';

initTheme(); const { env, problems: envProblems } = parseEnv(import.meta.env as Record<string, unknown>); const { router, nav, problems } = buildRouter(import.meta.glob('./*/routes.tsx', { eager: true }));
for (const p of [...envProblems, ...problems]) console.warn(p); const api = makeApi(env);
function Shell(): React.JSX.Element { const connectivity = useConnectivity(api as never); return <ShellCtx.Provider value={{ nav, connectivity, inspector: null }}><ToastProvider><RouterProvider router={router} /></ToastProvider></ShellCtx.Provider>; }
createRoot(document.getElementById('root')!).render(<React.StrictMode><Shell /></React.StrictMode>);
