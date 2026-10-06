import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme } from '@centcom/theme';
import { Launcher } from './Launcher.js';
import { Workspace } from './Workspace.js';
import { useConnection } from './net.js';
import './styles.css';

const TOKENS = ['bg.base', 'bg.surface', 'bg.raised', 'bg.overlay', 'bg.sunken', 'bg.hover', 'bg.selected', 'border.subtle', 'border.default', 'border.strong', 'text.primary', 'text.secondary', 'text.muted', 'text.link', 'accent.primary', 'accent.fill', 'accent.hover', 'accent.on', 'signal', 'status.success', 'status.warning', 'status.danger', 'status.info'] as const;
function applyTheme() {
  const mode = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; const t = createTheme(mode, 'truecolor');
  for (const k of TOKENS) document.documentElement.style.setProperty('--' + k.replace('.', '-'), t.c(k));
  document.documentElement.dataset.theme = mode;
}
applyTheme(); matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

function App() {
  const c = useConnection();
  // "Start as app" opens a window at ?open=<dir>; honour it once the launcher info has arrived
  useEffect(() => {
    if (!c.launcher || c.opened) return;
    const q = new URLSearchParams(location.search); const dir = q.get('open');
    if (dir) { history.replaceState(null, '', location.pathname); c.send({ t: 'open', dir, demo: q.get('demo') === '1' }); }
  }, [c.launcher, c.opened, c]);
  if (c.opened) return <Workspace c={c} />;
  return <Launcher c={c} onStart={(dir, demo, mode) => { if (mode === 'app') { c.send({ t: 'launchApp', dir, demo }); } else c.send({ t: 'open', dir, demo }); }} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
