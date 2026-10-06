import { useEffect, useMemo, useRef, useState } from 'react';
import { CLAUDE_MODELS, modelLabel } from '@centcom/models';
import { COMMANDS } from '@centcom/commands';
import type { Item } from '@centcom/tui';
import { Cento, Mini } from './Cento.js';
import { Diff, Markdown } from './Markdown.js';
import type { Conn } from './net.js';

const MODE: Record<string, string> = { default: 'Ask first', acceptEdits: 'Accept edits', plan: 'Plan (read-only)', bypassPermissions: 'Bypass' };
const money = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const spent = (ms: number) => { const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

function ToolCard({ it }: { it: Extract<Item, { kind: 'tool' }> }) {
  const arg = it.path ?? it.command ?? it.summary;
  return (
    <div className={`tool ${it.status}`}>
      <div className="thead"><span className="dot" /><b>{it.name}</b><code>{arg}</code>{it.risk === 'high' && <span className="risk">high risk</span>}
        {it.approval === 'pending' && <span className="wait">waiting for approval</span>}</div>
      {it.status === 'denied' && <div className="tres warn">{it.result ?? 'Declined'}</div>}
      {it.result && it.status !== 'denied' && <div className={`tres ${it.status === 'error' ? 'err' : ''}`}>{it.result.split('\n').slice(0, 6).join('\n')}</div>}
      {it.diff && (it.status === 'ok' || it.approval === 'approved') && <Diff text={it.diff} />}
    </div>
  );
}

function Row({ it }: { it: Item }) {
  switch (it.kind) {
    case 'user': return <div className="msg user"><div className="who">you</div><div className="bubble">{it.text}</div></div>;
    case 'assistant': return <div className="msg assistant"><Markdown text={it.text} />{!it.done && <span className="caret" />}</div>;
    case 'thinking': return <div className="thinking">{it.done ? `∴ thought for ${spent(Math.max(1000, it.ms))}` : `∴ thinking… ${it.text.slice(-80)}`}</div>;
    case 'tool': return <ToolCard it={it} />;
    case 'notice': return <div className={`notice ${it.level}`}><b>{it.text}</b>{it.detail && <pre>{it.detail}</pre>}</div>;
  }
}

export function Workspace({ c }: { c: Conn }) {
  const { state: s, items, send } = c;
  const [text, setText] = useState('');
  const [sel, setSel] = useState(0);
  const [modelOpen, setModelOpen] = useState(false);
  const [stuck, setStuck] = useState(true);
  const feed = useRef<HTMLDivElement>(null); const box = useRef<HTMLTextAreaElement>(null);
  const [, force] = useState(0);
  const history = useRef<string[]>([]); const hIdx = useRef(-1);

  useEffect(() => { const i = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  useEffect(() => { const el = feed.current; if (el && stuck) el.scrollTop = el.scrollHeight; }, [items, s?.approvals.length, stuck]);
  useEffect(() => { const t = box.current; if (t) { t.style.height = '0'; t.style.height = Math.min(220, t.scrollHeight) + 'px'; } }, [text]);
  useEffect(() => { box.current?.focus(); }, [s?.approvals.length]);

  const slash = useMemo(() => (text.startsWith('/') && !text.includes(' ') && !text.includes('\n') ? COMMANDS.filter((x) => x.name.startsWith(text.slice(1).toLowerCase())).slice(0, 7) : []), [text]);
  if (!s) return <div className="center muted">Starting the agent…</div>;
  const me = s.agents.find((a) => a.mine)!; const pending = s.approvals[0];
  const welcome = items.length === 0 && !s.busy;

  const submit = () => { const t = text.trim(); if (!t) return; history.current.push(t); hIdx.current = -1; send({ t: 'submit', text: t }); setText(''); setStuck(true); };
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
  const limit = s.limits.find((l) => l.name === 'five_hour');

  return (
    <div className="workspace">
      <header className="bar">
        <button className="icon" title="Back to folders" onClick={() => send({ t: 'close' })}>←</button>
        <div className="crumb"><b>{c.opened?.split('/').pop()}</b>{s.branch && <span className="branch">⎇ {s.branch}</span>}{s.demo && <span className="pill warn">demo</span>}</div>
        <div className="spacer" />
        <div className="menu">
          <button className="chip" onClick={() => setModelOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={modelOpen}>{me.model ? modelLabel(me.model) : 'Model'} ▾</button>
          {modelOpen && (
            <div className="pop" role="listbox" onMouseLeave={() => setModelOpen(false)}>
              {CLAUDE_MODELS.map((m) => <button key={m.id || 'default'} role="option" aria-selected={m.id === s.settings.model} className={m.id === s.settings.model ? 'on' : ''} onClick={() => { send({ t: 'setModel', id: m.id }); setModelOpen(false); }}><span>{m.label}</span><small>{m.note}</small></button>)}
            </div>)}
        </div>
        <button className="chip" onClick={() => send({ t: 'cycleMode' })} title="Shift+Tab">{MODE[s.settings.permissionMode]}</button>
        <button className={`chip ${s.settings.autoSkills ? 'active' : ''}`} onClick={() => send({ t: 'auto', on: !s.settings.autoSkills })} title="Auto skills">✦ Auto skills {s.settings.autoSkills ? 'on' : 'off'}</button>
      </header>

      <div className="body">
        <section className="main">
          <div className="feed" ref={feed} onScroll={(e) => { const el = e.currentTarget; setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 40); }}>
            {welcome ? (
              <div className="welcome"><Cento state="first-run" color={s.settings.color} px={8} reduced={s.settings.reducedMotion} /><h2>What should we build?</h2>
                <p className="muted">Working in {c.opened}</p>
                {s.demo && <p>Try <button className="link" onClick={() => send({ t: 'submit', text: '/demo fix' })}>/demo fix</button> · <button className="link" onClick={() => send({ t: 'submit', text: '/demo search' })}>/demo search</button> · <button className="link" onClick={() => send({ t: 'submit', text: '/demo delete' })}>/demo delete</button></p>}
              </div>
            ) : <div className="items">{items.map((it) => <Row key={it.id} it={it} />)}</div>}
          </div>
          {!stuck && <button className="jump" onClick={() => { setStuck(true); }}>↓ Latest</button>}

          {pending ? (
            <div className={`approval ${pending.risk}`} role="alertdialog" aria-label="Approval needed">
              <h3>{pending.tool === 'Bash' ? 'Allow Cento to run a command?' : /Edit|Write/.test(pending.tool) ? 'Allow Cento to change a file?' : `Allow Cento to use ${pending.tool}?`}</h3>
              <div className="line"><b>{pending.tool}</b> <code>{pending.path ?? pending.command ?? pending.summary}</code> <span className={`risk ${pending.risk}`}>{pending.risk} risk</span></div>
              {pending.diff && <Diff text={pending.diff} />}
              <div className="line muted">runs on {pending.agentName === 'you' ? 'your' : pending.agentName + "'s"} account</div>
              <div className="actions">
                <button className="primary" onClick={() => send({ t: 'approve', decision: 'approve' })}>Yes</button>
                {pending.risk !== 'high' && <button className="secondary" onClick={() => send({ t: 'approve', decision: 'approve', scope: 'session' })}>Always this session</button>}
                <button className="danger" onClick={() => send({ t: 'approve', decision: 'deny' })}>No</button>
              </div>
            </div>
          ) : (
            <div className="composer">
              {slash.length > 0 && <div className="slash">{slash.map((m, i) => <button key={m.name} className={i === sel % slash.length ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); setText('/' + m.name + (m.args ? ' ' : '')); }}><b>/{m.name}</b> <small>{m.desc}</small></button>)}</div>}
              <textarea ref={box} value={text} rows={1} placeholder={s.busy ? 'Cento is working… Esc to interrupt' : 'Message Cento…  (Enter to send, Shift+Enter for a new line, / for commands)'} onChange={(e) => { setText(e.target.value); setSel(0); }} onKeyDown={onKey} aria-label="Message" />
              {s.busy ? <button className="danger" onClick={() => send({ t: 'interrupt' })}>Stop</button> : <button className="primary" disabled={!text.trim()} onClick={submit}>Send</button>}
            </div>
          )}
          <footer className="status"><span className={s.busy ? 'live' : ''}>{s.busy ? `● ${me.state.replace(/-/g, ' ')}${s.turnStartedAt ? ' · ' + spent(Date.now() - s.turnStartedAt) : ''}` : '○ idle'}</span>
            {me.inTok + me.outTok > 0 && <span>{tok(me.inTok + me.outTok)} tokens</span>}{me.cost > 0 && <span>{money(me.cost)} est.</span>}{limit && <span className={limit.utilization >= 0.9 ? 'bad' : ''}>5h {Math.round(limit.utilization * 100)}%</span>}
            <span className="spacer" />{s.busy && <span className="muted">{s.verb}</span>}</footer>
        </section>

        <aside className="side">
          <div className="cento-card"><Cento state={me.state} color={s.settings.color} px={6} reduced={s.settings.reducedMotion} /></div>
          <h4>Fleet</h4>
          {[...s.agents].sort((a, b) => Number(b.mine) - Number(a.mine)).map((a) => (
            <div key={a.id} className={`agent ${a.state === 'awaiting-approval' ? 'needs' : ''}`}>
              <Mini state={a.mini} color={a.color} busy={a.busy} />
              <div><b>{a.name}</b>{a.mine && <small> · you</small>}<div className="muted">{a.state === 'awaiting-approval' ? 'needs you' : a.state.replace(/-/g, ' ')}</div><small className="muted">{a.model ? modelLabel(a.model) : a.engine}{a.cost ? ' · ' + money(a.cost) : ''}</small></div>
            </div>))}
        </aside>
      </div>
    </div>
  );
}
