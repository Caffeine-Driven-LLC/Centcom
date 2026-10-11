import { useNavigate } from '@tanstack/react-router';
import { Eraser, FolderGit2, History, Moon, Monitor, Plus, Shield, Square, Sun, ArrowRight } from 'lucide-react';
import React from 'react';
import type { NavItem } from '../app/types.js';
import { t } from '../i18n/index.js';
import { useTheme } from '../theme/theme.js';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/shadcn/index.js';
import { pickEngine, shortPath, whenAgo } from './model.js';
import { useLocal } from './use-local.js';

const MODES: [string, string][] = [['default', 'Ask before acting'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan only (read only)'], ['bypassPermissions', 'Skip approvals']];
const baseName = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p;

/** Ctrl/Cmd+K: every action of the session, the projects and saved sessions, and the screens, with one search box. */
export function CommandPalette({ open, onOpenChange, nav }: { open: boolean; onOpenChange(o: boolean): void; nav: NavItem[] }): React.JSX.Element {
  const { view, send, available } = useLocal(); const navigate = useNavigate(); const { set: setTheme } = useTheme();
  const L = view.launcher; const pick = L ? pickEngine(L) : undefined;
  const run = (f: () => void) => (): void => { onOpenChange(false); f(); };
  const toLocal = (): void => { void navigate({ to: '/local' as never }); };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined}>
      <DialogTitle className="sr-only">Search and commands</DialogTitle><DialogDescription className="sr-only">Type to find a command, project, session or screen.</DialogDescription>
      <Command loop>
        <CommandInput placeholder="Search commands, projects and sessions…" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          {available ? <CommandGroup heading="Session">
            <CommandItem value="new session" onSelect={run(() => { send({ t: 'close' }); toLocal(); })}><Plus aria-hidden="true" />New session</CommandItem>
            {view.opened ? <>
              <CommandItem value="compact conversation" onSelect={run(() => send({ t: 'compact' }))}><Eraser aria-hidden="true" />Compact the conversation</CommandItem>
              {view.state?.busy ? <CommandItem value="stop interrupt" onSelect={run(() => send({ t: 'interrupt' }))}><Square aria-hidden="true" />Stop the agent</CommandItem> : null}
              <CommandItem value="close project" onSelect={run(() => { send({ t: 'close' }); toLocal(); })}><FolderGit2 aria-hidden="true" />Close this project</CommandItem>
              {MODES.map(([m, l]) => <CommandItem key={m} value={`mode ${l}`} onSelect={run(() => send({ t: 'setMode', mode: m as never }))}><Shield aria-hidden="true" />Mode: {l}{view.state?.settings?.permissionMode === m ? ' ✓' : ''}</CommandItem>)}
            </> : null}
          </CommandGroup> : null}
          {available && view.opened && view.state?.sessions.length ? <CommandGroup heading="Sessions in this project">
            {view.state.sessions.filter((s) => s.id !== view.state?.sessionId).slice(0, 8).map((s) => <CommandItem key={s.id} value={`session ${s.title} ${s.id}`} onSelect={run(() => { send({ t: 'open', dir: view.opened!, engine: pick?.engine ?? 'claude-code', demo: !!view.state?.demo, resume: s.id }); toLocal(); })}><History aria-hidden="true" /><span className="truncate">{s.title || 'Untitled'}</span><span className="ml-auto text-xs text-muted-foreground">{whenAgo(s.updatedAt)}</span></CommandItem>)}
          </CommandGroup> : null}
          {available && L?.recent.length ? <CommandGroup heading="Projects">
            {L.recent.slice(0, 10).map((r) => <CommandItem key={r.dir} value={`project ${r.dir}`} onSelect={run(() => { send({ t: 'open', dir: r.dir, engine: pick!.engine, demo: pick!.demo }); toLocal(); })}><FolderGit2 aria-hidden="true" /><span className="truncate">{baseName(r.dir)}</span><span className="ml-auto truncate text-xs text-muted-foreground">{shortPath(r.dir, L.home)}</span></CommandItem>)}
          </CommandGroup> : null}
          <CommandGroup heading="Go to">
            {nav.map((n) => <CommandItem key={n.id} value={`go ${t(n.labelKey as never)}`} onSelect={run(() => { void navigate({ to: n.to as never }); })}><ArrowRight aria-hidden="true" />{t(n.labelKey as never)}</CommandItem>)}
          </CommandGroup>
          <CommandGroup heading="Appearance">
            <CommandItem value="theme dark" onSelect={run(() => setTheme('dark'))}><Moon aria-hidden="true" />Dark theme</CommandItem>
            <CommandItem value="theme light" onSelect={run(() => setTheme('light'))}><Sun aria-hidden="true" />Light theme</CommandItem>
            <CommandItem value="theme auto system" onSelect={run(() => setTheme('auto'))}><Monitor aria-hidden="true" />Follow the system</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </DialogContent>
  </Dialog>;
}
