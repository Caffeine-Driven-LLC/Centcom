import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileKeychain, keychainDirFromEnv } from '../../src/index.js';

describe('the development file keychain', () => {
  it('keeps a value between two instances, in a 0600 file inside a 0700 folder, and forgets it on delete', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'kc-')), 'keys'); const a = fileKeychain(dir);
    expect(await a.get('refresh:localhost:3000')).toBeUndefined(); await a.set('refresh:localhost:3000', '{"v":1}');
    expect(await fileKeychain(dir).get('refresh:localhost:3000')).toBe('{"v":1}'); const files = readdirSync(dir); expect(files).toHaveLength(1); expect(files[0]).not.toContain('refresh');
    expect(statSync(join(dir, files[0]!)).mode & 0o777).toBe(0o600); expect(statSync(dir).mode & 0o777).toBe(0o700);
    await a.delete('refresh:localhost:3000'); expect(await a.get('refresh:localhost:3000')).toBeUndefined(); await a.delete('refresh:localhost:3000');
  });
  it('is chosen only by CENTCOM_KEYCHAIN=file:<folder>', () => {
    expect(keychainDirFromEnv({ CENTCOM_KEYCHAIN: 'file:/tmp/x' })).toBe('/tmp/x'); expect(keychainDirFromEnv({ CENTCOM_KEYCHAIN: 'memory' })).toBeUndefined();
    expect(keychainDirFromEnv({ CENTCOM_KEYCHAIN: 'file:' })).toBeUndefined(); expect(keychainDirFromEnv({})).toBeUndefined();
  });
});
