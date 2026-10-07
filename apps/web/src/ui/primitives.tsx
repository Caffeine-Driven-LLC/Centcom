import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import './ui.css';

const cx = (...a: (string | false | undefined)[]): string => a.filter(Boolean).join(' ');
export const VisuallyHidden = ({ children }: { children: React.ReactNode }): React.JSX.Element => <span className="cc-vh">{children}</span>;
/** A polite (or assertive) live region: screen readers hear whatever text it holds. */
export function LiveRegion({ politeness = 'polite', children }: { politeness?: 'polite' | 'assertive'; children?: React.ReactNode }): React.JSX.Element { return <div className="cc-vh" role={politeness === 'assertive' ? 'alert' : 'status'} aria-live={politeness} aria-atomic="true">{children}</div>; }
/** A 5x5 pixel glyph drawn from a bitmap string; `name` is looked up in `ICONS`, anything else gets a square. */
export const ICONS: Record<string, string> = { home: '00100.01110.11111.01010.01110', fleet: '10101.01110.11111.01110.10101', people: '01010.00000.11011.11111.10101', billing: '11111.10001.11111.10001.11111', settings: '01110.10101.11011.10101.01110', check: '00001.00010.10100.01000.00000', alert: '00100.00100.00100.00000.00100' };
export function PixelIcon({ name, size = 16, label }: { name: string; size?: number; label?: string }): React.JSX.Element {
  const rows = (ICONS[name] ?? '11111.11111.11111.11111.11111').split('.'); const px = size / 5;
  return <svg className="cc-icon" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} shapeRendering="crispEdges">{rows.flatMap((r, y) => [...r].map((c, x) => (c === '1' ? <rect key={`${x}-${y}`} x={x * px} y={y * px} width={px} height={px} fill="currentColor" /> : null)))}</svg>;
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const primaryCount = { n: 0 };
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: ButtonVariant; /** why it is off: shown as a tooltip and read out */ disabledReason?: string }
/** One primary button per view (a dev-time warning says so); a disabled one explains itself. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', disabledReason, disabled, className, children, ...rest }, ref) {
  const id = useId(); const off = disabled || !!disabledReason;
  useEffect(() => { if (variant !== 'primary') return; primaryCount.n++; if (primaryCount.n > 1 && import.meta.env?.DEV) console.warn('More than one primary button is on this view.'); return () => { primaryCount.n--; }; }, [variant]);
  return <span className="cc-tipwrap"><button ref={ref} type="button" {...rest} className={cx('cc-btn', `cc-btn--${variant}`, className)} aria-disabled={off || undefined} aria-describedby={disabledReason ? id : undefined} disabled={disabled && !disabledReason} onClick={off ? (e) => e.preventDefault() : rest.onClick}>{children}</button>{disabledReason ? <span id={id} role="tooltip" className="cc-tip">{disabledReason}</span> : null}</span>;
});
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }>(function Input({ label, error, className, id, ...rest }, ref) {
  const gen = useId(); const iid = id ?? gen; const eid = `${iid}-err`; return <div className="cc-field"><label htmlFor={iid} className="cc-label">{label}</label><input ref={ref} id={iid} className={cx('cc-input', error && 'cc-input--error', className)} aria-invalid={error ? true : undefined} aria-describedby={error ? eid : undefined} {...rest} />{error ? <p id={eid} className="cc-help cc-help--error">{error}</p> : null}</div>;
});
export const Card = ({ title, children, className }: { title?: string; children?: React.ReactNode; className?: string }): React.JSX.Element => <section className={cx('cc-card', className)} aria-label={title}>{title ? <h3 className="cc-card__title">{title}</h3> : null}{children}</section>;
export const Chip = ({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }): React.JSX.Element => <span className={cx('cc-chip', `cc-chip--${tone}`)}>{children}</span>;
export function Banner({ tone = 'info', title, children, onDismiss }: { tone?: 'info' | 'success' | 'warning' | 'danger'; title?: string; children?: React.ReactNode; onDismiss?: () => void }): React.JSX.Element {
  return <div className={cx('cc-banner', `cc-banner--${tone}`)} role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}><PixelIcon name={tone === 'success' ? 'check' : 'alert'} />{title ? <strong>{title}</strong> : null}<span>{children}</span>{onDismiss ? <button type="button" className="cc-btn cc-btn--ghost" onClick={onDismiss} aria-label="Dismiss">×</button> : null}</div>;
}
/** Arrow keys move between tabs, Home and End jump, Enter or Space picks; only the active panel is shown. */
export function Tabs({ tabs, value, onChange, label }: { tabs: { id: string; label: string; panel: React.ReactNode }[]; value?: string; onChange?: (id: string) => void; label: string }): React.JSX.Element {
  const [inner, setInner] = useState(tabs[0]?.id); const active = value ?? inner; const base = useId(); const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (i: number): void => { const t = tabs[(i + tabs.length) % tabs.length]; if (!t) return; setInner(t.id); onChange?.(t.id); refs.current[(i + tabs.length) % tabs.length]?.focus(); };
  const idx = Math.max(0, tabs.findIndex((t) => t.id === active));
  return <div className="cc-tabs"><div role="tablist" aria-label={label} className="cc-tablist" onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); pick(idx + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); pick(idx - 1); } else if (e.key === 'Home') { e.preventDefault(); pick(0); } else if (e.key === 'End') { e.preventDefault(); pick(tabs.length - 1); } }}>{tabs.map((t, i) => <button key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" type="button" id={`${base}-t-${t.id}`} aria-selected={t.id === active} aria-controls={`${base}-p-${t.id}`} tabIndex={t.id === active ? 0 : -1} className={cx('cc-tab', t.id === active && 'cc-tab--on')} onClick={() => pick(i)}>{t.label}</button>)}</div>{tabs.map((t) => <div key={t.id} role="tabpanel" id={`${base}-p-${t.id}`} aria-labelledby={`${base}-t-${t.id}`} hidden={t.id !== active} className="cc-tabpanel">{t.id === active ? t.panel : null}</div>)}</div>;
}
export function Avatar({ name, slot = 0 }: { name: string; slot?: number }): React.JSX.Element { return <span className={cx('cc-avatar', `cc-avatar--${slot % 5}`)} role="img" aria-label={name}>{[...name.trim()][0]?.toUpperCase() ?? '?'}</span>; }
export const PresenceDot = ({ status }: { status: 'online' | 'away' | 'busy' | 'offline' }): React.JSX.Element => <span className={cx('cc-dot', `cc-dot--${status}`)} role="img" aria-label={status} />;
export const Skeleton = ({ lines = 1, width }: { lines?: number; width?: string }): React.JSX.Element => <div className="cc-skel" aria-hidden="true">{Array.from({ length: lines }, (_, i) => <div key={i} className="cc-skel__line" data-w={width ?? (i === lines - 1 && lines > 1 ? 'short' : 'full')} />)}</div>;
export function Tooltip({ text, children }: { text: string; children: React.ReactElement }): React.JSX.Element { const id = useId(); return <span className="cc-tipwrap">{React.cloneElement(children as React.ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': id })}<span id={id} role="tooltip" className="cc-tip">{text}</span></span>; }
export const EmptyState = ({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }): React.JSX.Element => <div className="cc-empty"><PixelIcon name="home" size={32} /><h3>{title}</h3>{children ? <p>{children}</p> : null}{action}</div>;
export interface Column<T> { key: string; header: string; cell(row: T): React.ReactNode }
/** Up and down move between rows, Home and End jump; a row is one stop in the tab order and the controls inside keep their own. */
function rowNav(e: React.KeyboardEvent<HTMLTableSectionElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || (e.target as HTMLElement).closest('select,input,textarea')) return; const rows = [...e.currentTarget.querySelectorAll<HTMLTableRowElement>('tr[data-row]')]; const here = rows.findIndex((r) => r === (e.target as HTMLElement).closest('tr')); if (here < 0) return;
  const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, here + 1) : e.key === 'ArrowUp' ? Math.max(0, here - 1) : e.key === 'Home' ? 0 : rows.length - 1; e.preventDefault(); rows.forEach((r, i) => r.setAttribute('tabindex', i === next ? '0' : '-1')); rows[next]?.focus();
}
export function Table<T>({ rows, columns, caption, rowKey }: { rows: T[]; columns: Column<T>[]; caption: string; rowKey(r: T): string }): React.JSX.Element {
  return <div className="cc-table-wrap" tabIndex={0} role="region" aria-label={caption}><table className="cc-table"><caption className="cc-vh">{caption}</caption><thead><tr>{columns.map((c) => <th key={c.key} scope="col">{c.header}</th>)}</tr></thead><tbody onKeyDown={rowNav}>{rows.map((r, i) => <tr key={rowKey(r)} tabIndex={i === 0 ? 0 : -1} data-row={i}>{columns.map((c) => <td key={c.key}>{c.cell(r)}</td>)}</tr>)}</tbody></table></div>;
}
/** Traps focus, gives it back on close, and closes on Esc unless there is unsaved input (`dirty`). */
export function Modal({ open, title, onClose, dirty = false, children }: { open: boolean; title: string; onClose: () => void; dirty?: boolean; children?: React.ReactNode }): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null); const back = useRef<Element | null>(null); const tid = useId();
  useEffect(() => { if (!open) return; back.current = document.activeElement; const el = ref.current; const f = (): HTMLElement[] => [...(el?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? [])].filter((x) => !x.hasAttribute('disabled')); (f()[0] ?? el)?.focus(); return () => { (back.current as HTMLElement | null)?.focus?.(); }; }, [open]);
  if (!open) return null;
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' && !dirty) { e.stopPropagation(); onClose(); return; } if (e.key !== 'Tab') return; const els = [...(ref.current?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? [])].filter((x) => !x.hasAttribute('disabled')); if (!els.length) { e.preventDefault(); return; }
    const first = els[0]!; const last = els[els.length - 1]!; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return <div className="cc-scrim"><div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tid} tabIndex={-1} className="cc-modal" onKeyDown={onKey}><h2 id={tid} className="cc-modal__title">{title}</h2>{children}</div></div>;
}
/* ------------------------------------------------------------- toasts */
export interface ToastItem { id: number; tone: 'info' | 'success' | 'warning' | 'danger'; text: string }
const ToastCtx = createContext<{ toasts: ToastItem[]; push(tone: ToastItem['tone'], text: string): void; dismiss(id: number): void }>({ toasts: [], push: () => undefined, dismiss: () => undefined });
export const useToast = (): { toast(tone: ToastItem['tone'], text: string): void } => { const c = useContext(ToastCtx); return useMemo(() => ({ toast: c.push }), [c.push]); };
export function ToastProvider({ children, ttlMs = 6000 }: { children: React.ReactNode; ttlMs?: number }): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]); const n = useRef(0); const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((tone: ToastItem['tone'], text: string) => { const id = ++n.current; setToasts((t) => [...t.slice(-2), { id, tone, text }]); if (ttlMs > 0) setTimeout(() => dismiss(id), ttlMs); }, [dismiss, ttlMs]);
  return <ToastCtx.Provider value={{ toasts, push, dismiss }}>{children}<div className="cc-toasts" role="region" aria-label="Notifications">{toasts.map((x) => <Banner key={x.id} tone={x.tone} onDismiss={() => dismiss(x.id)}>{x.text}</Banner>)}</div></ToastCtx.Provider>;
}
