/** The account commands (lane C053): `centcom login`, `logout`, `whoami`, `devices`. The logic is here and in the files next to it, tested with fakes; cli.ts wires the real keychain, network and terminal.
 *  Must not: own device-flow, keychain or refresh logic (C052) or HTTP retry (C051). */
import { runDevices } from './devices.js';
import { runLogin } from './login.js';
import { runLogout } from './logout.js';
import { runWhoami } from './whoami.js';
import type { AccountDeps, CommandBuilder } from './common.js';

export type { AccountDeps, AccountIO, CommandBuilder } from './common.js';
export { EXIT, MSG } from './messages.js';
export { createBrowserOpener, isOpenableUrl, openerCommand } from './browser.js';
export { runDevices, runLogin, runLogout, runWhoami };

/** The command names this module registers. */
export const ACCOUNT_COMMANDS = ['login', 'logout', 'whoami', 'devices'] as const;

/** Register `login`, `logout`, `whoami` and `devices` on a command router. */
export function registerAccountCommands(program: CommandBuilder, deps: AccountDeps): void {
  program.command('login', (argv) => runLogin(argv, deps));
  program.command('logout', (argv) => runLogout(argv, deps));
  program.command('whoami', (argv) => runWhoami(argv, deps));
  program.command('devices', (argv) => runDevices(argv, deps));
}

/** A CommandBuilder that keeps the commands in a map, for the CLI entry and tests. */
export function createCommandRegistry(): CommandBuilder & { run(name: string, argv: string[]): Promise<number> | undefined; names(): string[] } {
  const cmds = new Map<string, (argv: string[]) => Promise<number>>();
  return { command: (name, run) => { cmds.set(name, run); }, run: (name, argv) => cmds.get(name)?.(argv), names: () => [...cmds.keys()] };
}
