/** Every user-facing line of `centcom login|logout|whoami|devices`, and the exit codes. One table, so wording is reviewed in one place.
 *  Must not: take a token, a device code, a refresh token or an API key as an argument. The only credential-like value ever shown is the short user code. */

/** 0 ok, 1 failure, 2 not signed in (or the sign-in ended). */
export const EXIT = { ok: 0, failure: 1, authRequired: 2 } as const;

const PLAN_NAMES: Record<string, string> = { free: 'Free', pro: 'Pro', team: 'Team' };
export const planName = (p: string): string => PLAN_NAMES[p] ?? p;

export const MSG = {
  usage: {
    login: 'Usage: centcom login [--no-browser] [--device-name <name>] [--api-key-stdin] [--json]',
    logout: 'Usage: centcom logout [--revoke-device]',
    whoami: 'Usage: centcom whoami [--json]',
    devices: 'Usage: centcom devices list [--json] | centcom devices revoke <dev_id> [--yes]',
    unknownFlag: (flag: string) => `Unknown option: ${flag}`,
    missingValue: (flag: string) => `${flag} needs a value.`,
    badDeviceId: 'That is not a device id. Device ids look like dev_01J... (see centcom devices list).',
  },
  login: {
    intro: 'To sign in, open this page and check that it shows the same code:',
    url: (url: string) => `  ${url}`,
    code: (code: string) => `  Code: ${code}`,
    manual: (uri: string, code: string) => `Or go to ${uri} and enter ${code}.`,
    browserOpened: 'Your browser should open now.',
    browserFailed: 'Could not open a browser. Open the link above yourself.',
    browserRefused: 'The sign-in link is not a secure (https) address, so it was not opened. Check it before you open it.',
    waiting: (minutes: number) => `Waiting for you to approve this device (the code expires in ${minutes} min). Press Ctrl-C to cancel.`,
    signedIn: (name: string, email: string, plan: string) => `Signed in as ${name} <${email}> on the ${planName(plan)} plan.`,
    signedInNoProfile: 'Signed in. (Your profile could not be loaded right now; try centcom whoami.)',
    denied: 'Sign-in was declined, so nothing changed. Run centcom login again if that was a mistake.',
    expired: 'The sign-in code expired before it was approved. Run centcom login again and approve it within 10 minutes.',
    cancelled: 'Sign-in cancelled. Nothing was saved.',
    notPersisted: 'This sign-in lasts only until this command ends, because the system keychain is not available.',
    apiKeyPrompt: 'Reading an API key from standard input...',
    apiKeyMissing: 'No API key on standard input. Pipe one in, for example: centcom login --api-key-stdin < key.txt',
    apiKeyMalformed: 'That is not a Centcom API key. Keys look like cen_live_ or cen_test_ followed by 32 letters and digits.',
    apiKeyRejected: 'The server did not accept that API key. It may have been revoked; nothing was saved.',
    apiKeySignedIn: (name: string, plan: string) => `Using an API key of ${name} (${planName(plan)} plan).`,
    apiKeyStoredUnverified: 'The API key was saved but could not be checked right now. Try centcom whoami later.',
  },
  logout: {
    signedOut: 'Signed out. Your sign-in was removed from this computer.',
    notSignedIn: 'You were not signed in.',
    revocationSkipped: 'The server could not be reached, so the sign-in was not ended there. It ends by itself after 30 days without use, or remove this device with centcom devices revoke on another computer.',
    deviceRevoked: 'This device was removed from your account.',
    deviceRevokeFailed: 'This device could not be removed from your account right now. Remove it later with centcom devices revoke.',
    apiKeyRemoved: 'The API key was removed from this computer. It still works elsewhere until you revoke it in your account.',
  },
  whoami: {
    user: (name: string, email: string, id: string) => `${name} <${email}> (${id})`,
    plan: (plan: string) => `Plan: ${planName(plan)}`,
    workspace: (name: string | null, id: string) => `Workspace: ${name ?? 'unnamed'} (${id})`,
    noWorkspace: 'Workspace: none',
    ent: (rev: number) => `Entitlement revision: ${rev}`,
    viaApiKey: 'Signed in with an API key.',
  },
  devices: {
    header: '  NAME                  PLATFORM  LAST SEEN         FINGERPRINT     ID',
    row: (current: boolean, name: string, platform: string, lastSeen: string, fp: string, id: string) => `${current ? '*' : ' '} ${name.padEnd(21).slice(0, 21)} ${platform.padEnd(9).slice(0, 9)} ${lastSeen.padEnd(17).slice(0, 17)} ${fp.padEnd(15)} ${id}`,
    legend: '* this device',
    never: 'never',
    empty: 'No devices are registered to your account yet.',
    confirm: (name: string, id: string) => `Remove ${name} (${id}) from your account? It is signed out at once.`,
    confirmCurrent: 'This is the device you are using now: removing it signs you out here.',
    needsYes: 'Removing a device needs confirmation. Run it again with --yes (not asking, because this is not an interactive terminal).',
    notRevoked: 'Nothing changed.',
    revoked: (id: string) => `Removed ${id} from your account.`,
    revokedCurrent: 'This device was removed from your account and you are signed out here.',
  },
  errors: {
    notSignedIn: 'You are not signed in. Run centcom login.',
    sessionEnded: 'Your sign-in ended. Run centcom login to sign in again.',
    offline: 'Cannot reach the Centcom server. Check your connection and try again. Local work is not affected.',
    keychain: 'The system keychain is not available.',
    unexpected: 'Something went wrong. Run it again with --debug for details in the log.',
    line: (title: string, hint?: string, ref?: string) => [title, hint, ref].filter(Boolean).join(' '),
  },
} as const;
