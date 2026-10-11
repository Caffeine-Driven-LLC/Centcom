import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Eraser, FolderGit2, History, Moon, Monitor, Plus, Search, Shield, Square, Sun, type LucideIcon } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { NavItem } from '../app/types.js';
import { t } from '../i18n/index.js';
import { useTheme } from '../theme/theme.js';
import { Dialog } from '../ui/shadcn/index.js';
import './shell.css';
import { isShown, pickEngine, runningWord, shortPath, whenAgo } from './model.js';
import { useLocal } from './use-local.js';

const MODES: [string, string][] = [['default', 'Ask before acting'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan only (read only)'], ['bypassPermissions', 'Skip approvals']];
const baseName = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p;

export interface Entry { id: string; group: string; label: string; hint?: string; icon: LucideIcon; keywords?: string; run(): void }
/** Entries whose label or keywords contain every word typed, in their original order. */
export function filterEntries(entries: Entry[], query: string): Entry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? entries.filter((e) => { const hay = `${e.label} ${e.keywords ?? ''} ${e.group}`.toLowerCase(); return words.every((w) => hay.includes(w)); }) : entries;
}

/** Ctrl/Cmd+K: every action of the session, the projects and saved sessions, and the screens, behind one search box. */
export function CommandPalette({ open, onOpenChange, nav }: { open: boolean; onOpenChange(o: boolean): void; nav: NavItem[] }): React.JSX.Element {
  const { view, send, available } = useLocal(); const navigate = useNavigate(); const { set: setTheme } = useTheme();
  const [query, setQuery] = useState(''); const [sel, setSel] = useState(0); const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setQuery(''); setSel(0); } }, [open]);
  const entries = useMemo<Entry[]>(() => {
    const L = view.launcher; const pick = L ? pickEngine(L) : undefined; const out: Entry[] = []; const toLocal = (): void => { void navigate({ to: '/local' as never }); };
    if (available) {
      out.push({ id: 'new', group: 'Session', label: 'New session', hint: 'Ctrl+N', keywords: 'another project leave', icon: Plus, run: () => { send({ t: 'leave' }); toLocal(); } });
      if (view.opened) {
        out.push({ id: 'compact', group: 'Session', label: 'Compact the conversation', icon: Eraser, run: () => send({ t: 'compact' }) });
        if (view.state?.busy) out.push({ id: 'stop', group: 'Session', label: 'Stop the agent', keywords: 'interrupt', icon: Square, run: () => send({ t: 'interrupt' }) });
        out.push({ id: 'close', group: 'Session', label: 'Close this project', icon: FolderGit2, run: () => { send({ t: 'close' }); toLocal(); } });
        for (const [m, l] of MODES) out.push({ id: `mode-${m}`, group: 'Session', label: `Mode: ${l}${view.state?.settings?.permissionMode === m ? ' ✓' : ''}`, keywords: 'permission', icon: Shield, run: () => send({ t: 'setMode', mode: m as never }) });
        for (const s of (view.state?.sessions ?? []).filter((x) => x.id !== view.state?.sessionId).slice(0, 8)) out.push({ id: `s-${s.id}`, group: 'Sessions in this project', label: s.title || 'Untitled', hint: whenAgo(s.updatedAt), keywords: 'resume session', icon: History, run: () => { send({ t: 'open', dir: view.opened!, engine: pick?.engine ?? 'claude-code', demo: !!view.state?.demo, resume: s.id }); toLocal(); } });
      }
      for (const r of view.running.filter((x) => !isShown(x, view))) out.push({ id: `r-${r.dir}-${r.engine}-${r.demo}`, group: 'Running sessions', label: baseName(r.dir), hint: runningWord(r), keywords: `${r.dir} switch`, icon: FolderGit2, run: () => { send({ t: 'open', dir: r.dir, engine: r.engine, demo: r.demo }); toLocal(); } });
      for (const r of (L?.recent ?? []).filter((x) => !view.running.some((y) => y.dir === x.dir)).slice(0, 10)) out.push({ id: `p-${r.dir}`, group: 'Projects', label: baseName(r.dir), hint: shortPath(r.dir, L!.home), keywords: r.dir, icon: FolderGit2, run: () => { send({ t: 'open', dir: r.dir, engine: pick!.engine, demo: pick!.demo }); toLocal(); } });
    }
    for (const n of nav) out.push({ id: `go-${n.id}`, group: 'Go to', label: t(n.labelKey as never), icon: ArrowRight, run: () => { void navigate({ to: n.to as never }); } });
    out.push({ id: 'dark', group: 'Appearance', label: 'Dark theme', icon: Moon, run: () => setTheme('dark') }, { id: 'light', group: 'Appearance', label: 'Light theme', icon: Sun, run: () => setTheme('light') }, { id: 'auto', group: 'Appearance', label: 'Follow the system', keywords: 'theme auto', icon: Monitor, run: () => setTheme('auto') });
    return out;
  }, [view, available, nav, navigate, send, setTheme]);
  const shown = filterEntries(entries, query); const at = Math.min(sel, Math.max(0, shown.length - 1));
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [at, query]);
  const run = (e: Entry | undefined): void => { if (!e) return; onOpenChange(false); e.run(); };
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((at + 1) % Math.max(1, shown.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((at - 1 + shown.length) % Math.max(1, shown.length)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(shown[at]); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange} label="Search and commands">
    <div onKeyDown={onKey}>
      <div className="pal__search"><Search aria-hidden="true" />
        <input autoFocus role="combobox" aria-expanded="true" aria-controls="cc-pal" aria-activedescendant={shown[at] ? `pal-${shown[at]!.id}` : undefined} aria-label="Search commands, projects and sessions" placeholder="Search commands, projects and sessions…" value={query} onChange={(e) => { setQuery(e.target.value); setSel(0); }} className="pal__input" /></div>
      <div id="cc-pal" role="listbox" ref={list} className="pal__list">
        {shown.length === 0 ? <p className="pal__empty">Nothing matches.</p> : shown.map((e, i) => <React.Fragment key={e.id}>
          {i === 0 || shown[i - 1]!.group !== e.group ? <div className="pal__group" role="presentation">{e.group}</div> : null}
          <div id={`pal-${e.id}`} role="option" aria-selected={i === at} className="pal__item" onMouseMove={() => setSel(i)} onClick={() => run(e)}>
            <e.icon aria-hidden="true" /><span className="pal__label">{e.label}</span>{e.hint ? <span className="pal__hint">{e.hint}</span> : null}
          </div>
        </React.Fragment>)}
      </div>
    </div>
  </Dialog>;
}
