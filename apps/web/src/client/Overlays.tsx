import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PAL_HEX } from '@centcom/mascot';
import { Icon } from './Icon.js';
import { Pixels } from './Cento.js';

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true); }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h3>{title}</h3><button className="iconbtn sm" onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button></header>
        <div className="mbody">{children}</div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- help */
const KEYS: [string, string][] = [
  ['Enter', 'Send the message'], ['Shift+Enter', 'New line'], ['Esc', 'Interrupt the agent, or close a panel'], ['Shift+Tab', 'Cycle the permission mode'],
  ['Ctrl/Cmd+K', 'Command palette'], ['Ctrl/Cmd+O', 'Choose the model'], ['Ctrl/Cmd+B', 'Show or hide the side panel'], ['?', 'This help (when the message box is empty)'],
  ['↑ / ↓', 'Message history, or move in a menu'], ['/', 'Slash commands'],
];
export function Help({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <table className="keys"><tbody>{KEYS.map(([k, d]) => <tr key={k}><td>{k.split('+').map((x, i) => <span key={i}>{i > 0 && ' + '}<kbd>{x}</kbd></span>)}</td><td>{d}</td></tr>)}</tbody></table>
      <p className="muted small">At an approval card: Allow, Always this session, Decline. Everything here also works from the command palette.</p>
    </Modal>
  );
}

/* ----------------------------------------------------------------- palette */
export interface PaletteItem { id: string; label: string; hint?: string; icon?: string; run: () => void; group: string }
export function Palette({ items, onClose, initialQuery = '' }: { items: PaletteItem[]; onClose: () => void; initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery); const [sel, setSel] = useState(0); const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => { const w = q.toLowerCase().split(/\s+/).filter(Boolean); return items.filter((i) => w.every((t) => (i.label + ' ' + (i.hint ?? '') + ' ' + i.group).toLowerCase().includes(t))).slice(0, 40); }, [q, items]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { list.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  const run = (i?: PaletteItem) => { if (!i) return; onClose(); setTimeout(i.run, 0); };
  return (
    <div className="scrim top" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command, model or setting" aria-label="Search commands" spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(shown.length - 1, x + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); } else if (e.key === 'Enter') { e.preventDefault(); run(shown[sel]); } else if (e.key === 'Escape') onClose(); }} />
        <div className="plist" ref={list} role="listbox">
          {shown.length === 0 && <div className="empty small"><b>Nothing matches.</b><span>Try fewer words or check the spelling.</span></div>}
          {shown.map((i, n) => (
            <button key={i.id} role="option" aria-selected={n === sel} data-on={n === sel} className="pitem" onMouseMove={() => setSel(n)} onClick={() => run(i)}>
              <Icon name={i.icon ?? 'terminal'} size={15} /><span className="pl">{i.label}</span>{i.hint && <small>{i.hint}</small>}<span className="grow" /><small className="pg">{i.group}</small>
            </button>))}
        </div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></footer>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- gallery */
interface Anim { name: string; cat: string; desc: string; w: number; h: number; social: boolean; frames: { d: number; rows: string[] }[] }
export function Gallery({ onClose, initial }: { onClose: () => void; initial?: string }) {
  const [data, setData] = useState<Anim[] | null>(null); const [err, setErr] = useState(false);
  const [cat, setCat] = useState<string>(''); const [name, setName] = useState(initial ?? ''); const [fi, setFi] = useState(0);
  useEffect(() => { fetch('/animations.json').then((r) => r.json()).then((d) => { setData(d.animations); setCat(d.animations.find((a: Anim) => a.name === initial)?.cat ?? d.animations[0].cat); }).catch(() => setErr(true)); }, [initial]);
  const cats = useMemo(() => [...new Set((data ?? []).map((a) => a.cat))], [data]);
  const list = useMemo(() => (data ?? []).filter((a) => a.cat === cat), [data, cat]);
  const cur = list.find((a) => a.name === name) ?? list[0];
  useEffect(() => { setFi(0); if (!cur || matchMedia('(prefers-reduced-motion: reduce)').matches) return; let i = 0; let t: ReturnType<typeof setTimeout>; const step = () => { i = (i + 1) % cur.frames.length; setFi(i); t = setTimeout(step, cur.frames[i]!.d); }; t = setTimeout(step, cur.frames[0]!.d); return () => clearTimeout(t); }, [cur]);
  return (
    <Modal title={data ? `Cento animations · ${data.length}` : 'Cento animations'} onClose={onClose} wide>
      {err && <div className="empty"><b>Could not load the animations</b><small>Rebuild the web app with pnpm web:build.</small></div>}
      {!data && !err && <div className="empty"><b>Loading…</b></div>}
      {data && cur && (
        <div className="gallery">
          <div className="gcats" role="tablist">{cats.map((c) => <button key={c} role="tab" aria-selected={c === cat} className={c === cat ? 'on' : ''} onClick={() => { setCat(c); setName(''); }}>{c.replace('ui_', '').replace(/_/g, ' ')}</button>)}</div>
          <div className="gbody">
            <div className="glist" role="listbox">{list.map((a) => <button key={a.name} role="option" aria-selected={a.name === cur.name} className={a.name === cur.name ? 'on' : ''} onClick={() => setName(a.name)}>{a.name}</button>)}</div>
            <div className="gprev"><Pixels rows={cur.frames[fi % cur.frames.length]!.rows} px={Math.max(3, Math.min(10, Math.floor(260 / Math.max(cur.w, cur.h))))} label={cur.desc} /><b>{cur.name}</b><span className="muted">{cur.desc}</span><small>{cur.frames.length} frames · {cur.social ? 'two characters' : 'solo'}</small></div>
          </div>
        </div>)}
    </Modal>
  );
}
void PAL_HEX;
