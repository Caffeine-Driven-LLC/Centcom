/** Reads and validates the site's three config files (config/site.json, pricing.json, releases.json). Owns their shapes; must not invent a value: a missing price or URL stays null and the pages say TBD. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface SiteConfig { name: string; tagline: string; domain: string | null; repoUrl: string; docsUrl: string; contactEmail: string | null; operator: string; hostedWebAppUrl: string | null }
export type Price = { status: 'free' } | { status: 'tbd' } | { status: 'known'; amountMinor: number; currency: string };
export interface Plan { id: string; name: string; tagline: string; price: Price; limits: Record<string, number | boolean | null> }
export interface Pricing { currencies: string[]; period: string; limitsSource: string; limitLabels: Record<string, string>; plans: Plan[] }
export interface Platform { id: string; os: string; arch: string; format: string; status: 'planned' | 'available'; url: string | null; sha256: string | null }
export interface Releases { version: string | null; channel: string; platforms: Platform[]; cli: { requires: string; npm: string; note: string } }

const dir = fileURLToPath(new URL('../config/', import.meta.url));
const load = (f: string): unknown => JSON.parse(readFileSync(dir + f, 'utf8'));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const strOrNull = (v: unknown): boolean => v === null || str(v);
const isUrl = (v: unknown): boolean => { if (!str(v)) return false; try { return new URL(v).protocol === 'https:'; } catch { return false; } };

/** Problems in a site config (empty when valid). */
export function siteProblems(v: unknown): string[] {
  if (!isObj(v)) return ['site.json is not an object'];
  const p: string[] = [];
  for (const k of ['name', 'tagline', 'operator']) if (!str(v[k])) p.push(`site.${k} must be a non-empty string`);
  for (const k of ['repoUrl', 'docsUrl']) if (!isUrl(v[k])) p.push(`site.${k} must be an https URL`);
  for (const k of ['domain', 'contactEmail']) if (!strOrNull(v[k])) p.push(`site.${k} must be a string or null (TBD)`);
  if (v.hostedWebAppUrl !== null && !isUrl(v.hostedWebAppUrl)) p.push('site.hostedWebAppUrl must be an https URL or null (TBD)');
  return p;
}

/** Problems in the pricing config (empty when valid). A price is free, tbd (no amount) or known (integer minor units in a listed currency): never a guess. */
export function pricingProblems(v: unknown): string[] {
  if (!isObj(v)) return ['pricing.json is not an object'];
  const p: string[] = [];
  const currencies = Array.isArray(v.currencies) ? v.currencies.filter(str) : [];
  if (currencies.length === 0 || currencies.some((c) => c !== 'USD' && c !== 'EUR')) p.push('pricing.currencies must list USD and/or EUR only');
  if (!str(v.period)) p.push('pricing.period is required');
  if (!isObj(v.limitLabels)) p.push('pricing.limitLabels is required');
  const labels = isObj(v.limitLabels) ? Object.keys(v.limitLabels) : [];
  if (!Array.isArray(v.plans) || v.plans.length === 0) return [...p, 'pricing.plans must be a non-empty list'];
  const seen = new Set<string>();
  for (const plan of v.plans as unknown[]) {
    if (!isObj(plan) || !str(plan.id)) { p.push('a plan has no id'); continue; }
    const id = plan.id; if (seen.has(id)) p.push(`plan ${id} is listed twice`); seen.add(id);
    if (!str(plan.name) || !str(plan.tagline)) p.push(`plan ${id} needs a name and a tagline`);
    const price = plan.price;
    if (!isObj(price)) { p.push(`plan ${id} has no price object`); }
    else if (price.status === 'free' || price.status === 'tbd') { if ('amountMinor' in price || 'currency' in price) p.push(`plan ${id}: a ${price.status} price must not carry an amount`); }
    else if (price.status === 'known') { if (!Number.isInteger(price.amountMinor) || (price.amountMinor as number) < 0) p.push(`plan ${id}: amountMinor must be a whole number of minor units`); if (!currencies.includes(price.currency as string)) p.push(`plan ${id}: currency must be one of ${currencies.join(', ')}`); }
    else p.push(`plan ${id}: price.status must be free, tbd or known`);
    if (!isObj(plan.limits)) { p.push(`plan ${id} has no limits`); continue; }
    for (const [k, val] of Object.entries(plan.limits)) { if (!labels.includes(k)) p.push(`plan ${id}: limit ${k} has no label`); if (!(val === null || typeof val === 'boolean' || (Number.isInteger(val) && (val as number) >= 0))) p.push(`plan ${id}: limit ${k} must be a boolean, a whole number or null (unlimited)`); }
    for (const k of labels) if (!(k in plan.limits)) p.push(`plan ${id}: limit ${k} is missing`);
  }
  return p;
}

/** Problems in the releases file (empty when valid). An available artifact needs an https URL and a SHA-256, and the file needs a version. */
export function releasesProblems(v: unknown): string[] {
  if (!isObj(v)) return ['releases.json is not an object'];
  const p: string[] = [];
  if (!strOrNull(v.version)) p.push('releases.version must be a string or null');
  if (!str(v.channel)) p.push('releases.channel is required');
  if (!isObj(v.cli) || !str(v.cli.requires) || !str(v.cli.npm) || !str(v.cli.note)) p.push('releases.cli needs requires, npm and note');
  if (!Array.isArray(v.platforms) || v.platforms.length === 0) return [...p, 'releases.platforms must be a non-empty list'];
  const seen = new Set<string>(); let anyAvailable = false;
  for (const pl of v.platforms as unknown[]) {
    if (!isObj(pl) || !str(pl.id)) { p.push('a platform has no id'); continue; }
    if (seen.has(pl.id)) p.push(`platform ${pl.id} is listed twice`); seen.add(pl.id);
    for (const k of ['os', 'arch', 'format']) if (!str(pl[k])) p.push(`platform ${pl.id}: ${k} is required`);
    if (pl.status === 'available') { anyAvailable = true; if (!isUrl(pl.url)) p.push(`platform ${pl.id}: an available build needs an https url`); if (typeof pl.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(pl.sha256)) p.push(`platform ${pl.id}: an available build needs a 64-character lowercase sha256`); }
    else if (pl.status === 'planned') { if (pl.url !== null || pl.sha256 !== null) p.push(`platform ${pl.id}: a planned build must have url and sha256 null`); }
    else p.push(`platform ${pl.id}: status must be planned or available`);
  }
  if (anyAvailable && !str(v.version)) p.push('releases.version is required once a build is available');
  return p;
}

const checked = <T>(name: string, v: unknown, problems: (v: unknown) => string[]): T => { const p = problems(v); if (p.length) throw new Error(`${name}: ${p.join('; ')}`); return v as T; };
export const loadSite = (): SiteConfig => checked('site.json', load('site.json'), siteProblems);
export const loadPricing = (): Pricing => checked('pricing.json', load('pricing.json'), pricingProblems);
export const loadReleases = (): Releases => checked('releases.json', load('releases.json'), releasesProblems);
export const rawConfig = (f: 'site.json' | 'pricing.json' | 'releases.json'): unknown => load(f);
