/** `/theme`, `/mascot`, `/spinner`, `/motion`, `/density`: show the value, its source and the options, or change it. */
import { OPTIONS, SaveFailed, type SettingKey, type SettingsStore, type UiSettings } from './store.js';

export interface SettingsRegistry { register(name: string, handler: (arg: string) => Promise<void>, desc: string): () => void }
export interface SettingsToast { show(t: { level: 'info' | 'success' | 'warn' | 'error'; text: string }): unknown }
interface Cmd { name: string; key: SettingKey; noun: string; desc: string; options: readonly string[] }
const CMDS: Cmd[] = [
  { name: 'theme', key: 'theme', noun: 'theme', desc: 'Theme: dark, light, auto or hc', options: OPTIONS.theme },
  { name: 'mascot', key: 'mascot', noun: 'mascot', desc: 'Mascot on, off or its colour', options: [...OPTIONS.mascot, ...OPTIONS.mascotColor] },
  { name: 'spinner', key: 'spinner', noun: 'spinner', desc: 'Spinner words: fun or plain', options: OPTIONS.spinner },
  { name: 'motion', key: 'motion', noun: 'motion', desc: 'Motion: full or reduced', options: OPTIONS.motion },
  { name: 'density', key: 'density', noun: 'density', desc: 'Density: comfortable or compact', options: OPTIONS.density },
];
const list = (o: readonly string[]) => (o.length > 2 ? `${o.slice(0, -1).join(', ')} or ${o.at(-1)}` : o.join(' or '));
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Runs one command and returns what to tell the person. */
export async function runSettingsCommand(c: Cmd, store: SettingsStore, argRaw: string): Promise<{ level: 'info' | 'success' | 'warn' | 'error'; text: string }> {
  const arg = argRaw.trim().toLowerCase();
  if (!arg) { const shown = c.name === 'mascot' ? `${store.get().mascot} (${store.get().mascotColor})` : String(store.get()[c.key]); return { level: 'info', text: `${cap(c.noun)}: ${shown} (${store.source(c.key)}). Options: ${c.options.join(', ')}.`.slice(0, 120) }; }
  if (!c.options.includes(arg)) return { level: 'warn', text: `Unknown ${c.noun} "${argRaw.trim().slice(0, 30)}". Try ${list(c.options)}.` };
  /* /mascot red stores the colour, /mascot on|off the visibility */
  const key: SettingKey = c.name === 'mascot' && (OPTIONS.mascotColor as readonly string[]).includes(arg) ? 'mascotColor' : c.key;
  let failed = false; try { await store.set(key, arg as UiSettings[SettingKey]); } catch (e) { if (e instanceof SaveFailed) failed = true; else throw e; }
  const env = store.overriddenBy(key);
  if (failed) return { level: 'warn', text: "Couldn't save this setting. It applies until you quit." };
  if (env) return { level: 'warn', text: `Overridden by ${env} for this session.` };
  return { level: 'success', text: `${cap(c.noun)}: ${arg}.` };
}

export function registerSettingsCommands(d: { registry: SettingsRegistry; store: SettingsStore; toast: SettingsToast }): () => void {
  const offs = CMDS.map((c) => d.registry.register(c.name, async (arg) => { d.toast.show(await runSettingsCommand(c, d.store, arg)); }, c.desc));
  return () => offs.forEach((f) => f());
}
