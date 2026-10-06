/** `centcom webhooks ...`: manage outgoing webhooks and check their signatures. Exit codes: 0 ok, 1 failure, 2 sign-in needed, 3 a signature did not verify. */
import { runCreate } from './create.js';
import { runDeliveries, runRedeliver } from './deliveries.js';
import { runList, runShow } from './list.js';
import { runDelete, runRotate, runTest, runUpdate } from './manage.js';
import { usage, type WebhookDeps } from './common.js';
import { runVerify } from './verify.js';

export type { WebhookDeps, WebhookIo } from './common.js';
export { WEBHOOK_EVENTS } from './events.js';
export { verifyWebhookSignature, parseSignatureHeader, signWebhook } from './signature.js';
export const SUBCOMMANDS: Record<string, (argv: string[], d: WebhookDeps) => Promise<number>> = { list: runList, show: runShow, create: runCreate, update: runUpdate, 'rotate-secret': runRotate, delete: runDelete, test: runTest, deliveries: runDeliveries, redeliver: runRedeliver, verify: runVerify };
export const HELP = ['Usage: centcom webhooks <command>', '  list [--workspace wsp_..] [--json]', '  show <whk_id>', '  create --url <https-url> --event <type> [--event ...] [--disabled] [--show-secret]', '  update <whk_id> [--url] [--event ...] [--enable|--disable]', '  rotate-secret <whk_id> [--show-secret]', '  delete <whk_id> [--yes]', '  test <whk_id>', '  deliveries <whk_id> [--limit n] [--json]', '  redeliver <whk_id> <dlv_id>', '  verify --secret-stdin --signature <value> --body-file <path> [--tolerance 300]'];
export async function runWebhooks(argv: string[], d: WebhookDeps): Promise<number> {
  const [sub, ...rest] = argv; const run = sub ? SUBCOMMANDS[sub] : undefined; if (!run) { for (const l of HELP) d.io.err(l); return sub && sub !== '--help' && sub !== 'help' ? 1 : sub ? 0 : 1; } return run(rest, d);
}
/** Registers `webhooks` with a command router that maps a name to a handler. */
export function registerWebhookCommands(program: { command(name: string, run: (argv: string[]) => Promise<number>): void }, deps: WebhookDeps): void { program.command('webhooks', (argv) => runWebhooks(argv, deps)); }
