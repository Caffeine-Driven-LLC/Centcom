import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMsg, ServerMsg, WebState } from '../server/protocol.js';
import type { Item } from '@centcom/tui';

export type Launcher = Extract<ServerMsg, { t: 'launcher' }>;
export type DirMsg = Extract<ServerMsg, { t: 'dir' }>;

export interface Conn {
  up: boolean; launcher?: Launcher; dir?: DirMsg; opened?: string; state?: WebState; items: Item[]; notice?: { level: string; text: string; n: number };
  send: (m: ClientMsg) => void;
}

/** One WebSocket that reconnects by itself; workspace state is rebuilt from `changed` items plus the ordered id list. */
export function useConnection(): Conn {
  const [up, setUp] = useState(false);
  const [launcher, setLauncher] = useState<Launcher>();
  const [dir, setDir] = useState<DirMsg>();
  const [opened, setOpened] = useState<string>();
  const [state, setState] = useState<WebState>();
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<Conn['notice']>();
  const ws = useRef<WebSocket | undefined>(undefined);
  const byId = useRef(new Map<string, Item>());
  const queue = useRef<ClientMsg[]>([]);

  useEffect(() => {
    let closed = false; let retry: ReturnType<typeof setTimeout>; let n = 0;
    const connect = () => {
      const s = new WebSocket(`ws://${location.host}/ws`); ws.current = s;
      s.onopen = () => { setUp(true); s.send(JSON.stringify({ t: 'hello' })); for (const m of queue.current.splice(0)) s.send(JSON.stringify(m)); };
      s.onclose = () => { setUp(false); if (!closed) retry = setTimeout(connect, 800); };
      s.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as ServerMsg;
        switch (m.t) {
          case 'launcher': setLauncher(m); break;
          case 'dir': setDir(m); break;
          case 'opened': byId.current.clear(); setItems([]); setState(undefined); setOpened(m.dir); break;
          case 'closed': setOpened(undefined); setState(undefined); setItems([]); break;
          case 'notice': setNotice({ level: m.level, text: m.text, n: ++n }); break;
          case 'state': {
            for (const it of m.changed) byId.current.set(it.id, it);
            setItems(m.order.map((id) => byId.current.get(id)!).filter(Boolean)); setState(m.state); break;
          }
        }
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws.current?.close(); };
  }, []);

  const send = useCallback((m: ClientMsg) => { const s = ws.current; if (s && s.readyState === s.OPEN) s.send(JSON.stringify(m)); else queue.current.push(m); }, []);
  return { up, launcher, dir, opened, state, items, notice, send };
}
