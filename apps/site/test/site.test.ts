import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPricing, loadReleases, loadSite, pricingProblems, rawConfig, releasesProblems, siteProblems } from '../src/config.js';
import { downloadsHtml, limitText, pricingHtml, renderPage } from '../src/render.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const pagesDir = `${root}pages/`; const publicDir = `${root}public/`;
const pages = readdirSync(pagesDir).filter((f) => f.endsWith('.html')).sort();
const html = new Map(pages.map((p) => [p, renderPage(p)]));
/* eslint-disable @typescript-eslint/no-explicit-any */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const idsOf = (h: string): Set<string> => new Set([...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
const TAG_ATTR = /<(a|link|img|script|source|iframe|form|video|audio|embed|object)\b[^>]*?\s(href|src|action|data|poster)="([^"]*)"/g;

describe('pages', () => {
  it('has every page the site promises', () => {
    for (const p of ['index.html', 'how-it-works.html', 'pricing.html', 'download.html', 'docs.html', 'privacy.html', 'terms.html', '404.html']) expect(pages).toContain(p);
  });

  it.each(pages)('%s has a title, a description and exactly one h1', (p) => {
    const h = html.get(p)!;
    expect(h).toMatch(/^<!doctype html>/i);
    expect(h).toMatch(/<html lang="[a-z-]+"/);
    expect(h).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1"/);
    const title = /<title>([^<]+)<\/title>/.exec(h)?.[1] ?? ''; expect(title.trim().length).toBeGreaterThan(3);
    const desc = /<meta name="description" content="([^"]+)"/.exec(h)?.[1] ?? ''; expect(desc.length).toBeGreaterThan(40); expect(desc.length).toBeLessThanOrEqual(200);
    expect(h.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(h).toContain('id="main"'); expect(h).toContain('class="skip"');
  });

  it('gives each page its own title and description', () => {
    const titles = pages.map((p) => /<title>([^<]+)</.exec(html.get(p)!)![1]); const descs = pages.map((p) => /name="description" content="([^"]+)"/.exec(html.get(p)!)![1]);
    expect(new Set(titles).size).toBe(pages.length); expect(new Set(descs).size).toBe(pages.length);
  });

  it('has no unexpanded template markers', () => { for (const [p, h] of html) { expect(h, p).not.toMatch(/<!--@/); expect(h, p).not.toMatch(/\{\{/); } });

  it('marks the draft pages as drafts for a human to review', () => {
    for (const p of ['privacy.html', 'terms.html']) { expect(html.get(p)).toMatch(/DRAFT/); expect(html.get(p)).toMatch(/<title>[^<]*\(draft\)/); }
  });

  it('marks the current page in the menu', () => { expect(html.get('pricing.html')).toMatch(/<a href="pricing.html" aria-current="page">/); expect(html.get('index.html')).toMatch(/<a class="brand" href=".\/" aria-current="page">/); });

  it('keeps the trademark notice in the footer', () => { for (const h of html.values()) expect(h).toMatch(/not affiliated with or endorsed by/); });
});

