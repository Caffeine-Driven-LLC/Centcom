import { Buffer } from 'buffer';
/** The net library uses Buffer for a few length checks and decoding; the browser gets the same class. */
if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') (globalThis as { Buffer?: unknown }).Buffer = Buffer;
