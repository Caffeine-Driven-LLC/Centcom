import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme, getThemePref } from './theme.js';
import { Launcher } from './Launcher.js';
import { Workspace } from './Workspace.js';
import { useConnection } from './net.js';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

applyTheme(); matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => getThemePref() === 'system' && applyTheme());

function App() {
  const c = useConnection();
  // "Start as app" opens a window at ?open=<dir>; honour it once the launcher info has arrived
  useEffect(() => {
    if (!c.launcher || c.opened) return;
    const q = new URLSearchParams(location.search); const dir = q.get('open');
    if (dir) { history.replaceState(null, '', location.pathname); c.send({ t: 'open', dir, demo: q.get('demo') === '1', engine: q.get('engine') === 'codex' ? 'codex' : 'claude-code', resume: q.get('resume') ?? undefined }); }
  }, [c.launcher, c.opened, c]);
  if (c.opened) return <Workspace c={c} />;
  return <Launcher c={c} onStart={(dir, demo, mode, engine, resume) => { if (mode === 'app') { c.send({ t: 'launchApp', dir, demo, engine, resume }); } else c.send({ t: 'open', dir, demo, engine, resume }); }} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
