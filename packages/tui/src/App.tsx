import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, usePaste, useWindowSize } from 'ink';
import { createTheme, type ColorTier } from '@centcom/theme';
import { bakedCategories } from '@centcom/mascot';
import { CLAUDE_MODELS } from '@centcom/agent';
import type { AppController } from './controller.js';
import { ThemeCtx, useStore } from './components/ui.js';
import { TaskList } from './tasks/TaskList.js';
import { actions as allActions, createDispatcher, defaultKeymap, fromInk, HelpScreen, type KeyContext, type Keymap, type KeymapWarning } from './keys/index.js';
import { Header } from './components/Header.js';
import { Welcome } from './components/Welcome.js';
import { LiveStrip, LARGE_H } from './components/LiveStrip.js';
import { Approval, approvalHeight } from './components/Approval.js';
import { Prompt, SlashPopup, promptRows, slashMatches } from './components/Prompt.js';
import { StatusLine } from './components/StatusLine.js';
import { FleetPanel, FLEET_W } from './components/FleetPanel.js';
import { Transcript, useTranscriptLayout } from './components/Transcript.js';
import { Palette, Gallery, ModelPicker, galleryList, paletteItems } from './components/Overlays.js';
import { Toasts } from './components/Toasts.js';
import { NightPanel } from './night/NightPanel.js';
import { COMMANDS } from './state/commands.js';
import * as ed from './util/editor.js';

export interface AppProps { ctl: AppController; tier: ColorTier; /** The resolved keymap (defaults plus keybindings.json) and what was wrong with the file. */ keys?: { keymap: Keymap; warnings: KeymapWarning[] } }

