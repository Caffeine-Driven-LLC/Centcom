/** Models the user can pick. `id` is what we pass to `--model`; aliases follow whatever the CLI currently maps them to. */
export interface ModelChoice { id: string; label: string; note: string; provider: 'anthropic' | 'openai' }
export const CLAUDE_MODELS: ModelChoice[] = [
  { id: '', label: 'Default', note: 'whatever your Claude Code is set to', provider: 'anthropic' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', note: 'most capable, slowest', provider: 'anthropic' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'hard problems and long tasks', provider: 'anthropic' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'everyday coding, fast', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', note: 'quick and cheap', provider: 'anthropic' },
  { id: 'opus', label: 'opus (alias)', note: 'latest Opus', provider: 'anthropic' },
  { id: 'sonnet', label: 'sonnet (alias)', note: 'latest Sonnet', provider: 'anthropic' },
  { id: 'haiku', label: 'haiku (alias)', note: 'latest Haiku', provider: 'anthropic' },
];
export function modelLabel(id: string): string { return CLAUDE_MODELS.find((m) => m.id === id)?.label ?? id; }
