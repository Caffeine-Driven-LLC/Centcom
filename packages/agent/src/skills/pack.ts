/** The bundled pack: five plain SKILL.md files and a manifest of their checksums. Nothing here runs anything. */
import { createHash } from 'node:crypto';
import type { SkillFs } from './fs.js';

export const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/; export const MAX_SKILL = 4096; export const MAX_PACK = 20 * 1024;
export interface Manifest { pack_version: string; skills: Record<string, { sha256: string; bytes: number }> }
export interface Pack { version: string; skills: { name: string; text: string; sha256: string }[] }
export const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
/** Checks one skill file: name equals its folder and is a safe name, a description of 1 to 300 characters, and a body of at most 4 KiB. Returns the problems found. */
export function validateSkill(dirName: string, text: string): string[] {
  const out: string[] = []; const m = /^---\n([\s\S]*?)\n---\n/.exec(text); if (!m) return ['no front matter'];
  const get = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(m[1]!)?.[1]?.trim();
  const name = get('name'); const desc = get('description'); if (!name || !NAME.test(name)) out.push('bad name'); else if (name !== dirName) out.push('name does not match its folder'); if (!NAME.test(dirName)) out.push('unsafe folder name');
  if (!desc || desc.length < 1 || desc.length > 300) out.push('description must be 1 to 300 characters'); if (Buffer.byteLength(text) > MAX_SKILL) out.push('larger than 4 KiB'); if (/\b(curl|wget|bash -c|eval\()\b|https?:\/\/\S+\.(sh|py|js)\b/i.test(text)) out.push('looks like it fetches or runs code');
  return out;
}
export async function loadPack(fs: SkillFs, dir: string): Promise<Pack> {
  const raw = await fs.read(`${dir}/manifest.json`); if (!raw) throw new Error('the skills pack has no manifest'); const man = JSON.parse(raw) as Manifest; const skills: Pack['skills'] = [];
  for (const name of Object.keys(man.skills).sort()) { const text = await fs.read(`${dir}/${name}/SKILL.md`); if (text === undefined) throw new Error(`the skills pack is missing ${name}`); if (sha(text) !== man.skills[name]!.sha256) throw new Error(`the skills pack file ${name} does not match its checksum`); skills.push({ name, text, sha256: man.skills[name]!.sha256 }); }
  return { version: man.pack_version, skills };
}
