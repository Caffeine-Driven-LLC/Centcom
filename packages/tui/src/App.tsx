import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, usePaste, useStdin, useStdout, useWindowSize } from 'ink';
import { createTheme, type ColorTier } from '@centcom/theme';
import { createTheme as createStyledTheme, ThemeProvider } from './theme/index.js';
import { bakedCategories } from '@centcom/mascot';
import { CLAUDE_MODELS } from '@centcom/agent';
import type { AppController } from './controller.js';
import { ThemeCtx, UnicodeCtx, useStore } from './components/ui.js';
import { TaskList } from './tasks/TaskList.js';
import { actions as allActions, createDispatcher, defaultKeymap, fromInk, HelpScreen, type KeyContext, type Keymap, type KeymapWarning } from './keys/index.js';
import { StatusBar } from './components/StatusBars.js';
import { Shell, computeLayout, RAIL_MIN_COLS, RAIL_WIDTH } from './shell/index.js';
import { Welcome } from './components/Welcome.js';
import { LiveStrip, LARGE_H, SMALL_H } from './components/LiveStrip.js';
import { PermissionPrompt, permissionHeight, approvalFromPending } from './permission/index.js';
import { Prompt, SlashPopup, promptRows, slashMatches } from './components/Prompt.js';
import { FleetPanel, createSinceTracker, fleetFromAgents, SELF_MEMBER } from './fleet/index.js';
import { STATE_MAP } from './mascot/index.js';
import { Transcript, useTranscriptLayout } from './components/Transcript.js';
import { CommandPalette } from './palette/index.js';
import { Gallery, galleryList, paletteItems } from './components/Overlays.js';
import { Toasts } from './components/Toasts.js';
import { MultiSelect } from './pick/MultiSelect.js';
import { MentionPopup } from './components/MentionPopup.js';
import { setTitle, windowTitle } from './util/title.js';
import { ClickContext, clicksIn, createClickRegistry } from './click.js';
import { NightPanel } from './night/NightPanel.js';
import { COMMANDS } from './state/commands.js';
import * as ed from './util/editor.js';

export interface AppProps { ctl: AppController; tier: ColorTier; /** `caps.unicode`: false draws every glyph with its ASCII stand-in, whatever the colour depth. Unset: Unicode when there is colour. */ unicode?: boolean; /** The resolved keymap (defaults plus keybindings.json) and what was wrong with the file. */ keys?: { keymap: Keymap; warnings: KeymapWarning[] } }

