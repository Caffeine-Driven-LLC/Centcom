import { describe, expect, it, vi } from 'vitest';
import { CATEGORIES, linkFor, textFor, UNKNOWN_TITLE } from '../../src/settings/model.js';

const ses = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
const note = (category: string, o: Record<string, unknown> = {}) => ({ id: 'ntf_1', created_at: 'x', read_at: null, category, title_key: `notif.${category}.title`, body_key: `notif.${category}.body`, params: { session: ses, pct: 80 }, priority: 'normal', ...o }) as never;
describe('rendering from keys (acceptance 1)', () => {
  it('all 14 categories give a title and a body from the table', () => { expect(CATEGORIES).toHaveLength(14); for (const c of CATEGORIES) { const t = textFor(note(c)); expect(t.title.length, c).toBeGreaterThan(2); expect(t.body.length, c).toBeGreaterThan(2); expect(t.title, c).not.toBe(UNKNOWN_TITLE); expect(t.title + t.body, c).not.toMatch(/\{[a-z_]+\}/); } });
  it('an unknown key is "Update from Centcom" with a content-free debug line', () => { const log = vi.fn(); expect(textFor(note('mention', { title_key: 'notif.from_the_future.title' }), log).title).toBe('Update from Centcom'); expect(log).toHaveBeenCalledWith('notification.unknown_key'); });
  it('parameters are text: markup and long free text cannot ride in', () => { const t = textFor(note('usage_warning', { params: { pct: '<img src=x onerror=1>', session: '<b>x</b>' } })); expect(t.title + t.body).not.toContain('<'); expect(textFor(note('mention', { params: { name: 'x'.repeat(500) } })).body.length).toBeLessThan(300); });
});
describe('links (acceptance 5)', () => {
  const act = (deeplink: string) => ({ action: { type: 'open_session', deeplink } }) as never;
  it('only a session link of the documented form becomes an address', () => { expect(linkFor(act(`centcom://session/${ses}`))).toBe(`/s/${ses}`); expect(linkFor(act(`centcom://session/${ses}?focus=approval`))).toBe(`/s/${ses}?focus=approval`); });
  it('javascript:, data:, other schemes, unknown hosts, odd ids and extra parts are not links', () => { for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'https://evil.example/x', 'centcom://evil/x', `centcom://session/${ses}?focus=approval&x=1`, `centcom://session/${ses}?focus=root`, 'centcom://session/ses_short', `centcom://user:pw@session/${ses}`, `centcom://session/${ses}#frag`, 'x'.repeat(300)]) expect(linkFor(act(bad)), bad).toBeUndefined(); expect(linkFor({} as never)).toBeUndefined(); expect(linkFor({ action: { type: 'other', deeplink: `centcom://session/${ses}` } } as never)).toBeUndefined(); });
});
