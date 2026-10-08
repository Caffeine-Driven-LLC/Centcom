import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, usePaste, useStdin, useStdout, useWindowSize } from 'ink';
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
import { CommandPalette } from './palette/index.js';
import { Gallery, ModelPicker, galleryList, paletteItems } from './components/Overlays.js';
import { Toasts } from './components/Toasts.js';
import { MultiSelect } from './pick/MultiSelect.js';
import { ClickContext, clicksIn, createClickRegistry } from './click.js';
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
  /** A new approval ignores answers for 300 ms: a key you were typing for something else must not approve a command you have not seen. */
  const shown = useRef<{ id?: string; at: number }>({ at: 0 }); if (pending?.req.approval_id !== shown.current.id) shown.current = { id: pending?.req.approval_id, at: Date.now() };
  const approvalGrace = () => !!pending && Date.now() - shown.current.at < 300;

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
  const maxInput = Math.max(3, Math.min(12, Math.floor(rows / 3))); // the box grows with the window, up to 12 lines
  const inputRows = promptRows(s.input, s.cursor, mainW, maxInput);
  const promptH = inputRows + 2;
  const maxDiff = Math.max(3, Math.min(10, rows - 20));
  const showTasks = s.tasksOpen && s.tasks.length > 0 && !pending && s.mode === 'chat';
  const tasksH = showTasks ? Math.min(s.tasks.length, rows >= 34 ? 10 : 5) + 1 + (s.tasks.length > (rows >= 34 ? 10 : 5) ? 1 : 0) : 0;
  const bottomH = pending ? approvalHeight(pending, mainW, maxDiff) : promptH + popupH + tasksH;
  const bodyH = Math.max(3, rows - 2 - stripH - bottomH);
  const layout = useTranscriptLayout(s.items, mainW - 2, s.settings.density === 'compact');
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
  const sel = ed.selRange(s.input, s.cursor, s.anchor);
  /** An edit that changes the text replaces the selection first; `extend` moves the cursor and keeps (or starts) a selection; any other move drops it. */
  const edit = (fn: (e: ed.Ed) => ed.Ed, how: 'text' | 'move' | 'extend' = 'text') => {
    let e: ed.Ed = { text: s.input, cursor: s.cursor };
    if (how === 'text' && sel) { e = ed.removeRange(e, sel[0], sel[1]); if (fn === ed.backspace || fn === ed.del || fn === ed.killWordLeft || fn === ed.killWordRight) { ctl.patch({ input: e.text, cursor: e.cursor, anchor: undefined, slashSel: 0, histIdx: null }); return; } }
    e = fn(e);
    ctl.patch({ input: e.text, cursor: e.cursor, anchor: how === 'extend' ? (s.anchor !== undefined && s.anchor !== s.cursor ? s.anchor : s.cursor) : undefined, slashSel: 0, histIdx: how === 'text' ? null : s.histIdx });
  };
  const complete = () => {
    const m = matches[s.slashSel % Math.max(1, matches.length)]; if (!m) return false;
    const t = '/' + m.name + (m.args ? ' ' : ''); ctl.patch({ input: t, cursor: t.length, slashSel: 0 }); return true;
  };

  usePaste((text) => {
    if (s.mode === 'palette') { ctl.patch({ palette: { query: s.palette.query + text.replace(/\s+/g, ' '), sel: 0 } }); return; }
    if (s.mode === 'chat' && !pending) { const r = ctl.pastes.add(text.replace(/\r\n?/g, '\n')); if (r.warning) ctl.toast('warn', r.warning, 6000); edit((e) => ed.insert(e, r.insert)); }
  });

  /** Mouse reporting (press, release and wheel, in the SGR form) only while it is on; always switched off again on the way out. */
  const clicks = useMemo(() => createClickRegistry(), []);
  const paletteProviders = useMemo(() => (s.mode === 'palette' ? ctl.paletteProviders() : []), [ctl, s.mode]); // rebuilt on each open so the sessions are current
  const { write } = useStdout(); const { stdin } = useStdin(); const wheelRef = useRef<(n: number) => void>(() => undefined);
  wheelRef.current = (notches) => { if (s.mode === 'pick') { for (let i = 0; i < Math.abs(notches); i++) ctl.pickKey(notches > 0 ? 'up' : 'down'); } else if (s.mode === 'chat' || s.mode === 'night' || pending) ctl.patch({ scroll: Math.max(0, Math.min(maxScroll, ctl.state.scroll + notches * 3)) }); }; // from the live value: events can arrive faster than renders
  // Ink drops mouse reports before `useInput` sees them, so the wheel is read from the raw bytes (Ink keeps reading them too).
  useEffect(() => {
    if (!s.settings.mouse) return;
    const onData = (d: Buffer | string) => { for (const c of clicksIn(String(d))) clicks.hit(c.col, c.row); let n = 0; for (const m of String(d).matchAll(/\x1b\[<(\d+);\d+;\d+M/g)) { const b = Number(m[1]); if (b & 64) n += b & 1 ? -1 : 1; } if (n) wheelRef.current(n); };
    stdin.on('data', onData); return () => { stdin.off('data', onData); };
  }, [s.settings.mouse, stdin, clicks]);
  useEffect(() => { if (!s.settings.mouse) return; write('\x1b[?1000h\x1b[?1006h'); return () => { write('\x1b[?1000l\x1b[?1006l'); }; }, [s.settings.mouse, write]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') { if (sel && !pending && (s.mode === 'chat' || s.mode === 'night')) { ctl.copy(ed.selectedText(s.input, s.cursor, s.anchor)); ctl.patch({ anchor: undefined }); return; } ctl.ctrlC(); return; }
    /* approvals */
    if (pending) {
      focusRef.current = ['permission']; const high = pending.req.risk === 'high'; const step = fromInk(input, key);
      if (approvalGrace()) return;
      if (confirming) { if (key.return) ctl.answerApproval('approve'); else if (step && dispatcher.handle(step).kind === 'action' && key.escape) ctl.answerApproval('deny'); return; }
      const d = step ? dispatcher.handle(step) : { kind: 'none' as const };
      if (d.kind === 'action') {
        if (d.action === 'approval.deny') { ctl.answerApproval('deny'); return; }
        if (d.action === 'approval.approve') { if (high) setConfirming(true); else ctl.answerApproval('approve'); return; }
        if (d.action === 'approval.always' && !high) { ctl.answerApproval('approve', 'always'); return; }
        if (d.action === 'approval.session' && !high) { ctl.answerApproval('approve', 'session'); return; }
        if (d.action === 'transcript.page_up') { setScroll(s.scroll + Math.floor(bodyH / 2)); return; } if (d.action === 'transcript.page_down') { setScroll(s.scroll - Math.floor(bodyH / 2)); return; }
      }
      return;
    }
    /* overlays */
    if (s.mode === 'pick') {
      if (key.escape) ctl.pickKey('cancel'); else if (key.return) ctl.pickKey('enter'); else if (key.upArrow || input === 'k') ctl.pickKey('up'); else if (key.downArrow || key.tab || input === 'j') ctl.pickKey('down'); else if (input === ' ') ctl.pickKey('toggle'); else if (input === 'a') ctl.pickKey('all');
      return;
    }
    if (s.mode === 'help') return; // the help screen reads its own keys (filter, esc)
    if (s.mode === 'palette') return; // the palette reads its own keys
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
        case 'models.open': void ctl.openModels(); return;
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
      const m = ed.moveVertical({ text: s.input, cursor: s.cursor }, -1); if (m) ctl.patch({ cursor: m.cursor, anchor: undefined }); else ctl.historyStep(-1); return;
    }
    if (key.downArrow) {
      if (matches.length) { ctl.patch({ slashSel: (s.slashSel + 1) % matches.length }); return; }
      const m = ed.moveVertical({ text: s.input, cursor: s.cursor }, 1); if (m) ctl.patch({ cursor: m.cursor, anchor: undefined }); else ctl.historyStep(1); return;
    }
    const how = key.shift ? 'extend' : 'move';
    if (key.leftArrow) { if (sel && how === 'move' && !key.ctrl && !key.meta) { ctl.patch({ cursor: sel[0], anchor: undefined }); return; } edit(key.ctrl || key.meta || key.shift ? ed.wordLeft : ed.left, how); return; }
    if (key.rightArrow) { if (sel && how === 'move' && !key.ctrl && !key.meta) { ctl.patch({ cursor: sel[1], anchor: undefined }); return; } edit(key.ctrl || key.meta || key.shift ? ed.wordRight : ed.right, how); return; }
    if (key.home || (key.ctrl && input === 'a')) { edit(ed.lineStart, how); return; }
    if (key.end || (key.ctrl && input === 'e')) { edit(ed.lineEnd, how); return; }
    if (key.meta && input === 'a') { ctl.patch({ anchor: 0, cursor: s.input.length }); return; } // select all
    if (key.ctrl && input === 'x') { if (sel) { ctl.copy(ed.selectedText(s.input, s.cursor, s.anchor)); edit(ed.backspace); } return; }
    if (key.backspace) { edit(key.meta || key.ctrl ? ed.killWordLeft : ed.backspace); return; }
    if (key.delete) { edit(key.meta || key.ctrl || key.shift ? ed.killWordRight : ed.del); return; }
    if (key.ctrl && input === 'w') { edit(ed.killWordLeft); return; }
    if (key.ctrl && input === 'u') { edit(ed.killToLineStart); return; }
    if (key.ctrl && input === 'j') { edit((e) => ed.insert(e, '\n')); return; }
    if (key.meta && input === 'b') { edit(ed.wordLeft, 'move'); return; }
    if (key.meta && input === 'f') { edit(ed.wordRight, 'move'); return; }
    if (input && !key.ctrl && !key.meta) {
      // Text and Enter in one chunk (fast typing, a paste without bracketed paste, scripts) arrives as one string: the trailing Enter sends, it is not a line break.
      if (input.length > 1 && /[\r\n]$/.test(input) && !key.return && !s.input.endsWith('\\') && !/[\r\n]./s.test(input.slice(0, -1))) {
        const body = input.replace(/[\r\n]+$/, ''); if (!body && !s.input) return;
        const e = ed.insert(sel ? ed.removeRange({ text: s.input, cursor: s.cursor }, sel[0], sel[1]) : { text: s.input, cursor: s.cursor }, body);
        ctl.patch({ input: e.text, cursor: e.cursor, anchor: undefined, slashSel: 0, histIdx: null });
        const m = slashMatches(e.text)[0]; // same as Enter with the command menu open: a partial command completes
        if (m && m.name !== e.text.slice(1)) { const t = '/' + m.name + (m.args ? ' ' : ''); ctl.patch({ input: t, cursor: t.length, anchor: undefined }); if (!m.args) void ctl.submit('/' + m.name); return; }
        void ctl.submit(e.text); return;
      }
      edit((e) => ed.insert(e, input.replace(/\r\n?/g, '\n')));
    }
  });

  if (cols < 60 || rows < 14) {
    return <Box width={cols} height={rows} alignItems="center" justifyContent="center"><Text>Centcom needs at least 60×14. Resize the window.</Text></Box>;
  }

  const placeholder = s.busy ? 'Cento is working… Esc to interrupt' : s.items.length ? 'Message Cento…' : 'What should we build?';
  const gallerySize = bodyH;
  return (
    <ThemeCtx.Provider value={theme}>
      <ClickContext.Provider value={clicks}>
      <Box flexDirection="column" width={cols} height={rows}>
        <Header s={s} width={cols} />
        <Box height={bodyH + stripH + bottomH} width={cols}>
          <Box flexDirection="column" width={mainW} height={bodyH + stripH + bottomH}>
            <Box height={bodyH} width={mainW} flexDirection="column">
              {nightOpen ? <NightPanel n={s.night} width={mainW} height={bodyH} unicode={tier !== 'none'} />
                : s.mode === 'pick' && s.pick ? <MultiSelect p={s.pick} width={mainW} height={bodyH} unicode={tier !== 'none'} onRow={(i) => ctl.pickClick(i)} onConfirm={() => ctl.pickKey('enter')} onCancel={() => ctl.pickKey('cancel')} />
                : s.mode === 'models' ? <ModelPicker sel={s.modelSel} current={s.settings.model} width={mainW} />
                : s.mode === 'palette' ? <CommandPalette providers={paletteProviders} cols={mainW} onClose={() => ctl.patch({ mode: 'chat' })} />
                : s.mode === 'help' ? <HelpScreen actions={allActions()} keymap={keymap} warnings={keys?.warnings ?? []} onClose={() => ctl.patch({ mode: 'chat' })} width={mainW} height={bodyH} />
                  : s.mode === 'gallery' ? <Gallery cat={s.gallery.cat} idx={s.gallery.idx} color={s.gallery.color} width={mainW} height={gallerySize} reduced={s.settings.reducedMotion} />
                    : welcome ? <Welcome s={s} width={mainW} height={bodyH} color={s.settings.color} reduced={s.settings.reducedMotion} />
                      : <Box paddingX={1}><Transcript layout={layout} items={s.items} width={mainW - 2} height={bodyH} scroll={s.scroll} unseen={unseen} /></Box>}
            </Box>
            {stripH > 0 ? <Box paddingX={1} height={stripH}><LiveStrip s={s} driver={ctl.driver} width={mainW - 2} size={stripSize as 'large' | 'small' | 'off'} /></Box> : null}
            {pending ? <Approval a={pending} width={mainW} confirming={confirming} maxDiff={maxDiff} onChoose={(c) => { if (approvalGrace()) return; if (c === 'no') ctl.answerApproval('deny'); else if (c === 'always') { if (pending.req.risk !== 'high') ctl.answerApproval('approve', 'always'); } else if (c === 'session') { if (pending.req.risk !== 'high') ctl.answerApproval('approve', 'session'); } else if (pending.req.risk === 'high' && !confirming) setConfirming(true); else ctl.answerApproval('approve'); }} /> : (
              <>
                {showTasks ? <Box paddingX={1} height={tasksH}><TaskList items={s.tasks} maxRows={rows >= 34 ? 10 : 5} width={mainW - 2} unicode={tier !== 'none'} /></Box> : null}
                {popupH ? <SlashPopup matches={matches} sel={s.slashSel} width={mainW} onPick={(c) => { const t = '/' + c.name + (c.args ? ' ' : ''); ctl.patch({ input: t, cursor: t.length, anchor: undefined, slashSel: 0 }); if (!c.args) void ctl.submit('/' + c.name); }} /> : null}
                <Prompt text={s.input} cursor={s.cursor} anchor={s.anchor} maxRows={maxInput} busy={s.busy} width={mainW} active={s.mode === 'chat' || s.mode === 'night'} placeholder={nightOpen ? 'Add a task for tonight…' : placeholder} />
              </>
            )}
          </Box>
          {showFleet ? <Box marginLeft={1}><FleetPanel s={s} width={FLEET_W} height={bodyH + stripH + bottomH} /></Box> : null}
        </Box>
        <StatusLine s={s} width={cols} />
        <Box position="absolute" marginTop={1} width={cols}><Toasts toasts={s.toasts} width={cols - 1} /></Box>
      </Box>
      </ClickContext.Provider>
    </ThemeCtx.Provider>
  );
}

