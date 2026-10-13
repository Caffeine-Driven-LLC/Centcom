/** Every string of the who-pays UI, one key each. The subscription notice needs a human sign-off before release (CT-PROVIDER 8). */
export const PROVIDER_NAMES = { anthropic: 'Anthropic', openai: 'OpenAI', other: 'the provider' } as const;
export const providerName = (p: string): string => (PROVIDER_NAMES as Record<string, string>)[p] ?? PROVIDER_NAMES.other;
export const MESSAGES = {
  'provider.runs_on': (o: { name: string; provider: string }) => `runs on ${o.name} · ${o.provider}`,
  'provider.guest_notice': (o: { host: string }) => `Your prompt will run on ${o.host}'s account`,
  'provider.guests_spend': (o: { count: number; provider: string }) => `${o.count} ${o.count === 1 ? 'guest' : 'guests'} can spend your ${providerName(o.provider)} usage`,
  'provider.guests_paused': () => 'Guests paused',
  'provider.pause_hint': () => '[p] pause',
  'provider.resume_hint': () => '[r] resume',
  'provider.pause': () => 'Pause guests',
  'provider.pause_failed': () => 'Could not pause guests. New guest prompts are held on this computer anyway.',
  'provider.blocked.cp_subscription': () => 'Shared sessions on a subscription login are off. Use an API-key login or run this agent on your own branch.',
  'provider.blocked.method_disabled': () => 'This provider method is switched off for now. Running sessions finish; new ones cannot start.',
  'provider.cp_subscription.title': (o: { engine: string }) => `Share your ${o.engine} login in this command post?`,
  'provider.cp_subscription.notice': (o: { engine: string }) => `Guests' prompts will run through YOUR ${o.engine} login. Your plan's limits and the provider's terms apply to that use, and written confirmation from the provider is still pending. Only continue if you accept that.`,
  'provider.cp_subscription.keys': () => '[y] yes, share it   [n] cancel',
} as const;
export type MessageKey = keyof typeof MESSAGES;
