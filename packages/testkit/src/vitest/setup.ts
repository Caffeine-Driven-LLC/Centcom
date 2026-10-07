import { afterEach, beforeEach, expect } from 'vitest';
import { installConsoleGuard, installNetworkGuard, resetConsoleGuard, setCurrentTest } from './guards.js';
process.env.TZ = 'UTC'; process.env.LANG ??= 'en_US.UTF-8'; installNetworkGuard(); installConsoleGuard();
beforeEach(() => { setCurrentTest(expect.getState().currentTestName ?? ''); resetConsoleGuard(); });
afterEach(() => setCurrentTest(''));
