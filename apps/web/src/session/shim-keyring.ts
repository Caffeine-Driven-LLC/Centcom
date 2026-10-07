/** The system keychain does not exist in a browser; the session engine keeps keys in memory. */
export class Entry { constructor() { throw new Error('No system keychain in a browser.'); } }
