import { defineCentcomConfig } from '../../../src/vitest/index.js';
export default defineCentcomConfig({ test: { include: ['test/**/*.spec.ts'], coverage: { reportsDirectory: process.env.COVERAGE_OUT ?? './coverage' } } });
