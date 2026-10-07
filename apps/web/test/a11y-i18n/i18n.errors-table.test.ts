import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { errorText } from '../../src/i18n/errors.js';
import { STATE_COUNT, stateText } from '../../src/i18n/states.js';
import { STATE_NAMES } from '@centcom/states';

const errors = JSON.parse(readFileSync(new URL('../../../../contracts/errors.json', import.meta.url), 'utf8')) as { errors: { code: string; status: number; title: string }[] };
describe('error words (acceptance 3)', () => {
  it('every code of the error registry has its own message, never text from the server', () => { expect(errors.errors.length).toBeGreaterThan(70); for (const e of errors.errors) { const t = errorText(e.code, e.status); expect(t, e.code).not.toMatch(/^error\./); expect(t.length, e.code).toBeGreaterThan(3); expect(t, e.code).toMatch(/\.$/); } });
  it('an unknown code gets the text of its status class', () => { const by = (s: number) => errorText('code_from_the_future', s); expect(by(400)).toBe('That request was not valid.'); expect(by(401)).toBe('Sign in to continue.'); expect(by(403)).toBe('You are not allowed to do that.'); expect(by(404)).toBe('That was not found.'); expect(by(409)).toBe('That conflicts with something that changed.'); expect(by(429)).toBe('Too many requests. Try again in a moment.'); expect(by(500)).toBe('Centcom had a problem. Try again in a moment.'); expect(by(503)).toBe(by(500)); expect(errorText(undefined, undefined)).toBe('Something went wrong.'); expect(by(418)).toBe('Something went wrong.'); });
});
describe('state text (acceptance 4)', () => {
  it('every state of the state map has a sentence (the map now has 64 names; the card says 61)', () => { expect(STATE_COUNT).toBe(STATE_NAMES.length); expect(STATE_COUNT).toBeGreaterThanOrEqual(61); for (const s of STATE_NAMES) { const t = stateText(s); expect(t, s).not.toMatch(/^state\./); expect(t.length, s).toBeGreaterThan(3); } });
  it('counts read naturally, and an unknown state is "Cento is working"', () => { expect(stateText('editing-file', { count: 3 })).toBe('Cento is editing 3 files'); expect(stateText('editing-file', { count: 1 })).toBe('Cento is editing a file'); expect(stateText('state-from-the-future')).toBe('Cento is working'); expect(stateText('')).toBe('Cento is working'); });
});
