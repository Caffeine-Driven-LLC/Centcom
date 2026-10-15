/** Turns a page template in pages/ into finished HTML: shared partials, generated blocks (plans, downloads) and site facts. Owns the expansion; must not fetch anything or add scripts. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPricing, loadReleases, loadSite, type Plan, type Pricing, type Releases, type SiteConfig } from './config.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export const PAGES_DIR = `${root}pages/`;
const partial = (n: string): string => readFileSync(`${root}partials/${n}.html`, 'utf8').trimEnd();

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The text for one limit value: yes/no for flags, "None" for 0, "Unlimited" for null. */
export function limitText(key: string, v: number | boolean | null): string {
  if (typeof v === 'boolean') return v ? 'Included' : 'Not included';
  if (v === null) return 'Unlimited';
  if (v === 0) return key === 'history_days' || key === 'audit_log_days' || key === 'hosted_minutes_month' || key === 'max_concurrent_sessions' || key === 'webhooks_max' ? 'None' : '0';
  return v.toLocaleString('en-US');
}

function priceHtml(plan: Plan): string {
  const pr = plan.price;
  if (pr.status === 'free') return '<p class="price">No charge</p>';
  if (pr.status === 'tbd') return '<p class="price"><span class="tag tag-tbd">Price to be announced</span></p>';
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: pr.currency }).format(pr.amountMinor / 100);
  return `<p class="price">${esc(amount)} <span class="per">per seat per month</span></p>`;
}

/** The plan cards and the limits table, from config/pricing.json. */
export function pricingHtml(c: Pricing = loadPricing()): string {
  const cards = c.plans.map((p) => `<article class="card plan" aria-labelledby="plan-${esc(p.id)}"><h2 id="plan-${esc(p.id)}" class="plan-name">${esc(p.name)}</h2>${priceHtml(p)}<p>${esc(p.tagline)}</p></article>`).join('\n');
  const head = c.plans.map((p) => `<th scope="col">${esc(p.name)}</th>`).join('');
  const rows = Object.entries(c.limitLabels).map(([k, label]) => `<tr><th scope="row">${esc(label)}</th>${c.plans.map((p) => `<td data-label="${esc(p.name)}">${esc(limitText(k, p.limits[k] ?? null))}</td>`).join('')}</tr>`).join('\n');
  return `<div class="grid plans">\n${cards}\n</div>\n<div class="table-wrap" tabindex="0" role="region" aria-label="Plan limits"><table><caption>What each plan allows</caption><thead><tr><th scope="col">Limit</th>${head}</tr></thead><tbody>\n${rows}\n</tbody></table></div>`;
}

/** The desktop platform list, from config/releases.json. */
export function downloadsHtml(r: Releases = loadReleases()): string {
  const items = r.platforms.map((p) => {
    const name = `${esc(p.os)} <span class="muted">${esc(p.arch)}, ${esc(p.format)}</span>`;
    if (p.status === 'available' && p.url) return `<li class="card dl"><span>${name}</span><a class="btn" href="${esc(p.url)}">Download${r.version ? ` ${esc(r.version)}` : ''}</a><code class="sha" title="SHA-256">${esc(p.sha256 ?? '')}</code></li>`;
    return `<li class="card dl"><span>${name}</span><span class="tag tag-planned">Planned</span></li>`;
  }).join('\n');
  return `<ul class="dl-list">\n${items}\n</ul>`;
}

/** The command line install, from config/releases.json. */
export function cliHtml(r: Releases = loadReleases()): string {
  return `<pre class="code"><code>${esc(r.cli.npm)}</code></pre><p>${esc(r.cli.requires)}. ${esc(r.cli.note)}</p>`;
}

/** Marks the menu link of the page being shown. */
const markCurrent = (nav: string, file: string): string => nav.replace(/<a ([^>]*?)href="([^"]+)"([^>]*)>/g, (m, pre: string, href: string, rest: string) => (href === file || (file === 'index.html' && href === './') ? `<a ${pre}href="${href}"${rest} aria-current="page">` : m));

/** Facts from config/site.json that a page may print: {{site.name}} and friends, or "to be decided" when null. */
function vars(s: SiteConfig): Record<string, string> {
  return { name: s.name, tagline: s.tagline, operator: s.operator, repoUrl: s.repoUrl, docsUrl: s.docsUrl, domain: s.domain ?? 'the domain is to be decided', contactEmail: s.contactEmail ?? 'a contact address (to be decided)' };
}

/** Expands one page template by file name ("pricing.html"). */
export function renderPage(file: string): string {
  const site = loadSite(); const v = vars(site);
  let html = readFileSync(`${PAGES_DIR}${file}`, 'utf8');
  html = html.replace(/<!--@include (\w+)-->/g, (_m, n: string) => (n === 'nav' ? markCurrent(partial(n), file) : partial(n)));
  html = html.replace('<!--@pricing-->', () => pricingHtml()).replace('<!--@downloads-->', () => downloadsHtml()).replace('<!--@cli-->', () => cliHtml());
  html = html.replace(/\{\{site\.(\w+)\}\}/g, (_m, k: string) => esc(v[k] ?? ''));
  return html;
}