describe('internal links', () => {
  const targets = (from: string) => [...html.get(from)!.matchAll(TAG_ATTR)].map((m) => ({ tag: m[1]!, attr: m[2]!, url: m[3]! })).filter((l) => !/^(https?:|mailto:)/.test(l.url));

  it.each(pages)('every local link, image and stylesheet of %s resolves, anchors included', (p) => {
    for (const l of targets(p)) {
      const [path = '', anchor] = l.url.replace(/^\//, '').split('#');
      const file = path === '' ? p : path === './' || path === '' ? 'index.html' : path;
      const inPages = existsSync(pagesDir + file) && !file.endsWith('/'); const inPublic = existsSync(publicDir + file) && !file.endsWith('/');
      expect(inPages || inPublic, `${p}: ${l.url} goes nowhere`).toBe(true);
      if (anchor) { expect(file.endsWith('.html'), `${p}: ${l.url} has an anchor on a non-page`).toBe(true); expect(idsOf(html.get(file)!).has(anchor), `${p}: ${l.url} has no element with id "${anchor}"`).toBe(true); }
    }
  });

  it('links every page from the menu or footer, so none is an orphan', () => {
    const linked = new Set<string>(); for (const p of pages) for (const l of targets(p)) linked.add(l.url.split('#')[0]!);
    for (const p of pages.filter((x) => x !== '404.html' && x !== 'index.html')) expect(linked.has(p), `${p} is not linked from anywhere`).toBe(true);
  });

  it('external links are only plain links the visitor clicks, and all use https', () => {
    for (const [p, h] of html) for (const m of h.matchAll(TAG_ATTR)) if (/^https?:/.test(m[3]!)) { expect(m[1], `${p}: external ${m[3]}`).toBe('a'); expect(m[3]).toMatch(/^https:\/\//); }
  });
});

describe('nothing is requested from other sites, nothing tracks', () => {
  it('loads no external resource, script, font or stylesheet import', () => {
    for (const [p, h] of html) for (const m of h.matchAll(TAG_ATTR)) if (m[1] !== 'a') expect(m[3], `${p}: <${m[1]} ${m[2]}>`).not.toMatch(/^(https?:)?\/\//);
    const css = readFileSync(`${pagesDir}style.css`, 'utf8');
    expect(css).not.toMatch(/@import/); expect(css).not.toMatch(/url\(\s*['"]?(https?:)?\/\//); expect(css).not.toMatch(/@font-face/);
    expect(css).not.toMatch(/https?:\/\//);
  });

  it('has no scripts, inline handlers, iframes, forms, preconnects or prefetches', () => {
    for (const [p, h] of html) { expect(h, p).not.toMatch(/<script/i); expect(h, p).not.toMatch(/\son[a-z]+=/i); expect(h, p).not.toMatch(/<(iframe|form|object|embed)\b/i); expect(h, p).not.toMatch(/rel="(preconnect|dns-prefetch|prefetch|preload)"/); expect(h, p).not.toMatch(/<meta[^>]+http-equiv="refresh"/i); }
  });

  it('sets no cookies and stores nothing', () => { for (const [p, h] of html) expect(h, p).not.toMatch(/document\.cookie|localStorage|sessionStorage|gtag|googletagmanager|plausible|matomo/i); });

  it('keeps the Vite config on the same rules (only pages and public files)', () => {
    const cfg = readFileSync(`${root}vite.config.ts`, 'utf8'); expect(cfg).not.toMatch(/https?:\/\//);
    expect(JSON.parse(readFileSync(`${root}package.json`, 'utf8')).dependencies).toBeUndefined();
  });
});

describe('accessibility basics', () => {
  it.each(pages)('%s: images have alt, tables have captions and header cells, headings do not skip', (p) => {
    const h = html.get(p)!;
    for (const m of h.matchAll(/<img\b[^>]*>/g)) expect(m[0], p).toMatch(/\salt="/);
    for (const t of h.matchAll(/<table\b[\s\S]*?<\/table>/g)) { expect(t[0]).toMatch(/<caption>/); expect(t[0]).toMatch(/<th scope="(col|row)"/); }
    const levels = [...h.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1])); let prev = 0;
    for (const l of levels) { expect(l, `${p}: heading jumps from h${prev} to h${l}`).toBeLessThanOrEqual(prev + 1); prev = l; }
    const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]); expect(new Set(ids).size, `${p}: duplicate ids`).toBe(ids.length);
  });

  it('supports narrow screens, dark mode, keyboard focus and reduced motion', () => {
    const css = readFileSync(`${pagesDir}style.css`, 'utf8');
    expect(css).toContain('prefers-color-scheme: light'); expect(css).toContain(':focus-visible'); expect(css).toContain('prefers-reduced-motion'); expect(css).toMatch(/max-width:\s*40rem/);
    expect(css).toMatch(/color-scheme:\s*dark light/);
    for (const [p, h] of html) expect(h, p).toContain('name="color-scheme"');
  });
});

describe('config files', () => {
  it('site.json, pricing.json and releases.json are valid', () => {
    expect(siteProblems(rawConfig('site.json'))).toEqual([]); expect(pricingProblems(rawConfig('pricing.json'))).toEqual([]); expect(releasesProblems(rawConfig('releases.json'))).toEqual([]);
    expect(() => { loadSite(); loadPricing(); loadReleases(); }).not.toThrow();
  });

  it('does not invent a price: every paid plan is TBD until a price is defined', () => {
    const c = loadPricing();
    expect(c.plans.map((p) => p.id)).toEqual(['free', 'pro', 'team']);
    for (const p of c.plans) expect(p.price.status).toBe(p.id === 'free' ? 'free' : 'tbd');
    const page = html.get('pricing.html')!; expect(page).toMatch(/Price to be announced/); expect(page).not.toMatch(/[$€]\s?\d/);
  });

  it('shows every plan and every limit on the pricing page', () => {
    const c = loadPricing(); const h = pricingHtml(c);
    for (const p of c.plans) expect(h).toContain(`>${p.name}</h2>`);
    for (const label of Object.values(c.limitLabels)) expect(h).toContain(label);
    expect(limitText('hosted_minutes_month', 6000)).toBe('6,000'); expect(limitText('history_days', 0)).toBe('None'); expect(limitText('relay_access', false)).toBe('Not included'); expect(limitText('x', null)).toBe('Unlimited');
  });

  it('rejects broken pricing', () => {
    const base = rawConfig('pricing.json');
    const cases: Array<[string, (c: any) => void, RegExp]> = [
      ['a tbd price with an amount', (c) => { c.plans[1].price = { status: 'tbd', amountMinor: 900 }; }, /must not carry an amount/],
      ['a fractional amount', (c) => { c.plans[1].price = { status: 'known', amountMinor: 9.5, currency: 'USD' }; }, /whole number/],
      ['an unlisted currency', (c) => { c.plans[1].price = { status: 'known', amountMinor: 900, currency: 'GBP' }; }, /currency/],
      ['an unknown status', (c) => { c.plans[2].price = { status: 'cheap' }; }, /free, tbd or known/],
      ['a missing limit', (c) => { delete c.plans[0].limits.max_seats; }, /max_seats is missing/],
      ['an unlabelled limit', (c) => { c.plans[0].limits.surprise = 3; }, /no label/],
      ['a negative limit', (c) => { c.plans[0].limits.max_seats = -1; }, /boolean, a whole number or null/],
      ['a duplicate plan', (c) => { c.plans[2].id = 'pro'; }, /listed twice/],
      ['no plans', (c) => { c.plans = []; }, /non-empty/],
    ];
    for (const [name, mutate, re] of cases) { const c = clone(base) as any; mutate(c); expect(pricingProblems(c).join('\n'), name).toMatch(re); }
    expect(pricingProblems([])).not.toEqual([]);
  });

  it('accepts a known price and shows it as money', () => {
    const c = clone(loadPricing()); c.plans[1]!.price = { status: 'known', amountMinor: 1900, currency: 'USD' };
    expect(pricingProblems(c)).toEqual([]); expect(pricingHtml(c)).toContain('$19.00');
  });

  it('rejects broken releases and site files', () => {
    const base = rawConfig('releases.json') as any;
    const cases: Array<[string, (c: any) => void, RegExp]> = [
      ['an available build without a url', (c) => { c.version = '1.0.0'; c.platforms[0].status = 'available'; c.platforms[0].sha256 = 'a'.repeat(64); }, /https url/],
      ['an http url', (c) => { c.version = '1.0.0'; c.platforms[0] = { ...c.platforms[0], status: 'available', url: 'http://x.test/a', sha256: 'a'.repeat(64) }; }, /https url/],
      ['a bad checksum', (c) => { c.version = '1.0.0'; c.platforms[0] = { ...c.platforms[0], status: 'available', url: 'https://x.test/a', sha256: 'XYZ' }; }, /sha256/],
      ['an available build without a version', (c) => { c.platforms[0] = { ...c.platforms[0], status: 'available', url: 'https://x.test/a', sha256: 'a'.repeat(64) }; }, /version is required/],
      ['a planned build with a url', (c) => { c.platforms[0].url = 'https://x.test/a'; }, /planned build must have url/],
      ['a duplicate platform', (c) => { c.platforms[1].id = c.platforms[0].id; }, /listed twice/],
      ['an unknown status', (c) => { c.platforms[0].status = 'soon'; }, /planned or available/],
      ['no platforms', (c) => { c.platforms = []; }, /non-empty/],
      ['no cli block', (c) => { delete c.cli; }, /releases.cli/],
    ];
    for (const [name, mutate, re] of cases) { const c = clone(base); mutate(c); expect(releasesProblems(c).join('\n'), name).toMatch(re); }
    expect(siteProblems({ ...(rawConfig('site.json') as object), repoUrl: 'ftp://x' }).join()).toMatch(/repoUrl/);
    expect(siteProblems(null)).not.toEqual([]);
  });

  it('turns an available build into a download link with its checksum', () => {
    const c = clone(loadReleases()); c.version = '1.2.3';
    Object.assign(c.platforms[0]!, { status: 'available', url: 'https://downloads.example.test/centcom-1.2.3.AppImage', sha256: 'b'.repeat(64) });
    expect(releasesProblems(c)).toEqual([]);
    const h = downloadsHtml(c); expect(h).toContain('href="https://downloads.example.test/centcom-1.2.3.AppImage"'); expect(h).toContain('b'.repeat(64)); expect(h).toContain('Download 1.2.3');
    expect(h.match(/Planned/g)?.length).toBe(c.platforms.length - 1);
  });

  it('lists every platform on the download page, all planned for now', () => {
    const r = loadReleases(); const page = html.get('download.html')!;
    for (const p of r.platforms) expect(page).toContain(p.os);
    expect(r.platforms.every((p) => p.status === 'planned')).toBe(true); expect(r.version).toBeNull();
    expect(page).toContain(r.cli.npm);
  });

  it('prints nothing in the pages for a null site value except "to be decided"', () => {
    const s = loadSite(); if (s.contactEmail === null) expect(html.get('privacy.html')).toContain('to be decided');
    expect(JSON.stringify(s)).not.toMatch(/example\.com/);
  });
});
