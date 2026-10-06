/** What can go wrong with an update. None of them carries a path, a URL with a token, or a key. */
export class UpdateError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'UpdateError'; } }
export class HashMismatchError extends UpdateError { constructor() { super('hash_mismatch', 'The downloaded file is not the one that was published (its checksum differs), so it was deleted and nothing was changed.'); this.name = 'HashMismatchError'; } }
export class SignatureError extends UpdateError { constructor(why = 'The download is not signed by a key Centcom trusts, so it was deleted and nothing was changed.') { super('bad_signature', why); this.name = 'SignatureError'; } }
export class NotVerifiedError extends UpdateError { constructor() { super('not_verified', 'This update has not been checked yet, so it was not installed.'); this.name = 'NotVerifiedError'; } }
export class TooLargeError extends UpdateError { constructor() { super('too_large', 'The download is larger than the release says it is, so it was stopped and deleted.'); this.name = 'TooLargeError'; } }
export class ManagedInstallError extends UpdateError { constructor(readonly command: string) { super('managed_install', `Centcom was installed with a package manager. Update it with: ${command}`); this.name = 'ManagedInstallError'; } }
export class NoUpdateError extends UpdateError { constructor(why: string) { super('no_update', why); this.name = 'NoUpdateError'; } }
