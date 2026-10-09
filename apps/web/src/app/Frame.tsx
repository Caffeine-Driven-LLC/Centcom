import { Link } from '@tanstack/react-router';
import React, { createContext, useContext, useState } from 'react';
import { Banner, CentoMark, PixelIcon } from '../ui/index.js';
import { useTheme } from '../theme/theme.js';
import { t } from '../i18n/index.js';
import { SkipLink } from '../a11y/focus.js';
import { ShortcutHost } from '../a11y/shortcuts.js';
import type { Connectivity } from '../lib/connectivity.js';
import type { NavItem } from './types.js';
import { unread } from '../settings/model.js';

export const ShellCtx = createContext<{ nav: NavItem[]; connectivity: Connectivity; inspector: React.ReactNode }>({ nav: [], connectivity: 'unknown', inspector: null });
export const useShell = (): React.ContextType<typeof ShellCtx> => useContext(ShellCtx);
/** 48 px top bar, 240 px left rail (a drawer under 1024), 320 px inspector (a bottom sheet under 768). */
export function Frame({ children }: { children: React.ReactNode }): React.JSX.Element {
  const n = React.useSyncExternalStore((f) => unread.subscribe(f), () => unread.count, () => 0);
  const { nav, connectivity, inspector } = useShell(); const [rail, setRail] = useState(false); const [insp, setInsp] = useState(false); const { theme, set } = useTheme();
  return (
    <ShortcutHost><div className="cc-frame"><SkipLink />
      <header className="cc-top"><button type="button" className="cc-btn cc-btn--ghost cc-railtoggle" aria-expanded={rail} aria-controls="cc-rail" onClick={() => setRail((v) => !v)}>{t('nav.menu')}</button><span className="cc-brand"><CentoMark size={26} /><strong className="cc-brand__word">Centcom</strong></span><span style={{ flex: 1 }} /><Link to={'/notifications' as never} className="cc-btn cc-btn--ghost" aria-label={n ? `Notifications, ${n} unread` : 'Notifications, none unread'}><PixelIcon name="bell" />{n ? <span className="cc-chip cc-chip--info">{n}</span> : null}</Link>
        <label className="cc-label" htmlFor="cc-theme">{t('theme.label')}</label><select id="cc-theme" className="cc-input" value={theme} onChange={(e) => set(e.target.value as 'dark' | 'light' | 'auto')}><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select>
        {inspector ? <button type="button" className="cc-btn cc-btn--ghost" aria-expanded={insp} aria-controls="cc-inspector" onClick={() => setInsp((v) => !v)}>{t('nav.details')}</button> : null}</header>
      {connectivity === 'offline' ? <Banner tone="info" title={t('net.unavailable')}>{t('net.unavailable.hint')}</Banner> : connectivity === 'degraded' ? <Banner tone="warning" title={t('net.degraded')}>{t('net.degraded.hint')}</Banner> : null}
      <div className="cc-body">
        <nav id="cc-rail" className="cc-rail" data-open={rail} aria-label={t('nav.label')}>{nav.map((n) => <Link key={n.id} to={n.to} className="cc-rail__link" onClick={() => setRail(false)}><PixelIcon name={n.icon} />{t(n.labelKey as never)}</Link>)}</nav>
        <main id="main" className="cc-main">{children}</main>
        {inspector ? <aside id="cc-inspector" className="cc-inspector" data-open={insp} aria-label={t('nav.details')}>{inspector}</aside> : null}
      </div>
    </div></ShortcutHost>
  );
}
