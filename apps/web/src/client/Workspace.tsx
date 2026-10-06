import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { CLAUDE_MODELS, modelLabel } from '@centcom/models';
import { COMMANDS } from '@centcom/commands';
import type { Item } from '@centcom/tui';
import { Cento, Mini } from './Cento.js';
import { Icon, toolIcon } from './Icon.js';
import { Diff, Markdown } from './Markdown.js';
import { Popover } from './Popover.js';
import { Gallery, Help, Palette, type PaletteItem } from './Overlays.js';
import { fromServer, getThemePref, setThemePref, toServer, type ThemePref } from './theme.js';
import type { Conn } from './net.js';

type Mode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
const MODES: { id: Mode; title: string; desc: string; icon: string }[] = [
  { id: 'default', title: 'Ask first', desc: 'Approve every edit and command', icon: 'shield' },
  { id: 'acceptEdits', title: 'Accept edits', desc: 'Edits go through; commands still ask', icon: 'edit' },
  { id: 'plan', title: 'Plan', desc: 'Read-only. Nothing is changed', icon: 'eye' },
];
const money = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const reset = (at: number, now = Date.now()) => { const t = Math.floor(at - now / 1000); if (!at) return ''; if (t <= 0) return 'now'; const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60); return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`; };
const winName = (n: string) => (n === 'five_hour' ? 'Session' : n === 'seven_day' ? 'Week' : n.replace(/_/g, ' '));
const level = (pct: number) => (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok');
const agoText = (ms: number) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const spent = (ms: number) => { const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

const ToolCard = memo(function ToolCard({ it }: { it: Extract<Item, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const arg = it.path ?? it.command ?? it.summary;
  const running = it.status === 'running'; const waiting = it.approval === 'pending';
  const body = it.result?.split('\n').slice(0, 8).join('\n');
  const hasBody = !!(body || (it.diff && (it.status === 'ok' || it.approval === 'approved')));
  return (
    <div className={`tool s-${waiting ? 'wait' : it.status}`}>
      <button className="thead" onClick={() => hasBody && setOpen((o) => !o)} aria-expanded={open} disabled={!hasBody}>
        <span className="ticon"><Icon name={toolIcon(it.name)} size={14} /></span>
        <b>{it.name}</b><code title={arg}>{arg}</code>
        {it.risk === 'high' && <span className="tag danger">High risk</span>}
        <span className="grow" />
        {waiting ? <span className="tag warn">Needs approval</span> : running ? <span className="spin" aria-label="Running" /> : it.status === 'ok' ? <span className="ok"><Icon name="check" size={14} /></span> : it.status === 'denied' ? <span className="tag muted">Declined</span> : <span className="bad"><Icon name="x" size={14} /></span>}
        {hasBody && <Icon name="chevron" size={14} className={`chev ${open ? 'open' : ''}`} />}
      </button>
      {it.status === 'denied' && it.result && <div className="tres warn">{it.result}</div>}
      {!open && body && it.status !== 'denied' && <div className={`tres ${it.status === 'error' ? 'err' : ''}`}>{body.split('\n')[0]}</div>}
      {open && body && <pre className={`tout ${it.status === 'error' ? 'err' : ''}`}>{body}</pre>}
      {(open || (it.diff && it.status === 'ok')) && it.diff && (it.status === 'ok' || it.approval === 'approved') && <Diff text={it.diff} />}
    </div>
  );
});

const Row = memo(function Row({ it, first }: { it: Item; first: boolean }) {
  switch (it.kind) {
    case 'user': return <div className="msg user"><div className="bubble">{it.text}</div></div>;
    case 'assistant': return <div className="msg assistant"><div className="gutter">{first && <Mini state="idle" color="violet" busy={false} px={2} />}</div><div className="content"><Markdown text={it.text} />{!it.done && <span className="caret" />}</div></div>;
    case 'thinking': return <div className="thinking"><span className={it.done ? '' : 'pulse'}>∴</span> {it.done ? `Thought for ${spent(Math.max(1000, it.ms))}` : `Thinking… ${it.text.slice(-70)}`}</div>;
    case 'tool': return <ToolCard it={it} />;
    case 'notice': return <div className={`notice ${it.level}`}><Icon name={it.level === 'error' || it.level === 'warn' ? 'warn' : it.level === 'ok' ? 'check' : 'spark'} size={15} /><div><b>{it.text}</b>{it.detail && <pre>{it.detail}</pre>}</div></div>;
  }
});

function Gauge({ label, pct, detail, title }: { label: string; pct: number; detail: string; title: string }) {
  return <span className={`seg-item gauge ${level(pct)}`} title={title}><span className="lbl">{label}</span><i><b style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></i><span className="val">{Math.round(pct)}%</span>{detail && <span className="dim">{detail}</span>}</span>;
}

function StatusBar({ s, me }: { s: NonNullable<Conn['state']>; me: NonNullable<Conn['state']>['agents'][number] }) {
  const mode = s.settings.permissionMode as Mode; const model = me.model ? modelLabel(me.model) : 'Default model';
  const login = me.loginKind === 'subscription' ? 'Subscription' : me.loginKind === 'api_key' ? 'API key' : me.loginKind === 'cloud' ? 'Cloud' : '';
  return (
    <footer className="statusbar" aria-label="Session status">
      <span className={`seg-item state ${s.busy ? 'live' : ''}`}><i className="dot" />{s.busy ? `${me.state.replace(/-/g, ' ')}${s.turnStartedAt ? ' · ' + spent(Date.now() - s.turnStartedAt) : ''}` : 'Idle'}</span>
      {me.ctxPct !== undefined ? <Gauge label="Context" pct={me.ctxPct} detail={me.ctxTokens && me.ctxWindow ? `${tok(me.ctxTokens)} / ${tok(me.ctxWindow)}` : ''} title={`Context window: ${me.ctxPct}% used${me.ctxTokens && me.ctxWindow ? ` (${me.ctxTokens.toLocaleString()} of ${me.ctxWindow.toLocaleString()} tokens)` : ''}`} /> : <span className="seg-item" title="Shown after the first reply"><span className="lbl">Context</span><span className="dim">—</span></span>}
      {s.limits.map((l) => <Gauge key={l.name} label={winName(l.name)} pct={l.utilization * 100} detail={l.resets_at ? `resets in ${reset(l.resets_at)}` : ''} title={`${winName(l.name)} limit: ${Math.round(l.utilization * 100)}% used${l.resets_at ? `, resets ${new Date(l.resets_at * 1000).toLocaleString()}` : ''}`} />)}
      {me.inTok + me.outTok > 0 && <span className="seg-item" title="Tokens for the last reply (input / output)"><span className="lbl">Tokens</span><span className="val">↑{tok(me.inTok)} ↓{tok(me.outTok)}</span></span>}
      {me.cost > 0 && <span className="seg-item" title="Estimated from your CLI's own report"><span className="lbl">Cost</span><span className="val">{money(me.cost)}</span><span className="dim">est.</span></span>}
      <span className="grow" />
      {s.branch && <span className="seg-item opt"><Icon name="git" size={12} /><span className="val">{s.branch}</span></span>}
      <span className="seg-item opt"><span className="val">{model}</span></span>
      {login && <span className="seg-item opt"><span className="dim">{login}</span></span>}
      <span className={`seg-item ${mode === 'bypassPermissions' ? 'bad' : ''}`}><span className="val">{mode === 'bypassPermissions' ? '⚠ Approvals off' : MODES.find((m) => m.id === mode)?.title}</span></span>
    </footer>
  );
}

export function Workspace({ c }: { c: Conn }) {
  const { state: s, items, send } = c;
  const [text, setText] = useState(''); const [sel, setSel] = useState(0);
  const [menu, setMenu] = useState<'model' | 'mode' | null>(null); const [confirmBypass, setConfirmBypass] = useState(false);
  const [stuck, setStuck] = useState(true); const [, tick] = useState(0);
  const [bannerOff, setBannerOff] = useState(false); const [apMin, setApMin] = useState(false);
  const [ov, setOv] = useState<null | { k: 'palette'; q?: string } | { k: 'help' } | { k: 'gallery'; name?: string }>(null);
  const [side, setSide] = useState(() => c.launcher?.prefs.side ?? (() => { try { return localStorage.getItem('centcom.side') !== '0'; } catch { return true; } })());
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const toggleSide = () => setSide((v) => { const n = !v; try { localStorage.setItem('centcom.side', n ? '1' : '0'); } catch { /* private mode */ } send({ t: 'pref', side: n }); return n; });
  const cycleTheme = () => { const n: ThemePref = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system'; setTheme(n); setThemePref(n); send({ t: 'pref', theme: toServer(n) }); };
  const feed = useRef<HTMLDivElement>(null); const box = useRef<HTMLTextAreaElement>(null);
  const history = useRef<string[]>([]); const hIdx = useRef(-1);
  const seeded = useRef(false);
  useEffect(() => { if (!seeded.current && c.state) { history.current = [...c.state.history]; seeded.current = true; } }, [c.state]);

  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  useEffect(() => { const el = feed.current; if (el && stuck) el.scrollTop = el.scrollHeight; }, [items, s?.approvals.length, stuck]);
  useEffect(() => { const t = box.current; if (t) { t.style.height = '0'; t.style.height = Math.min(220, t.scrollHeight) + 'px'; } }, [text]);
  useEffect(() => { box.current?.focus(); }, [s?.approvals.length]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey; const typing = /^(input|textarea|select)$/i.test((e.target as HTMLElement)?.tagName ?? '');
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setOv((o) => (o?.k === 'palette' ? null : { k: 'palette' })); }
      else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); setMenu((m) => (m === 'model' ? null : 'model')); }
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSide(); }
      else if (e.key === '?' && !typing) { e.preventDefault(); setOv({ k: 'help' }); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const bypassNow = s?.settings.permissionMode === 'bypassPermissions'; const pendId = s?.approvals[0]?.id;
  useEffect(() => { if (bypassNow) setBannerOff(false); }, [bypassNow]);
  useEffect(() => { setApMin(false); }, [pendId]);
  const slash = useMemo(() => (text.startsWith('/') && !text.includes(' ') && !text.includes('\n') ? COMMANDS.filter((x) => x.name.startsWith(text.slice(1).toLowerCase())).slice(0, 7) : []), [text]);
  if (!s) return <div className="center"><div className="boot"><Cento state="thinking" color="violet" px={5} reduced={false} /><span>Starting the agent…</span></div></div>;

  const me = s.agents.find((a) => a.mine)!; const pending = s.approvals[0]; const mode = s.settings.permissionMode as Mode;
  const bypass = mode === 'bypassPermissions'; const welcome = items.length === 0 && !s.busy;
  /** Commands that only make sense in a browser are handled here; everything else goes to the agent controller. */
  const local = (t: string): boolean => {
    const [cmd, ...r] = t.slice(1).split(/\s+/); const arg = r.join(' ').trim();
    switch (cmd) {
      case 'help': setOv({ k: 'help' }); return true;
      case 'model': if (!arg) { setMenu('model'); return true; } return false;
      case 'cento': setOv({ k: 'gallery', name: arg || undefined }); return true;
      case 'agents': toggleSide(); return true;
      case 'resume': if (!arg) { setOv({ k: 'palette', q: 'resume' }); return true; } return false;
      case 'theme': { const n = (arg === 'dark' || arg === 'light' || arg === 'system' ? arg : null) as ThemePref | null; if (n) { setTheme(n); setThemePref(n); send({ t: 'pref', theme: toServer(n) }); } else cycleTheme(); return true; }
      case 'quit': send({ t: 'close' }); return true;
      default: return false;
    }
  };
  const submit = () => { const t = text.trim(); if (!t) return; if (t.startsWith('/') && local(t)) { history.current.push(t); hIdx.current = -1; setText(''); return; } history.current.push(t); hIdx.current = -1; send({ t: 'submit', text: t }); setText(''); setStuck(true); };
  const setMode = (m: Mode) => { send({ t: 'setMode', mode: m }); setMenu(null); setConfirmBypass(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (slash.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && text !== '/' + slash[sel % slash.length]!.name))) { e.preventDefault(); const m = slash[sel % slash.length]!; setText('/' + m.name + (m.args ? ' ' : '')); setSel(0); return; }
    if (slash.length && e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => x + 1); return; }
    if (slash.length && e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => x + slash.length - 1); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); return; }
    if (e.key === 'Escape') { if (s.busy) send({ t: 'interrupt' }); else setText(''); return; }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); send({ t: 'cycleMode' }); return; }
    if (e.key === 'ArrowUp' && !text.includes('\n') && history.current.length) { e.preventDefault(); hIdx.current = hIdx.current < 0 ? history.current.length - 1 : Math.max(0, hIdx.current - 1); setText(history.current[hIdx.current]!); }
    if (e.key === 'ArrowDown' && hIdx.current >= 0) { e.preventDefault(); hIdx.current++; if (hIdx.current >= history.current.length) { hIdx.current = -1; setText(''); } else setText(history.current[hIdx.current]!); }
  };

  const cmds: PaletteItem[] = [
    { id: 'a:side', group: 'View', icon: 'panel', label: side ? 'Hide Cento' : 'Show Cento', hint: 'Ctrl/Cmd+B', run: toggleSide },
    { id: 'a:theme', group: 'View', icon: theme === 'light' ? 'sun' : 'moon', label: `Theme: ${theme === 'system' ? 'follows your system' : theme}`, hint: 'switch dark, light, system', run: cycleTheme },
    { id: 'a:help', group: 'View', icon: 'help', label: 'Show keyboard shortcuts', hint: '?', run: () => setOv({ k: 'help' }) },
    { id: 'a:cento', group: 'View', icon: 'spark', label: 'Browse the Cento animations', hint: '/cento', run: () => setOv({ k: 'gallery' }) },
    { id: 'a:auto', group: 'Agent', icon: 'spark', label: `Auto skills: turn ${s.settings.autoSkills ? 'off' : 'on'}`, run: () => send({ t: 'auto', on: !s.settings.autoSkills }) },
    ...(s.busy ? [{ id: 'a:stop', group: 'Agent', icon: 'stop', label: 'Interrupt the agent', hint: 'Esc', run: () => send({ t: 'interrupt' }) }] : []),
    { id: 's:new', group: 'Conversation', icon: 'spark', label: 'New conversation', hint: 'the current one stays saved', run: () => send({ t: 'submit', text: '/new' }) },
    ...s.sessions.filter((m) => m.id !== s.sessionId).map((m) => ({ id: 's:' + m.id, group: 'Conversation', icon: 'file', label: `Resume: ${m.title}`, hint: `${m.messages} msg · ${agoText(m.updatedAt)}`, run: () => send({ t: 'submit', text: '/resume ' + m.id }) })),
    { id: 'a:back', group: 'Project', icon: 'back', label: 'Back to projects', run: () => send({ t: 'close' }) },
    ...MODES.map((m) => ({ id: 'm:' + m.id, group: 'Mode', icon: m.icon, label: `Mode: ${m.title}`, hint: m.desc, run: () => setMode(m.id) })),
    { id: 'm:bypass', group: 'Mode', icon: 'shieldOff', label: 'Mode: Dangerously skip permissions', hint: 'asks you to confirm', run: () => { setMenu('mode'); setConfirmBypass(true); } },
    ...CLAUDE_MODELS.map((m) => ({ id: 'md:' + m.id, group: 'Model', icon: 'cpu', label: `Model: ${m.label}`, hint: m.note, run: () => send({ t: 'setModel', id: m.id }) })),
    ...COMMANDS.filter((x) => !['help', 'model', 'cento', 'agents', 'theme', 'mode', 'quit', 'interrupt', 'auto'].includes(x.name)).map((x) => ({ id: 'c:' + x.name, group: 'Command', icon: 'terminal', label: '/' + x.name + (x.args ? ' ' + x.args : ''), hint: x.desc, run: () => { if (x.args) { setText('/' + x.name + ' '); box.current?.focus(); } else send({ t: 'submit', text: '/' + x.name }); } })),
  ];

  let lastKind = '';
  return (
    <div className={`workspace ${bypass ? 'is-bypass' : ''}`}>
      <header className="bar">
        <button className="iconbtn" title="Back to projects" aria-label="Back to projects" onClick={() => send({ t: 'close' })}><Icon name="back" /></button>
        <div className="crumb"><b>{c.opened?.split('/').pop()}</b>{s.branch && <span className="pill"><Icon name="git" size={12} />{s.branch}</span>}{s.demo ? <span className="pill warn">Demo</span> : <span className="pill dim">{s.engineLabel}</span>}</div>
        <div className="grow" />
        <button className="kbtn" onClick={() => setOv({ k: 'palette' })} aria-label="Open the command palette" title="Command palette (Ctrl/Cmd+K)"><Icon name="search" size={14} /><span>Search commands</span><kbd>Ctrl K</kbd></button>
        <button className="iconbtn" onClick={cycleTheme} aria-label={`Theme: ${theme}`} title={`Theme: ${theme === 'system' ? 'follows your system' : theme} (click to change)`}><Icon name={theme === 'light' ? 'sun' : 'moon'} size={15} /></button>
        <button className={`iconbtn ${side ? 'on' : ''}`} onClick={toggleSide} aria-label="Toggle the side panel" aria-pressed={side} title="Side panel (Ctrl/Cmd+B)"><Icon name="panel" size={15} /></button>
      </header>
      {bypass && !bannerOff && <div className="banner" role="alert"><Icon name="shieldOff" size={15} /><b>Approvals are off.</b> Cento runs commands and edits files without asking.<button onClick={() => setMode('default')}>Turn approvals back on</button><button className="x" aria-label="Dismiss this notice" title="Dismiss (the red chip stays)" onClick={() => setBannerOff(true)}><Icon name="x" size={14} /></button></div>}

      <div className={`body ${side ? '' : 'no-side'}`}>
        <section className="main">
          <div className="feed" ref={feed} onScroll={(e) => { const el = e.currentTarget; setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 40); }}>
            {welcome ? (
              <div className="welcome">{!side && <Cento state="first-run" color={s.settings.color} px={8} reduced={s.settings.reducedMotion} />}
                <h2>What should we build?</h2><p className="muted path">{c.opened}</p>
                <div className="suggest">{(s.demo ? ['/demo fix', '/demo search', '/demo delete'] : ['Explain this codebase', 'Find and fix a failing test', 'Review my uncommitted changes']).map((t) => <button key={t} onClick={() => send({ t: 'submit', text: t })}>{t}</button>)}</div>
              </div>
            ) : <div className="items">{items.map((it) => { const first = it.kind === 'assistant' && lastKind !== 'assistant'; lastKind = it.kind; return <Row key={it.id} it={it} first={first} />; })}</div>}
          </div>
          {!stuck && <button className="jump" onClick={() => setStuck(true)}><Icon name="chevron" size={14} />Latest</button>}

          {pending && apMin && <button className={`apbar r-${pending.risk}`} onClick={() => setApMin(false)} aria-label="Show the approval"><Icon name={pending.risk === 'high' ? 'warn' : 'shield'} size={15} /><b>{pending.tool}</b><code>{pending.path ?? pending.command ?? pending.summary}</code><span className="grow" /><span>Needs approval · Review</span></button>}
          {pending && !apMin ? (
            <div className={`approval r-${pending.risk}`} role="alertdialog" aria-labelledby="ap-t">
              <div className="ap-head"><Icon name={pending.risk === 'high' ? 'warn' : 'shield'} size={18} /><h3 id="ap-t">{pending.tool === 'Bash' ? 'Run this command?' : /Edit|Write/.test(pending.tool) ? 'Change this file?' : `Allow ${pending.tool}?`}</h3><span className={`tag ${pending.risk === 'high' ? 'danger' : pending.risk === 'low' ? 'muted' : 'warn'}`}>{pending.risk === 'high' ? 'High risk' : pending.risk === 'low' ? 'Low risk' : 'Medium risk'}</span><button className="iconbtn sm" aria-label="Minimise this approval" title="Minimise (it stays pending)" onClick={() => setApMin(true)}><Icon name="chevron" size={14} /></button></div>
              <div className="ap-what"><code>{pending.path ?? pending.command ?? pending.summary}</code></div>
              {pending.diff && <Diff text={pending.diff} />}
              <div className="ap-foot"><span className="muted">Runs on {pending.agentName === 'you' ? 'your' : pending.agentName + "'s"} account</span><span className="grow" />
                <button className="btn ghost" onClick={() => send({ t: 'approve', decision: 'deny' })}>Decline</button>
                {pending.risk !== 'high' && <button className="btn" onClick={() => send({ t: 'approve', decision: 'approve', scope: 'session' })}>Always this session</button>}
                <button className="btn primary" onClick={() => send({ t: 'approve', decision: 'approve' })}>Allow</button></div>
            </div>
          ) : (
            <div className="composer-wrap">
              {slash.length > 0 && <div className="slash" role="listbox">{slash.map((m, i) => <button key={m.name} role="option" aria-selected={i === sel % slash.length} className={i === sel % slash.length ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); setText('/' + m.name + (m.args ? ' ' : '')); }}><b>/{m.name}</b><span>{m.desc}</span></button>)}</div>}
              <div className="composer">
                <textarea ref={box} value={text} rows={1} placeholder={s.busy ? 'Cento is working. Press Esc to interrupt' : 'Message Cento, or type / for commands'} onChange={(e) => { setText(e.target.value); setSel(0); }} onKeyDown={onKey} aria-label="Message" />
                <div className="ctools">
                  <div className="menu">
                    <button className="chip" data-popover-trigger onClick={() => setMenu(menu === 'model' ? null : 'model')} aria-haspopup="menu" aria-expanded={menu === 'model'}><Icon name="cpu" size={13} />{me.model ? modelLabel(me.model) : 'Default model'}<Icon name="chevron" size={12} /></button>
                    <Popover open={menu === 'model'} onClose={() => setMenu(null)} up>
                      {CLAUDE_MODELS.map((m) => <button key={m.id || 'default'} role="menuitemradio" aria-checked={m.id === s.settings.model} className="mi" onClick={() => { send({ t: 'setModel', id: m.id }); setMenu(null); }}><span className="mi-t">{m.label}{m.id === s.settings.model && <Icon name="check" size={13} />}</span><small>{m.note}</small></button>)}
                    </Popover>
                  </div>
                  <div className="menu">
                    <button className={`chip ${bypass ? 'danger' : ''}`} data-popover-trigger onClick={() => { setMenu(menu === 'mode' ? null : 'mode'); setConfirmBypass(false); }} aria-haspopup="menu" aria-expanded={menu === 'mode'} title="Shift+Tab"><Icon name={bypass ? 'shieldOff' : MODES.find((m) => m.id === mode)?.icon ?? 'shield'} size={13} />{bypass ? 'Approvals off' : MODES.find((m) => m.id === mode)?.title}<Icon name="chevron" size={12} /></button>
                    <Popover open={menu === 'mode'} onClose={() => { setMenu(null); setConfirmBypass(false); }} up>
                      {MODES.map((m) => <button key={m.id} role="menuitemradio" aria-checked={m.id === mode} className="mi" onClick={() => setMode(m.id)}><span className="mi-t"><Icon name={m.icon} size={14} />{m.title}{m.id === mode && <Icon name="check" size={13} />}</span><small>{m.desc}</small></button>)}
                      <div className="sep" />
                      {!confirmBypass ? <button role="menuitemradio" aria-checked={bypass} className="mi danger" onClick={() => (bypass ? setMode('default') : setConfirmBypass(true))}><span className="mi-t"><Icon name="shieldOff" size={14} />Dangerously skip permissions{bypass && <Icon name="check" size={13} />}</span><small>Never ask. Commands and edits run immediately</small></button>
                        : <div className="confirm"><b>Turn off all approvals?</b><small>Cento will run any command, including destructive ones, without asking. You can switch back at any time.</small><div><button className="btn ghost" onClick={() => setConfirmBypass(false)}>Cancel</button><button className="btn danger-fill" onClick={() => setMode('bypassPermissions')}>Skip permissions</button></div></div>}
                    </Popover>
                  </div>
                  <button className={`chip ${s.settings.autoSkills ? 'active' : ''}`} onClick={() => send({ t: 'auto', on: !s.settings.autoSkills })} title="Pick matching skills for each message" aria-pressed={s.settings.autoSkills}><Icon name="spark" size={13} />Auto skills</button>
                  <span className="grow" />
                  {s.busy ? <button className="send stop" onClick={() => send({ t: 'interrupt' })} aria-label="Stop"><Icon name="stop" size={14} /></button> : <button className="send" disabled={!text.trim()} onClick={submit} aria-label="Send message"><Icon name="send" size={16} /></button>}
                </div>
              </div>
              <div className="hint"><span className={s.busy ? 'live' : ''}>{s.busy ? `${me.state.replace(/-/g, ' ')}${s.turnStartedAt ? ' · ' + spent(Date.now() - s.turnStartedAt) : ''} · ${s.verb}` : 'Enter to send · Shift+Enter for a new line · Shift+Tab changes mode'}</span></div>
            </div>
          )}
        </section>

        {side && <aside className="side">
          <div className="cento-card"><Cento state={me.state} color={s.settings.color} px={s.agents.length > 1 ? 6 : 8} reduced={s.settings.reducedMotion} /><div className="cstate"><b>{s.approvals.length ? 'Needs you' : s.busy ? me.state.replace(/-/g, ' ') : 'Ready'}</b><small>{me.model ? modelLabel(me.model) : s.engineLabel}</small></div></div>
          {s.agents.length > 1 && <><h4>In this session</h4>
          {[...s.agents].sort((a, b) => Number(b.mine) - Number(a.mine)).map((a) => (
            <div key={a.id} className={`agent ${a.state === 'awaiting-approval' ? 'needs' : ''}`}>
              <Mini state={a.mini} color={a.color} busy={a.busy} />
              <div className="ainfo"><b>{a.name}{a.mine && a.name !== 'you' && <small> you</small>}</b><span className={`astate ${a.busy ? 'busy' : ''}`}>{a.state === 'awaiting-approval' ? 'Needs you' : a.state.replace(/-/g, ' ')}</span><small>{a.model ? modelLabel(a.model) : a.engine}{a.cost ? ' · ' + money(a.cost) : ''}</small></div>
            </div>))}</>}
        </aside>}
      </div>
      <StatusBar s={s} me={me} />
      {ov?.k === 'palette' && <Palette items={cmds} initialQuery={ov.q} onClose={() => setOv(null)} />}
      {ov?.k === 'help' && <Help onClose={() => setOv(null)} />}
      {ov?.k === 'gallery' && <Gallery initial={ov.name} onClose={() => setOv(null)} />}
    </div>
  );
}