export function App({ ctl, tier, keys }: AppProps) {
  const s = useStore(ctl.store);
  const win = useWindowSize();
  const cols = win.columns; const rows = Math.max(1, win.rows - 1); // Ink clears the whole screen every frame when output is as tall as the terminal; stay one row short
  const theme = useMemo(() => createTheme(s.settings.theme, tier), [s.settings.theme, tier]);
  const keymap = useMemo(() => keys?.keymap ?? defaultKeymap(allActions()), [keys]); const focusRef = useRef<KeyContext[]>(['prompt']);
  const dispatcher = useMemo(() => createDispatcher({ keymap, focus: () => focusRef.current, clock: { now: () => Date.now() } }), [keymap]);
  const [confirming, setConfirming] = useState(false);
  const pending = s.approvals[0];
  useEffect(() => { setConfirming(false); }, [pending?.req.approval_id]);

  /* ---- layout ---- */
  const showFleet = s.fleet && s.agents.length > 1 && cols >= 110 && s.mode === 'chat'; // a solo session has no fleet panel; it appears when others join
  const mainW = cols - (showFleet ? FLEET_W + 1 : 0);
  const mascot = s.settings.mascot === 'auto' ? (rows >= 34 ? 'large' : rows >= 22 ? 'small' : 'off') : s.settings.mascot;
  const welcome = s.items.length === 0 && !s.busy && s.mode === 'chat' && !pending;
  const nightOpen = s.mode === 'night';
  const tight = !!pending && rows < 30;
  const stripH = welcome ? 0 : tight ? 1 : mascot === 'large' ? LARGE_H : mascot === 'small' ? 4 : 1;
  const stripSize = tight && mascot !== 'off' ? 'off' : mascot;
  const matches = (s.mode === 'chat' || s.mode === 'night') && !pending ? slashMatches(s.input) : [];
  const popupH = Math.min(6, matches.length);
  const inputRows = promptRows(s.input, s.cursor, mainW);
  const promptH = inputRows + 2;
  const maxDiff = Math.max(3, Math.min(10, rows - 20));
  const showTasks = s.tasksOpen && s.tasks.length > 0 && !pending && s.mode === 'chat';
  const tasksH = showTasks ? Math.min(s.tasks.length, rows >= 34 ? 10 : 5) + 1 + (s.tasks.length > (rows >= 34 ? 10 : 5) ? 1 : 0) : 0;
  const bottomH = pending ? approvalHeight(pending, mainW, maxDiff) : promptH + popupH + tasksH;
  const bodyH = Math.max(3, rows - 2 - stripH - bottomH);
  const layout = useTranscriptLayout(s.items, mainW - 2);
  const total = layout.total;

  // keep the view anchored while the user is scrolled up and new lines arrive; count the new messages; keep the top block in place on a resize
  const prevTotal = useRef(total); const prevW = useRef(mainW); const prevCount = useRef(s.items.length); const anchor = useRef<{ id: string; offset: number } | undefined>(undefined); const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    if (prevW.current !== mainW) { prevW.current = mainW; prevTotal.current = total; const a = anchor.current; if (a && ctl.state.scroll > 0) { const row = layout.rowOf(a); if (row !== undefined) ctl.patch({ scroll: Math.max(0, total - row - bodyH) }); } return; }
    const d = total - prevTotal.current; prevTotal.current = total; if (d > 0 && ctl.state.scroll > 0) ctl.patch({ scroll: ctl.state.scroll + d });
  }, [total, mainW, ctl, layout, bodyH]);
  useEffect(() => { const added = s.items.length - prevCount.current; prevCount.current = s.items.length; if (s.scroll > 0 && added > 0) setUnseen((u) => u + added); else if (s.scroll === 0) setUnseen(0); }, [s.items.length, s.scroll]);
  useEffect(() => { if (s.scroll > 0) anchor.current = layout.anchorAt(Math.max(0, total - s.scroll - bodyH)); else anchor.current = undefined; });
  const maxScroll = Math.max(0, total - bodyH);
  const setScroll = (n: number) => ctl.patch({ scroll: Math.max(0, Math.min(maxScroll, n)) });

  /* ---- keys ---- */
  const edit = (fn: (e: ed.Ed) => ed.Ed) => { const e = fn({ text: s.input, cursor: s.cursor }); ctl.patch({ input: e.text, cursor: e.cursor, slashSel: 0, histIdx: null }); };
  const complete = () => {
    const m = matches[s.slashSel % Math.max(1, matches.length)]; if (!m) return false;
    const t = '/' + m.name + (m.args ? ' ' : ''); ctl.patch({ input: t, cursor: t.length, slashSel: 0 }); return true;
  };

  usePaste((text) => {
    if (s.mode === 'palette') { ctl.patch({ palette: { query: s.palette.query + text.replace(/\s+/g, ' '), sel: 0 } }); return; }
    if (s.mode === 'chat' && !pending) edit((e) => ed.insert(e, text.replace(/\r\n?/g, '\n')));
  });

  useInput((input, key) => {
    if (key.ctrl && input === 'c') { ctl.ctrlC(); return; }
    /* approvals */
    if (pending) {
      focusRef.current = ['permission']; const high = pending.req.risk === 'high'; const step = fromInk(input, key);
      if (confirming) { if (key.return) ctl.answerApproval('approve'); else if (step && dispatcher.handle(step).kind === 'action' && key.escape) ctl.answerApproval('deny'); return; }
      const d = step ? dispatcher.handle(step) : { kind: 'none' as const };
      if (d.kind === 'action') {
        if (d.action === 'approval.deny') { ctl.answerApproval('deny'); return; }
        if (d.action === 'approval.approve') { if (high) setConfirming(true); else ctl.answerApproval('approve'); return; }
        if (d.action === 'approval.always' && !high) { ctl.answerApproval('approve', 'always'); return; }
        if (d.action === 'transcript.page_up') { setScroll(s.scroll + Math.floor(bodyH / 2)); return; } if (d.action === 'transcript.page_down') { setScroll(s.scroll - Math.floor(bodyH / 2)); return; }
      }
      return;
    }
    /* overlays */
    if (s.mode === 'help') return; // the help screen reads its own keys (filter, esc)
    if (s.mode === 'palette') {
      if (key.escape) { ctl.patch({ mode: 'chat' }); return; }
      const items = paletteItems(s.palette.query);
      if (key.upArrow) { ctl.patch({ palette: { ...s.palette, sel: (s.palette.sel + items.length - 1) % Math.max(1, items.length) } }); return; }
      if (key.downArrow || key.tab) { ctl.patch({ palette: { ...s.palette, sel: (s.palette.sel + 1) % Math.max(1, items.length) } }); return; }
      if (key.return) { const it = items[s.palette.sel % Math.max(1, items.length)]; ctl.patch({ mode: 'chat' }); if (it) { const needsArg = COMMANDS.find((c) => '/' + c.name === it.run)?.args && !it.run.includes(' '); if (needsArg) ctl.patch({ input: it.run + ' ', cursor: it.run.length + 1 }); else void ctl.submit(it.run); } return; }
      if (key.backspace || key.delete) { ctl.patch({ palette: { query: s.palette.query.slice(0, -1), sel: 0 } }); return; }
      if (input && !key.ctrl && !key.meta) ctl.patch({ palette: { query: s.palette.query + input, sel: 0 } });
      return;
    }
    if (s.mode === 'models') {
      focusRef.current = ['overlay']; { const st = fromInk(input, key); if (st && dispatcher.handle(st).kind === 'action' && (key.escape || input === 'q')) { ctl.patch({ mode: 'chat' }); return; } }
      if (key.upArrow) ctl.patch({ modelSel: (s.modelSel + CLAUDE_MODELS.length - 1) % CLAUDE_MODELS.length });
      else if (key.downArrow) ctl.patch({ modelSel: (s.modelSel + 1) % CLAUDE_MODELS.length });
      else if (key.return) { ctl.patch({ mode: 'chat' }); ctl.setModel(CLAUDE_MODELS[s.modelSel]!.id); }
      return;
    }
    if (s.mode === 'gallery') {
      const g = s.gallery; const list = galleryList(g.cat); const cats = bakedCategories();
      if (key.escape || input === 'q') { ctl.patch({ mode: 'chat' }); return; }
      if (key.leftArrow) ctl.patch({ gallery: { ...g, cat: (g.cat + cats.length - 1) % cats.length, idx: 0 } });
      else if (key.rightArrow) ctl.patch({ gallery: { ...g, cat: (g.cat + 1) % cats.length, idx: 0 } });
      else if (key.upArrow) ctl.patch({ gallery: { ...g, idx: (g.idx + list.length - 1) % list.length } });
      else if (key.downArrow) ctl.patch({ gallery: { ...g, idx: (g.idx + 1) % list.length } });
      else if (key.pageDown) ctl.patch({ gallery: { ...g, idx: Math.min(list.length - 1, g.idx + 8) } });
      else if (key.pageUp) ctl.patch({ gallery: { ...g, idx: Math.max(0, g.idx - 8) } });
      else if (input === 'c') ctl.patch({ gallery: { ...g, color: g.color + 1 } });
      return;
    }
    if (s.mode === 'night') { // the prompt below stays live: Enter adds a task (an empty Enter starts the night), Esc hides the panel
      if (key.escape) { ctl.closeNight(); return; }
      if (key.return && !s.input.endsWith('\\')) { if (s.input.trim()) { void ctl.submit(s.input); ctl.patch({ input: '', cursor: 0 }); } else ctl.nightStart(); return; }
    }
    /* chat: shortcuts are actions in the keymap; anything else is editing */
    focusRef.current = ['prompt', 'transcript']; const step = fromInk(input, key);
    const typingQuestion = input === '?' && !!s.input; // `?` types itself unless the prompt is empty
    const d = step && !typingQuestion ? dispatcher.handle(step) : { kind: 'none' as const };
    if (d.kind === 'pending') return;
    if (d.kind === 'action') {
      const page = Math.max(3, Math.floor(bodyH / 2));
      switch (d.action) {
        case 'help.open': ctl.patch({ mode: 'help' }); return;
        case 'app.quit': if (!s.input) { ctl.quit(); return; } break;
        case 'palette.open': ctl.patch({ mode: 'palette', palette: { query: '', sel: 0 } }); return;
        case 'models.open': { const i = CLAUDE_MODELS.findIndex((m) => m.id === s.settings.model); ctl.patch({ mode: 'models', modelSel: Math.max(0, i) }); return; }
        case 'mode.cycle': ctl.cycleMode(); return;
        case 'agent.interrupt': if (s.busy) void ctl.interrupt(); else if (s.input) ctl.patch({ input: '', cursor: 0 }); else ctl.escIdle(); return;
        case 'tasks.toggle': ctl.patch({ tasksOpen: !s.tasksOpen }); return;
        case 'night.toggle': ctl.openNight(); return;
        case 'fleet.toggle': ctl.patch({ fleet: !s.fleet }); return;
        case 'transcript.bottom': setScroll(0); return;
        case 'transcript.top': setScroll(maxScroll); return;
        case 'transcript.page_up': setScroll(s.scroll + Math.max(1, bodyH - 2)); return;
        case 'transcript.page_down': setScroll(s.scroll - Math.max(1, bodyH - 2)); return;
        case 'transcript.line_up': setScroll(s.scroll + 3); return;
        case 'transcript.line_down': setScroll(s.scroll - 3); return;
        default: break;
      }
    }
    if (key.end && !s.input) { setScroll(0); return; }
    if (key.return) {
      if (matches.length) {
        const m = matches[s.slashSel % matches.length]!;
        const typed = s.input.slice(1);
        if (m.name !== typed) { complete(); if (!m.args) void ctl.submit('/' + m.name); return; }
      }
      if (s.input.endsWith('\\')) { edit((e) => ed.insert(ed.backspace(e), '\n')); return; }
      void ctl.submit(s.input); return;
    }
    if (key.tab) { complete(); return; }
    if (key.upArrow) {
      if (matches.length) { ctl.patch({ slashSel: (s.slashSel + matches.length - 1) % matches.length }); return; }
      const m = ed.moveVertical({ text: s.input, cursor: s.cursor }, -1); if (m) ctl.patch({ cursor: m.cursor }); else ctl.historyStep(-1); return;
    }
    if (key.downArrow) {
      if (matches.length) { ctl.patch({ slashSel: (s.slashSel + 1) % matches.length }); return; }
      const m = ed.moveVertical({ text: s.input, cursor: s.cursor }, 1); if (m) ctl.patch({ cursor: m.cursor }); else ctl.historyStep(1); return;
    }
    if (key.leftArrow) { edit(key.ctrl || key.meta ? ed.wordLeft : ed.left); return; }
    if (key.rightArrow) { edit(key.ctrl || key.meta ? ed.wordRight : ed.right); return; }
    if (key.home || (key.ctrl && input === 'a')) { edit(ed.lineStart); return; }
    if (key.end || (key.ctrl && input === 'e')) { edit(ed.lineEnd); return; }
    if (key.backspace) { edit(key.meta ? ed.killWordLeft : ed.backspace); return; }
    if (key.delete) { edit(ed.del); return; }
    if (key.ctrl && input === 'w') { edit(ed.killWordLeft); return; }
    if (key.ctrl && input === 'u') { edit(ed.killToLineStart); return; }
    if (key.ctrl && input === 'j') { edit((e) => ed.insert(e, '\n')); return; }
    if (key.meta && input === 'b') { edit(ed.wordLeft); return; }
    if (key.meta && input === 'f') { edit(ed.wordRight); return; }
    if (input && !key.ctrl && !key.meta) edit((e) => ed.insert(e, input.replace(/\r\n?/g, '\n')));
  });

  if (cols < 60 || rows < 14) {
    return <Box width={cols} height={rows} alignItems="center" justifyContent="center"><Text>Centcom needs at least 60×14. Resize the window.</Text></Box>;
  }

  const placeholder = s.busy ? 'Cento is working… Esc to interrupt' : s.items.length ? 'Message Cento…' : 'What should we build?';
  const gallerySize = bodyH;
  return (
    <ThemeCtx.Provider value={theme}>
      <Box flexDirection="column" width={cols} height={rows}>
        <Header s={s} width={cols} />
        <Box height={bodyH + stripH + bottomH} width={cols}>
          <Box flexDirection="column" width={mainW} height={bodyH + stripH + bottomH}>
            <Box height={bodyH} width={mainW} flexDirection="column">
              {nightOpen ? <NightPanel n={s.night} width={mainW} height={bodyH} unicode={tier !== 'none'} />
                : s.mode === 'models' ? <ModelPicker sel={s.modelSel} current={s.settings.model} width={mainW} />
                : s.mode === 'palette' ? <Palette query={s.palette.query} sel={s.palette.sel} width={mainW} />
                : s.mode === 'help' ? <HelpScreen actions={allActions()} keymap={keymap} warnings={keys?.warnings ?? []} onClose={() => ctl.patch({ mode: 'chat' })} width={mainW} height={bodyH} />
                  : s.mode === 'gallery' ? <Gallery cat={s.gallery.cat} idx={s.gallery.idx} color={s.gallery.color} width={mainW} height={gallerySize} reduced={s.settings.reducedMotion} />
                    : welcome ? <Welcome s={s} width={mainW} height={bodyH} color={s.settings.color} reduced={s.settings.reducedMotion} />
                      : <Box paddingX={1}><Transcript layout={layout} width={mainW - 2} height={bodyH} scroll={s.scroll} unseen={unseen} /></Box>}
            </Box>
            {stripH > 0 ? <Box paddingX={1} height={stripH}><LiveStrip s={s} driver={ctl.driver} width={mainW - 2} size={stripSize as 'large' | 'small' | 'off'} /></Box> : null}
            {pending ? <Approval a={pending} width={mainW} confirming={confirming} maxDiff={maxDiff} /> : (
              <>
                {showTasks ? <Box paddingX={1} height={tasksH}><TaskList items={s.tasks} maxRows={rows >= 34 ? 10 : 5} width={mainW - 2} unicode={tier !== 'none'} /></Box> : null}
                {popupH ? <SlashPopup matches={matches} sel={s.slashSel} width={mainW} /> : null}
                <Prompt text={s.input} cursor={s.cursor} busy={s.busy} width={mainW} active={s.mode === 'chat' || s.mode === 'night'} placeholder={nightOpen ? 'Add a task for tonight…' : placeholder} />
              </>
            )}
          </Box>
          {showFleet ? <Box marginLeft={1}><FleetPanel s={s} width={FLEET_W} height={bodyH + stripH + bottomH} /></Box> : null}
        </Box>
        <StatusLine s={s} width={cols} />
        <Box position="absolute" marginTop={1} width={cols}><Toasts toasts={s.toasts} width={cols - 1} /></Box>
      </Box>
    </ThemeCtx.Provider>
  );
}

