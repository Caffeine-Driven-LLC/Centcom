/**
 * A scripted browser for the local backend's sign-in pages (cookies, forms, the mailed link from Mailpit), so a check can approve a
 * device sign-in the way a person does. Development aid: needs `pnpm dev:up`, `pnpm dev:api` and `pnpm dev:relay` of the backend repo.
 */
import { randomBytes } from 'node:crypto';

export const api = process.env.CENTCOM_API_URL ?? 'http://localhost:3000';
export const relay = process.env.CENTCOM_RELAY_URL ?? 'ws://localhost:8088/v1/ws';
export const mailpit = process.env.DEV_MAILPIT_URL ?? 'http://127.0.0.1:8025';
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class Browser {
  private readonly jar = new Map<string, string>();
  private keep(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair = '', ...attrs] = line.split('; '); const eq = pair.indexOf('='); const value = pair.slice(eq + 1);
      if (value === '' || attrs.some((a) => a.toLowerCase() === 'max-age=0')) this.jar.delete(pair.slice(0, eq)); else this.jar.set(pair.slice(0, eq), value);
    }
  }
  async send(url: string, init: RequestInit = {}): Promise<{ res: Response; body: string }> {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(url.startsWith('http') ? url : `${api}${url}`, { ...init, redirect: 'manual', headers: { ...(init.headers as Record<string, string>), ...(cookie ? { cookie } : {}) } });
    this.keep(res); return { res, body: await res.text() };
  }
  post(url: string, form: Record<string, string>) { return this.send(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() }); }
}
const hidden = (html: string, name: string): string => { const m = new RegExp(`name="${name}" value="([^"]*)"`).exec(html); if (m?.[1] === undefined) throw new Error(`no field ${name} in the page`); return m[1].replace(/&amp;/g, '&'); };
async function mailedLink(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const found = (await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages?: { ID: string }[] };
    const id = found.messages?.[0]?.ID;
    if (id !== undefined) { const mail = (await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()) as { Text: string }; const link = /https?:\/\/\S+/.exec(mail.Text)?.[0]; if (link !== undefined) return link; }
    await pause(250);
  }
  throw new Error(`no mail to ${email} in Mailpit`);
}
/** A fresh e-mail address (no account yet: the first sign-in creates it). */
export const freshEmail = (label: string): string => `${label}-${randomBytes(4).toString('hex')}@dev.test`;
/** Opens the device page for `userCode` as `email` (signing in with the mailed link) and allows the device. */
export async function approveDevice(userCode: string, email: string): Promise<void> {
  const browser = new Browser();
  const entry = await browser.send(`/device?user_code=${userCode}`); if (entry.res.status !== 303) throw new Error(`device page: ${entry.res.status}`);
  const form = await browser.send('/device/login');
  const sent = await browser.post('/login/email', { email, return_to: hidden(form.body, 'return_to') }); if (sent.res.status !== 202) throw new Error(`sign-in mail: ${sent.res.status}`);
  const confirm = await browser.send(await mailedLink(email));
  const verified = await browser.post('/login/email/verify', { t: hidden(confirm.body, 't'), csrf: hidden(confirm.body, 'csrf') }); if (verified.res.status !== 303) throw new Error(`sign-in: ${verified.res.status}`);
  const page = await browser.send(`/device?user_code=${userCode}`);
  const decided = await browser.post('/device/approve', { csrf: hidden(page.body, 'csrf'), user_code: userCode });
  if (!decided.body.includes('Device allowed')) throw new Error('the device was not allowed');
}
