/** What the page may use from the desktop app. It is a small, fixed surface; the page gets no Node and no Electron objects. */
import { contextBridge, ipcRenderer } from 'electron';
const CH = { link: 'centcom:link', open: 'centcom:open-external' } as const;
contextBridge.exposeInMainWorld('centcom', {
  desktop: true as const, platform: process.platform,
  onLink(cb: (url: string) => void): () => void { const f = (_e: unknown, url: unknown): void => { if (typeof url === 'string') cb(url); }; ipcRenderer.on(CH.link, f); void ipcRenderer.invoke('centcom:ready'); return () => ipcRenderer.removeListener(CH.link, f); },
  /** The local agent session in this window: messages go to the main process and its answers come back. */
  local: { send(msg: unknown): void { if (msg && typeof msg === 'object' && typeof (msg as { t?: unknown }).t === 'string') void ipcRenderer.invoke('centcom:local', msg); }, onMessage(cb: (m: unknown) => void): () => void { const f = (_e: unknown, m: unknown): void => cb(m); ipcRenderer.on('centcom:local:msg', f); return () => ipcRenderer.removeListener('centcom:local:msg', f); } },
  openExternal(url: string): Promise<boolean> { return typeof url === 'string' ? (ipcRenderer.invoke(CH.open, url) as Promise<boolean>) : Promise.resolve(false); },
});
