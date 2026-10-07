/** The engine and its libsodium are fetched only when someone opens a session page. */
export const loadEngine = (): Promise<typeof import('./engine.js')> => import('./engine.js');
/** Tests swap the engine for a fake. */
let current: () => Promise<typeof import('./engine.js')> = loadEngine; export const setSessionLoader = (f: (() => Promise<typeof import('./engine.js')>) | undefined): void => { current = f ?? loadEngine; }; export const sessionLoader = (): (() => Promise<typeof import('./engine.js')>) => current;
