import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let cache: string[] | undefined;
/** The spinner lines (assets/The-Lines.txt), shuffled per session, never repeating until all are used. */
export function loadVerbs(): string[] {
  if (!cache) cache = readFileSync(fileURLToPath(new URL('../../data/verbs.txt', import.meta.url)), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  return cache;
}

export class VerbRotator {
  private pool: string[] = [];
  constructor(private all: string[] = loadVerbs(), private rand: () => number = Math.random, private maxLen = 40) {}
  next(): string {
    if (!this.pool.length) { this.pool = this.all.filter((v) => v.length <= this.maxLen); for (let i = this.pool.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [this.pool[i], this.pool[j]] = [this.pool[j]!, this.pool[i]!]; } }
    return this.pool.pop() ?? 'Working…';
  }
}
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
