/** pnpm exec tsx tools/docs/releases-page.ts   (writes docs/site/guide/releases.md from docs/releases.json, so the page cannot drift from the list of releases) */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareVersions } from '../../packages/net/src/update/semver.ts';

export interface ReleaseEntry { version: string; channel: 'stable' | 'beta' | 'nightly'; date: string; notes: string[]; url?: string }
const CHANNELS = ['stable', 'beta', 'nightly'] as const;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/; const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with the list, one sentence each (empty = fine). */
export function releaseProblems(list: unknown): string[] {
  if (!Array.isArray(list)) return ['"releases" must be a list'];
  const out: string[] = []; const seen = new Set<string>();
  list.forEach((r: Partial<ReleaseEntry>, i) => {
    const at = `release ${i + 1}${r?.version ? ` (${r.version})` : ''}`;
    if (!r || typeof r.version !== 'string' || !SEMVER.test(r.version)) out.push(`${at}: version must look like 1.2.3`);
    if (!CHANNELS.includes(r?.channel as never)) out.push(`${at}: channel must be stable, beta or nightly`);
    if (typeof r?.date !== 'string' || !DAY.test(r.date) || Number.isNaN(Date.parse(r.date))) out.push(`${at}: date must be YYYY-MM-DD`);
    if (!Array.isArray(r?.notes) || r.notes.length === 0 || r.notes.some((n) => typeof n !== 'string' || !n.trim() || n.includes('\n'))) out.push(`${at}: notes must be a list of non-empty single lines`);
    if (r?.url !== undefined && !/^https:\/\/\S+$/.test(String(r.url))) out.push(`${at}: url must be an https link`);
    const key = `${r?.channel}@${r?.version}`; if (seen.has(key)) out.push(`${at}: listed twice on the same channel`); seen.add(key);
  });
  return out;
}

const newestFirst = (a: ReleaseEntry, b: ReleaseEntry) => compareVersions(b.version, a.version) || b.date.localeCompare(a.date);
export function renderReleases(list: ReleaseEntry[]): string {
  const p = releaseProblems(list); if (p.length) throw new Error('docs/releases.json: ' + p.join('; '));
  const latest = CHANNELS.map((c) => [c, list.filter((r) => r.channel === c).sort(newestFirst)[0]] as const);
  const entry = (r: ReleaseEntry) => [`### ${r.version} · ${r.date}${r.channel === 'stable' ? '' : ` · ${r.channel}`}`, '', ...r.notes.map((n) => `- ${n}`), ...(r.url ? ['', `[Release notes](${r.url})`] : []), ''].join('\n');
  const sorted = [...list].sort(newestFirst);
  return `# Releases

Generated from \`docs/releases.json\`. Do not edit by hand: run \`pnpm docs:gen\`.

## The latest

| Channel | Version | Released |
|---|---|---|
${latest.map(([c, r]) => `| ${c} | ${r ? `**${r.version}**` : 'none yet'} | ${r ? r.date : '–'} |`).join('\n')}

## How Centcom stays up to date

Every time Centcom starts it looks for a newer release on your channel, in the background. It never delays the start, gives up after five seconds, and says nothing when you are offline or already up to date.

- **A standalone install** downloads the new program, checks its SHA-256 and its Ed25519 signature against the keys built into Centcom, and only then replaces itself. Anything that fails a check is deleted and nothing changes. The version you had is kept, so \`centcom update --rollback\` brings it back.
- **An npm or Homebrew install** runs its own update command (\`npm install --global centcom@latest\` or \`brew upgrade centcom\`). If that does not work, for example for lack of permission, the command is shown to you instead.
- **A source checkout** is only told that a newer version exists.

The new version is used the next time you start Centcom. You see one note when it happened.

\`\`\`sh
centcom update --check        # is there something newer? (exit code 10 when yes)
centcom update                # update now, asking first
centcom update --rollback     # go back to the version you had
centcom update --channel beta # follow another channel for this run
\`\`\`

| Setting | Default | What it does |
|---|---|---|
| \`update.check\` | on | look for a newer release each time Centcom starts |
| \`update.auto\` | on | bring it in by itself (off: only say that one exists) |
| \`update.channel\` | stable | \`stable\`, \`beta\` or \`nightly\` |

\`CENTCOM_NO_UPDATE_CHECK=1\` turns the check off for one run, and nothing is checked when \`CI\` is set. Change a setting with \`/settings\` or \`centcom config\`.

## All releases

${sorted.length ? sorted.map(entry).join('\n') : 'There is no public release yet. This page lists each one, newest first, as soon as there is.\n'}`;
}

const SRC = fileURLToPath(new URL('../../docs/releases.json', import.meta.url)); const OUT = fileURLToPath(new URL('../../docs/site/guide/releases.md', import.meta.url));
export const generatedPage = (): string => renderReleases((JSON.parse(readFileSync(SRC, 'utf8')) as { releases: ReleaseEntry[] }).releases);
export const pageIsCurrent = (): boolean => { try { return readFileSync(OUT, 'utf8') === generatedPage(); } catch { return false; } };
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) { writeFileSync(OUT, generatedPage()); console.log('wrote docs/site/guide/releases.md'); }
