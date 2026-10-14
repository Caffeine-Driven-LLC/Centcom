import { describe, expect, it } from 'vitest';
import { newQueueId } from '../../src/session/use-session.js';

/** The shape CT-WS-QUEUE gives a queue item id (contracts/schemas/events.schema.json). */
const QUEUE_ID = /^que_[0-9A-HJKMNP-TV-Z]{26}$/;
describe('the id a browser guest gives a queue item', () => {
  it('always has the shape the contract requires (the old generator produced a valid id in none of ten thousand tries)', () => {
    for (let i = 0; i < 2000; i++) expect(newQueueId(), String(i)).toMatch(QUEUE_ID);
  });
  it('is valid for any time and any random bytes, and different each time', () => {
    for (const now of [0, 1, 31, 32, 1_760_000_000_000, 2 ** 45]) expect(newQueueId(now, (n) => new Uint8Array(n).fill(255))).toMatch(QUEUE_ID);
    expect(new Set(Array.from({ length: 200 }, () => newQueueId())).size).toBe(200);
  });
});
