import { describe, expect, it } from 'vitest';
import { TELEMETRY_TEXT, validateAccount } from '../../shell/src/settings/model.js';
import { updateAccount } from '../../shell/src/settings/data.js';
import { fakeHttp } from '../workspace/helpers.js';

describe('account (acceptance 7)', () => {
  it('a name is 1 to 40 characters after trimming; a locale is a language tag', () => { expect(validateAccount({ display_name: 'Ada' })).toBeUndefined(); expect(validateAccount({ display_name: 'x'.repeat(40) })).toBeUndefined(); expect(validateAccount({ display_name: 'x'.repeat(41) })).toMatch(/1 to 40/); expect(validateAccount({ display_name: '   ' })).toMatch(/1 to 40/); for (const ok of ['en', 'de-CH', 'zh-Hant-TW', 'fil']) expect(validateAccount({ locale: ok }), ok).toBeUndefined(); for (const bad of ['', 'english!', 'e', 'en_US', 'x'.repeat(30)]) expect(validateAccount({ locale: bad }), bad).toBeTruthy(); });
  it('telemetry sends only that field, and the page says in words what is collected and that it is off by default', async () => { const http = fakeHttp(() => ({})); await updateAccount(http, { telemetry: true }); expect(http.calls[0]).toMatchObject({ op: 'updateMe', args: { body: { telemetry: true } } }); expect(TELEMETRY_TEXT).toMatch(/off by default/); expect(TELEMETRY_TEXT).toMatch(/never includes your prompts, files, paths or names/); });
});
