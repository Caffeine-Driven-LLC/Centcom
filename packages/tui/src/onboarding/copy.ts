/** Onboarding copy (DESIGN §13.3): one idea per screen, under 20 words a sentence. */
export const DOCS_URL = 'https://centcom.dev/docs';
export const FIRST_RUN = { sentence: "Hi, I'm Cento. I run your coding agents and keep a log of their work.", command: 'centcom init', hint: 'or just type what you want done', more: `More: ${DOCS_URL}`, key: 'Press any key to start.' } as const;
export type EmptyKind = 'no-sessions' | 'no-results' | 'no-team';
export function emptyText(kind: EmptyKind, query?: string): string {
  switch (kind) {
    case 'no-sessions': return 'No missions yet. Start one and Cento will keep the log.';
    case 'no-results': return `Nothing matches "${query ?? ''}". Try fewer words or check the spelling.`;
    case 'no-team': return "It's just you in here. Invite someone and Cento will make room.";
  }
}
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
