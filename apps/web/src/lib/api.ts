import { HTTP_OPERATIONS, createHttpClient, defaultUserAgent } from '@centcom/net';
import type { ShellEnv } from './env.js';
/** The API client for the shell. Sign-in (lane C082) supplies the token later; without one only public endpoints work. */
export function makeApi(env: ShellEnv, getAccessToken: () => Promise<string | undefined> = async () => undefined) { return createHttpClient({ baseUrl: env.apiBase, getAccessToken: async () => (await getAccessToken()) ?? '', userAgent: defaultUserAgent('web') }); }

type Loose = Record<string, unknown>;
interface Raw { call(op: string, args: Loose, o?: Loose): Promise<unknown>; listPage(op: string, args: Loose, o?: Loose): Promise<unknown>; paginate(op: string, args: Loose, o?: Loose): unknown }
/** The screens write one flat argument object, `{ id, cursor, body }`; the generated client wants `{ path, query, body }`. This sorts each key by what the operation's contract says it is, so the client no longer throws `path parameter "id" is missing`. Keys already inside `path` or `query` are kept. */
export function flatArgs(op: string, args: Loose): Loose {
  const spec = (HTTP_OPERATIONS as unknown as Record<string, { pathParams: readonly string[]; queryParams: readonly string[] } | undefined>)[op];
  if (!spec) return args;
  const path: Loose = { ...(args.path as Loose | undefined) }; const query: Loose = { ...(args.query as Loose | undefined) }; const rest: Loose = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'path' || k === 'query') continue;
    if (k === 'body') rest.body = v;
    else if (spec.pathParams.includes(k)) path[k] = v;
    else if (spec.queryParams.includes(k) && k !== 'cursor' && k !== 'limit') query[k] = v;
    else rest[k] = v; /* cursor and limit stay flat for listPage, which moves them into the query itself */
  }
  return { ...rest, ...(Object.keys(path).length ? { path } : {}), ...(Object.keys(query).length ? { query } : {}) };
}
/** The client the screens use: the real one behind `flatArgs`. */
export function pageHttp(api: unknown): Raw {
  const a = api as Raw;
  return { call: (op, args, o) => a.call(op, flatArgs(op, args), o), listPage: (op, args, o) => a.listPage(op, flatArgs(op, args), o), paginate: (op, args, o) => a.paginate(op, flatArgs(op, args), o) };
}