export function App({ ctl, tier, keys, unicode: uniProp }: AppProps) {
  const uni = uniProp ?? tier !== 'none';
  const s = useStore(ctl.store);
  const win = useWindowSize();
  const cols = win.columns; const rows = Math.max(1, win.rows - 1); // Ink clears the whole screen every frame when output is as tall as the terminal; stay one row short
  const theme = useMemo(() => createTheme(s.settings.theme, tier), [s.settings.theme, tier]);
  const styled = useMemo(() => createStyledTheme({ caps: { tier, unicode: uni }, mode: s.settings.theme }), [s.settings.theme, tier, uni]); // the colour module (lane C032) decides every colour
  const sinceOf = useRef(createSinceTracker()).current;
  const keymap = useMemo(() => keys?.keymap ?? defaultKeymap(allActions()), [keys]); const focusRef = useRef<KeyContext[]>(['prompt']);
  const dispatcher = useMemo(() => createDispatcher({ keymap, focus: () => focusRef.current, clock: { now: () => Date.now() } }), [keymap]);
  const pending = s.approvals[0];
  /** The permission question as the prompt shows it. The prompt owns its keys: a new one ignores answers for 300 ms, a destructive one asks twice (y, then Enter), and one that is not answered in time declines itself. */
  const approvalView = useMemo(() => (pending ? approvalFromPending(pending, { engine: s.engineId === 'codex' ? 'codex' : 'claude-code', branch: s.branch || undefined }) : undefined), [pending?.req.approval_id, s.engineId, s.branch]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- layout ---- */
  const showFleet = s.fleet && s.agents.length > 1 && cols >= RAIL_MIN_COLS && s.mode === 'chat'; // a solo session has no fleet rail; it appears when others join
  const mainW = cols; // the prompt, the strip and the permission question use the whole width; the scrollback gives the rail its 28 columns
  const bodyW = showFleet ? cols - RAIL_WIDTH - 1 : cols;
  const mascot = s.settings.mascot === 'auto' ? (rows >= 34 ? 'large' : rows >= 22 ? 'small' : 'off') : s.settings.mascot;
  const welcome = s.items.length === 0 && !s.busy && s.mode === 'chat' && !pending;
  const nightOpen = s.mode === 'night';
  const tight = !!pending && rows < 30;
  const overlay = s.mode === 'help' || s.mode === 'palette' || s.mode === 'pick' || s.mode === 'gallery'; // a full-screen list or page: Cento steps aside so it has the rows
  const stripH = welcome || overlay ? 0 : tight ? 1 : mascot === 'large' ? LARGE_H : mascot === 'small' ? SMALL_H : 1;
  const stripSize = tight && mascot !== 'off' ? 'off' : mascot;
  const matches = (s.mode === 'chat' || s.mode === 'night') && !pending ? slashMatches(s.input) : [];
  const mentionNow = (s.mode === 'chat' || s.mode === 'night') && !pending && !matches.length ? ed.mentionAt(s.input, s.cursor) : undefined; const mentionFresh = !!mentionNow && !!s.mention && s.mention.q === mentionNow.query; const related = !!mentionNow && !!s.mention && (mentionNow.query.startsWith(s.mention.q) || s.mention.q.startsWith(mentionNow.query)); const mentions = mentionNow && s.mention && (mentionFresh || related) ? ed.visibleMentions(mentionNow.query, s.mention.items, mentionFresh) : []; // while the next search runs the last list stays (cut to what still matches), so the layout does not jump and every entry shown works
  const popupH = Math.min(6, matches.length) || Math.min(6, mentions.length);
  const maxInput = Math.max(3, Math.min(12, Math.floor(rows / 3))); // the box grows with the window, up to 12 lines
  const inputRows = promptRows(s.input, s.cursor, mainW, maxInput);
  const promptH = inputRows + 2;
  const maxDiff = Math.max(3, Math.min(10, rows - 20));
  const showTasks = s.tasksOpen && s.tasks.length > 0 && !pending && s.mode === 'chat';
  const tasksH = showTasks ? Math.min(s.tasks.length, rows >= 34 ? 10 : 5) + 1 + (s.tasks.length > (rows >= 34 ? 10 : 5) ? 1 : 0) : 0;
  const bottomH = approvalView ? permissionHeight(approvalView, { cols: mainW, canDecide: true, maxDiff }) : promptH + popupH + tasksH;
  const lay = computeLayout({ cols, rows, promptRows: stripH + bottomH, promptMax: rows, rail: showFleet }); // the same call the shell makes
  const bodyH = Math.max(3, lay.transcriptRows);
  const layout = useTranscriptLayout(s.items, bodyW - 2, s.settings.density === 'compact');
  const total = layout.total;

  // keep the view anchored while the user is scrolled up and new lines arrive; count the new messages; keep the top block in place on a resize
  const prevTotal = useRef(total); const prevW = useRef(bodyW); const prevCount = useRef(s.items.length); const anchor = useRef<{ id: string; offset: number } | undefined>(undefined); const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    if (prevW.current !== bodyW) { prevW.current = bodyW; prevTotal.current = total; const a = anchor.current; if (a && ctl.state.scroll > 0) { const row = layout.rowOf(a); if (row !== undefined) ctl.patch({ scroll: Math.max(0, total - row - bodyH) }); } return; }
    const d = total - prevTotal.current; prevTotal.current = total; if (d > 0 && ctl.state.scroll > 0) ctl.patch({ scroll: ctl.state.scroll + d });
  }, [total, bodyW, ctl, layout, bodyH]);
  useEffect(() => { const added = s.items.length - prevCount.current; prevCount.current = s.items.length; if (s.scroll > 0 && added > 0) setUnseen((u) => u + added); else if (s.scroll === 0) setUnseen(0); }, [s.items.length, s.scroll]);
  useEffect(() => { if (s.scroll > 0) anchor.current = layout.anchorAt(Math.max(0, total - s.scroll - bodyH)); else anchor.current = undefined; });
  const maxScroll = Math.max(0, total - bodyH);
  const setScroll = (n: number) => ctl.patch({ scroll: Math.max(0, Math.min(maxScroll, n)) });
  useEffect(() => { // /find: bring the chosen message into view, a third of the way down
    if (!s.jumpTo) return; const row = layout.rowOf({ id: s.jumpTo, offset: 0 }); const start = Math.max(0, (row ?? 0) - Math.floor(bodyH / 3));
    ctl.patch({ scroll: row === undefined ? s.scroll : Math.max(0, Math.min(maxScroll, total - start - bodyH)), jumpTo: undefined });
  }, [s.jumpTo]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- the mascot costs nothing when nobody sees it, and little when nothing is happening ---- */
  const strip = stripH > 0 && stripSize !== 'off';
  useEffect(() => { ctl.driver.setPaused(!strip); }, [ctl, strip]);
  const lastActive = useRef(Date.now()); const [calm, setCalm] = useState(1); const calmRef = useRef(1); // 1 = full speed; more = slower
  const wake = () => { lastActive.current = Date.now(); if (calmRef.current !== 1) { calmRef.current = 1; setCalm(1); } };
  useEffect(() => { ctl.driver.setSpeed(calm); }, [ctl, calm]);
  useEffect(() => { wake(); }, [s.busy, s.approvals.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // nothing happening: 3 times slower after 20 s, 8 times slower after 2 minutes (the screen is redrawn per frame, so frames are the cost)
    const h = setInterval(() => { if (ctl.state.busy) return; const idle = Date.now() - lastActive.current; const want = idle > 120_000 ? 8 : idle > 20_000 ? 3 : 1; if (want > calmRef.current) { calmRef.current = want; setCalm(want); } }, 5000); h.unref?.(); return () => clearInterval(h);
  }, [ctl]);

  /* ---- @file suggestions follow the word at the cursor ---- */
  const mentionQuery = mentionNow?.query;
  useEffect(() => { if (mentionQuery) ctl.searchMentions(mentionQuery); else ctl.clearMentions(); }, [ctl, mentionQuery]);

  /* ---- keys ---- */
  const sel = ed.selRange(s.input, s.cursor, s.anchor);
  /** An edit that changes the text replaces the selection first; `extend` moves the cursor and keeps (or starts) a selection; any other move drops it. */
  const edit = (fn: (e: ed.Ed) => ed.Ed, how: 'text' | 'move' | 'extend' = 'text') => {
    let e: ed.Ed = { text: s.input, cursor: s.cursor };
    if (how === 'text' && sel) { e = ed.removeRange(e, sel[0], sel[1]); if (fn === ed.backspace || fn === ed.del || fn === ed.killWordLeft || fn === ed.killWordRight) { ctl.setInputUndoable(e.text, e.cursor, { anchor: undefined, slashSel: 0, histIdx: null }); return; } }
    e = fn(e);
    ctl.setInputUndoable(e.text, e.cursor, { anchor: how === 'extend' ? (s.anchor !== undefined && s.anchor !== s.cursor ? s.anchor : s.cursor) : undefined, slashSel: 0, histIdx: how === 'text' ? null : s.histIdx });
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
  const { write: writeTerm } = useStdout();
  const title = windowTitle({ cwd: s.cwd, busy: s.busy, approvals: s.approvals.length, mode: s.mode, engineLabel: s.engineLabel, demo: s.demo });
  useEffect(() => { if (s.settings.title) writeTerm(setTitle(title)); }, [s.settings.title, title, writeTerm]); // the tab says what is going on
  const paletteProviders = useMemo(() => (s.mode === 'palette' ? ctl.paletteProviders() : []), [ctl, s.mode]); // rebuilt on each open so the sessions are current
  const { write } = useStdout(); const { stdin } = useStdin(); const wheelRef = useRef<(n: number) => void>(() => undefined);
  wheelRef.current = (notches) => { if (s.mode === 'pick') { for (let i = 0; i < Math.abs(notches); i++) ctl.pickKey(notches > 0 ? 'up' : 'down'); } else if (s.mode === 'chat' || s.mode === 'night' || pending) ctl.patch({ scroll: Math.max(0, Math.min(maxScroll, ctl.state.scroll + notches * 3)) }); }; // from the live value: events can arrive faster than renders
  // Ink drops mouse reports before `useInput` sees them, so the wheel is read from the raw bytes (Ink keeps reading them too).
  useEffect(() => {
    if (!s.settings.mouse) return;
    const onData = (d: Buffer | string) => { wake(); for (const c of clicksIn(String(d))) clicks.hit(c.col, c.row); let n = 0; for (const m of String(d).matchAll(/\x1b\[<(\d+);\d+;\d+M/g)) { const b = Number(m[1]); if (b & 64) n += b & 1 ? -1 : 1; } if (n) wheelRef.current(n); };
    stdin.on('data', onData); return () => { stdin.off('data', onData); };
  }, [s.settings.mouse, stdin, clicks]);
  useEffect(() => { if (!s.settings.mouse) return; write('\x1b[?1000h\x1b[?1006h'); return () => { write('\x1b[?1000l\x1b[?1006l'); }; }, [s.settings.mouse, write]);

  useInput((input, key) => {
    wake(); // any key brings the animation back to full speed
    if (key.ctrl && input === 'c') { if (sel && !pending && (s.mode === 'chat' || s.mode === 'night')) { ctl.copy(ed.selectedText(s.input, s.cursor, s.anchor)); ctl.patch({ anchor: undefined }); return; } ctl.ctrlC(); return; }
    /* approvals */
    if (pending) { // the prompt reads the answer keys itself; the transcript still scrolls
      focusRef.current = ['permission']; const step = fromInk(input, key); const d = step ? dispatcher.handle(step) : { kind: 'none' as const };
      if (d.kind === 'action') { if (d.action === 'transcript.page_up') setScroll(s.scroll + Math.floor(bodyH / 2)); else if (d.action === 'transcript.page_down') setScroll(s.scroll - Math.floor(bodyH / 2)); }
      return;
    }
    /* overlays */
    if (s.mode === 'pick') {
      if (!key.ctrl && !key.meta && ctl.pickHotkey(input)) return;
      if (key.escape) ctl.pickKey('cancel'); else if (key.return) ctl.pickKey('enter'); else if (key.upArrow || input === 'k') ctl.pickKey('up'); else if (key.downArrow || key.tab || input === 'j') ctl.pickKey('down'); else if (input === ' ') ctl.pickKey('toggle'); else if (input === 'a') ctl.pickKey('all');
      return;
    }
    if (s.mode === 'help') return; // the help screen reads its own keys (filter, esc)
    if (s.mode === 'palette') return; // the palette reads its own keys
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
      if (key.return && !s.input.endsWith('\\') && !(mentions.length && mentionNow)) { if (s.input.trim()) void ctl.submit(s.input); else ctl.nightStart(); return; } // (a file being suggested is completed first, as in the chat)
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
        case 'agent.interrupt': if (s.busy) void ctl.interrupt(); else if (ctl.dismissToast()) { /* the notice goes first */ } else if (s.input) ctl.setInputUndoable('', 0); else ctl.escIdle(); return;
        case 'toast.dismiss': ctl.dismissToast(); return;
        case 'tasks.toggle': ctl.patch({ tasksOpen: !s.tasksOpen }); return;
        case 'night.toggle': ctl.openNight(); return;
        case 'history.search': void ctl.historyPick(); return;
        case 'prompt.undo': ctl.undoInput(); return;
        case 'prompt.redo': ctl.redoInput(); return;
        case 'app.suspend': ctl.suspend(); return;
        case 'prompt.edit': ctl.editPrompt(); return;
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
    if (mentions.length && mentionNow) { // a file is being suggested: arrows choose, Tab or Enter completes
      const pickAt = (path: string) => { const e = ed.completeMention({ text: s.input, cursor: s.cursor }, mentionNow, path); ctl.setInputUndoable(e.text, e.cursor, { slashSel: 0 }); ctl.clearMentions(); };
      if (key.tab || (key.return && !s.input.endsWith('\\'))) { pickAt(mentions[s.mention!.sel % mentions.length]!); return; }
      if (key.upArrow) { ctl.patch({ mention: { ...s.mention!, sel: (s.mention!.sel + mentions.length - 1) % mentions.length } }); return; }
      if (key.downArrow) { ctl.patch({ mention: { ...s.mention!, sel: (s.mention!.sel + 1) % mentions.length } }); return; }
    }
    if (!s.input && !key.ctrl && !key.meta && input.length === 1 && ctl.toastKey(input)) return; // a notice with a key, such as [u] update
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
      const m = ed.moveVertical({ text: s.input, cursor: s.cursor }, -1); if (m) ctl.patch({ cursor: m.cursor, anchor: undefined }); else if (!s.maskInput) ctl.historyStep(-1); return;
    }
    if (key.downArrow) {
      if (matches.length) { ctl.patch({ slashSel: (s.slashSel + 1) % matches.length }); return; }
      const m = ed.moveVertical({ text: s.input, cursor: s.cursor }, 1); if (m) ctl.patch({ cursor: m.cursor, anchor: undefined }); else if (!s.maskInput) ctl.historyStep(1); return;
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
  const fleetRows = showFleet ? fleetFromAgents(s.agents, { since: sinceOf }) : [];
  const body = (
    <>
      {nightOpen ? <NightPanel n={s.night} width={bodyW} height={bodyH} unicode={uni} />
        : s.mode === 'pick' && s.pick ? <MultiSelect p={s.pick} width={bodyW} height={bodyH} unicode={uni} onRow={(i) => ctl.pickClick(i)} onConfirm={() => ctl.pickKey('enter')} onCancel={() => ctl.pickKey('cancel')} />
        : s.mode === 'palette' ? <CommandPalette providers={paletteProviders} cols={bodyW} onClose={() => ctl.patch({ mode: 'chat' })} />
        : s.mode === 'help' ? <HelpScreen actions={allActions()} keymap={keymap} warnings={keys?.warnings ?? []} onClose={() => ctl.patch({ mode: 'chat' })} width={bodyW} height={bodyH} />
          : s.mode === 'gallery' ? <Gallery cat={s.gallery.cat} idx={s.gallery.idx} color={s.gallery.color} width={bodyW} height={gallerySize} reduced={s.settings.reducedMotion} />
            : welcome ? <Welcome s={s} width={bodyW} height={bodyH} color={s.settings.color} reduced={s.settings.reducedMotion} calm={calm} mascot={s.settings.mascot !== 'off'} />
              : <Box paddingX={1}><Transcript layout={layout} items={s.items} width={bodyW - 2} height={bodyH} scroll={s.scroll} unseen={unseen} /></Box>}
      <Box position="absolute" width={bodyW}><Toasts toasts={s.toasts} showing={ctl.toasts.current()?.id} width={bodyW - 1} unicode={uni} /></Box>
    </>
  );
  const bottom = (
    <>
      {stripH > 0 ? <Box paddingX={1} height={stripH}><LiveStrip s={s} mascot={ctl.mascot} width={mainW - 2} size={stripSize as 'large' | 'small' | 'off'} calm={calm} /></Box> : null}
      {approvalView ? <PermissionPrompt request={approvalView} canDecide cols={mainW} maxDiff={maxDiff} onDecide={(d) => { if (ctl.state.approvals[0]?.req.approval_id === d.approvalId) ctl.answerApproval(d.decision, d.scope); }} /> : (
        <>
          {showTasks ? <Box paddingX={1} height={tasksH}><TaskList items={s.tasks} maxRows={rows >= 34 ? 10 : 5} width={mainW - 2} unicode={uni} /></Box> : null}
          {mentions.length && !matches.length ? <MentionPopup items={mentions.slice(0, 6)} sel={s.mention!.sel} width={mainW} onPick={(p) => { const e = ed.completeMention({ text: s.input, cursor: s.cursor }, mentionNow!, p); ctl.setInputUndoable(e.text, e.cursor); ctl.clearMentions(); }} /> : null}
          {popupH && matches.length ? <SlashPopup matches={matches} sel={s.slashSel} width={mainW} onPick={(c) => { const t = '/' + c.name + (c.args ? ' ' : ''); ctl.patch({ input: t, cursor: t.length, anchor: undefined, slashSel: 0 }); if (!c.args) void ctl.submit('/' + c.name); }} /> : null}
          <Prompt text={s.maskInput ? s.input.replace(/[^\n]/g, '•') : s.input} cursor={s.cursor} anchor={s.anchor} maxRows={maxInput} busy={s.busy} width={mainW} active={s.mode === 'chat' || s.mode === 'night'} placeholder={nightOpen ? 'Add a task for tonight…' : placeholder} />
        </>
      )}
    </>
  );
  return (
    <ThemeCtx.Provider value={theme}><UnicodeCtx.Provider value={uni}>
      <ThemeProvider theme={styled}>
        <ClickContext.Provider value={clicks}>
          <Shell cols={cols} rows={rows} promptRows={stripH + bottomH} promptMax={rows} slots={{
            header: <StatusBar s={s} width={cols} line="header" />,
            transcript: body,
            prompt: bottom,
            footer: <StatusBar s={s} width={cols} line="footer" />,
            rail: showFleet ? <FleetPanel agents={fleetRows} selfMemberId={SELF_MEMBER} selfSlot={0} mode="rail" selectedId={s.activeAgent} onSelect={() => undefined} interactive={false} width={RAIL_WIDTH}
              mascots={{ tier, unicode: uni, motion: s.settings.reducedMotion ? 'reduced' : 'full', stateMap: STATE_MAP }} /> : undefined,
          }} />
        </ClickContext.Provider>
      </ThemeProvider>
    </UnicodeCtx.Provider></ThemeCtx.Provider>
  );
}
