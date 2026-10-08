/* The page policy has no unsafe-eval. Zod probes for `new Function` when it loads and swallows the failure, but the browser still reports a policy violation for it. This runs before the app's modules and tells Zod not to probe. */
globalThis.__zod_globalConfig = Object.assign(globalThis.__zod_globalConfig || {}, { jitless: true });
