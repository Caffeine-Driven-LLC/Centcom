import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const web = resolve(__dirname, '..');
it('index.html turns Zod\'s eval probe off before the app loads, which the page policy would report as a violation', () => {
  const html = readFileSync(resolve(web, 'index.html'), 'utf8');
  expect(html.indexOf('<script src="./zod-jitless.js">')).toBeGreaterThan(-1);
  expect(html.indexOf('zod-jitless.js')).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
  expect(readFileSync(resolve(web, 'public/zod-jitless.js'), 'utf8')).toContain('jitless: true');
});
