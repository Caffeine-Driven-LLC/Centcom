# TypeScript in UI code

Strictness settings and what each catches, typing props, events, refs and
children, discriminated unions for UI state, generic components, the `any`
escape hatches and their replacements, typing API responses (codegen, zod
inference), utility types that earn their keep, and framework-specific
typing notes.

## Contents

1. Read tsconfig first
2. Strictness flags worth turning on
3. Typing props
4. Typing events, refs, and DOM
5. Discriminated unions for UI state
6. Generic components
7. The `any` escape hatches and their replacements
8. Typing API responses
9. Utility types that earn their keep
10. Framework notes
11. Anti-patterns with fixes

## 1. Read tsconfig first

```bash
cat tsconfig.json          # and any `extends` chain
grep -rn "@ts-ignore\|@ts-expect-error\|as any\|: any" src --include=*.ts --include=*.tsx | wc -l
```

Match the strictness you find; never loosen it to make your change
compile. If `strict` is off, your new code should still be written as if it
were on (explicit types where inference fails, no implicit any), so the
codebase can tighten later without rewriting your files. Note `paths`
aliases, `moduleResolution` (`bundler` for modern Vite/Next), `jsx`
(`react-jsx` vs `preserve`), `types` (e.g. `vite/client` for
`import.meta.env`), `verbatimModuleSyntax` (requires `import type`).

## 2. Strictness flags worth turning on

| Flag | Catches | Example |
|---|---|---|
| `strict` | Enables the family below | |
| `strictNullChecks` | Using a possibly-undefined value | `user.name` when `user` may be `null` |
| `noImplicitAny` | Parameters and variables with inferred `any` | `function f(x)` |
| `noUncheckedIndexedAccess` | Array/record access assumed defined | `items[0].id` → `items[0]` is `T \| undefined`; forces the empty-list check |
| `exactOptionalPropertyTypes` | Passing `undefined` explicitly to an optional prop that does not accept it | `<Comp size={undefined} />` |
| `noFallthroughCasesInSwitch` | Missing `break` | |
| `noImplicitReturns` | Code paths that return nothing | Reducer branch forgot to return state |
| `noUnusedLocals` / `noUnusedParameters` | Dead code | Often handled by ESLint instead |
| `useUnknownInCatchVariables` | `catch (e)` typed `unknown`, not `any` | Forces `e instanceof Error` checks |
| `verbatimModuleSyntax` | Type-only imports must be `import type` | Avoids runtime import of types with some bundlers |
| `isolatedModules` | Each file transpilable alone | Required for esbuild/SWC |
| `allowJs: false` / `checkJs` | JS files in a TS project | |

New projects: `strict: true`, `noUncheckedIndexedAccess: true`,
`exactOptionalPropertyTypes` if the team can live with it, `verbatimModuleSyntax`.
Framework presets (`@tsconfig/next`, `@vue/tsconfig`, `@sveltejs/kit`'s
generated config, Angular CLI's) are good bases.

Type-check command per stack: `tsc --noEmit` (React/Next/Solid), `vue-tsc
--noEmit` (Vue/Nuxt: `nuxi typecheck`), `svelte-check` (Svelte), `ng build`
or `tsc -p tsconfig.app.json` (Angular; enable `strictTemplates` in
`angularCompilerOptions`).

## 3. Typing props

```tsx
// Extend the native element so consumers get every attribute, correctly typed, and `ref` in React 19
type ButtonProps = React.ComponentPropsWithoutRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

// Discriminated props: a link-or-button that forbids impossible combos
type Clickable =
  | ({ as: 'button' } & React.ComponentPropsWithoutRef<'button'>)
  | ({ as: 'a'; href: string } & React.ComponentPropsWithoutRef<'a'>)

// Required-together props
type IconButtonProps = ButtonProps & ({ 'aria-label': string; children?: never } | { 'aria-label'?: string; children: React.ReactNode })

// children and render props
type ListProps<T> = { items: T[]; renderItem: (item: T, index: number) => React.ReactNode; empty?: React.ReactNode }
```

Rules: `interface` or `type` per the repo's convention (types compose
better with unions; interfaces merge and show better in errors); unions
over booleans for variants; mark truly optional props `?` and give the
component a default rather than handling `undefined` everywhere; do not
export a props type named `Props` from twenty files (name it
`ButtonProps`); `React.ReactNode` for children, `React.ReactElement` only
when you will clone or inspect it; avoid `React.FC` (no benefit since 18,
and it used to imply `children`); prefer `ComponentPropsWithoutRef<'x'>`
over `HTMLAttributes<HTMLXElement>` (includes element-specific attributes
like `type` on button).

Vue: `defineProps<{ ... }>()` with `withDefaults`; `defineEmits<{ change:
[value: string] }>()`; `defineSlots` for typed slots; `vue-tsc` checks
templates. Svelte 5: `let { a, b = 1 }: Props = $props()`; `Snippet<[Arg]>`
for typed snippets; `HTMLButtonAttributes` from `svelte/elements` to extend
natives. Angular: `input<T>()`/`input.required<T>()` give typed inputs;
`strictTemplates` makes bindings type-check.

## 4. Typing events, refs, and DOM

```tsx
function onChange(e: React.ChangeEvent<HTMLInputElement>) { setValue(e.currentTarget.value) }     // currentTarget is typed; target is EventTarget
function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) { if (e.key === 'Escape') close() }  // e.key, not e.keyCode
function onSubmit(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); const fd = new FormData(e.currentTarget) }

// Handler props: use the element's handler type, or a domain callback
type Props = { onSelect: (id: string) => void; onClick?: React.MouseEventHandler<HTMLButtonElement> }

// Refs
const inputRef = useRef<HTMLInputElement>(null)          // DOM ref: null-initialized, read-only .current in React 18 typings
const timer = useRef<ReturnType<typeof setTimeout>>()    // mutable value ref; ReturnType avoids Node vs DOM number mismatch
inputRef.current?.focus()

// Narrowing event targets from delegated listeners
container.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')
  if (!btn) return
  btn.dataset.action  // string | undefined
})
```

`as HTMLElement` on `e.target` is one of the few justified casts (the
DOM API types it as `EventTarget`). Prefer `e.currentTarget` (typed) when
you attached the listener to the element you care about. `querySelector<HTMLButtonElement>(...)`
accepts a generic; `getElementById` does not (cast or `instanceof` check).

## 5. Discriminated unions for UI state

Flags that can disagree are a bug class; a tagged union makes the compiler
enforce the states.

```ts
// Async
type Async<T, E = Error> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: E }

function render(state: Async<User[]>) {
  switch (state.status) {
    case 'idle': return null
    case 'loading': return <Spinner />
    case 'error': return <ErrorView error={state.error} />          // error is typed here
    case 'success': return <UserList users={state.data} />          // data is typed here
    default: return assertNever(state)                              // exhaustiveness: adding a status fails to compile
  }
}
export function assertNever(x: never): never { throw new Error(`Unexpected: ${JSON.stringify(x)}`) }

// Component variants with different required data
type Notification =
  | { kind: 'info'; message: string }
  | { kind: 'action'; message: string; actionLabel: string; onAction: () => void }
  | { kind: 'progress'; message: string; percent: number }

// Reducer actions
type Action = { type: 'add'; item: Item } | { type: 'remove'; id: string } | { type: 'clear' }
```

Use `satisfies` to check a literal against a type while keeping its narrow
inferred type: `const routes = { home: '/', user: '/users/:id' } satisfies Record<string, string>`.
`as const` for literal tuples and objects you will derive unions from:
`const SIZES = ['sm', 'md', 'lg'] as const; type Size = typeof SIZES[number]`.

## 6. Generic components

```tsx
// React: generic function component; the generic is inferred from `items`
export function Select<T extends { id: string }>({ items, value, onChange, getLabel }: {
  items: readonly T[]; value: T['id'] | null; onChange: (item: T) => void; getLabel: (item: T) => string
}) { ... }
<Select items={users} value={selectedId} onChange={u => setUser(u)} getLabel={u => u.name} />   // u: User

// Constrain with keyof for column definitions
type Column<Row> = { key: keyof Row & string; header: string; render?: (value: Row[keyof Row], row: Row) => React.ReactNode }
export function Table<Row extends object>({ rows, columns, getRowId }: { rows: Row[]; columns: Column<Row>[]; getRowId: (r: Row) => string }) { ... }
```

In `.tsx` files, generic arrow functions need `<T,>` to disambiguate from
JSX; prefer `function` declarations. `forwardRef` does not preserve
generics (React 18); use a cast helper or React 19's plain `ref` prop.
Vue: `<script setup lang="ts" generic="T extends { id: string }">`.
Svelte 5: `<script lang="ts" generics="T extends { id: string }">`.
Angular: generic directives/components are rare; type the data via
`input<T>()` on a generic class and let inference handle `*ngFor`/`@for`
with `strictTemplates`.

## 7. The `any` escape hatches and their replacements

| Escape hatch | Replace with |
|---|---|
| `: any` on a parameter because the shape is unknown | `unknown` + narrowing (`typeof`, `in`, `instanceof`, a type guard, a schema parse) |
| `as any` to silence a prop error | Fix the prop type; if a library's types are wrong, a narrow `as unknown as X` with a comment, or a module augmentation |
| `// @ts-ignore` | `// @ts-expect-error <reason>` (fails when the error disappears), and only with a reason |
| `const data: any = await res.json()` | `const data = schema.parse(await res.json())` or a generated type |
| `Record<string, any>` | `Record<string, unknown>` or the actual shape |
| `Function` as a type | `(...args: Args) => Return` |
| `object` for "some object" | A specific type, `Record<string, unknown>`, or a generic |
| `!` non-null assertions in render | Narrow with a guard, early return, or make the state impossible via a union |
| `catch (e: any)` | `catch (e) { if (e instanceof HttpError) ... else throw e }` |
| `JSON.parse(x) as T` | Parse with a schema; `as` is a lie the runtime will catch later |
| `useState<any>()` / `ref<any>()` | Explicit generic or an initial value that infers |
| Props typed `any` in `.vue`/`.svelte` to make templates quiet | Real types; fix the template |

`unknown` forces you to prove the shape before use; that proof is exactly
the validation your boundary needs anyway.

Type guards and assertion functions:

```ts
function isHttpError(e: unknown): e is HttpError { return e instanceof HttpError }
function assertDefined<T>(v: T, msg = 'Expected value'): asserts v is NonNullable<T> { if (v == null) throw new Error(msg) }
```

## 8. Typing API responses

The boundary between network and code is where types stop being true.
Three honest approaches, in order of preference:

1. **Generate from the server's schema.** OpenAPI: `openapi-typescript`
   (types) + `openapi-fetch` (typed client), or `orval`/`hey-api` (client
   + TanStack hooks). GraphQL: `graphql-codegen` with the `client` preset
   (`TypedDocumentNode`, fragment masking). tRPC: types flow end to end
   with no codegen. Regenerate in CI; fail if the committed output is
   stale.

```ts
import createClient from 'openapi-fetch'
import type { paths } from '@/api/schema'          // generated
export const api = createClient<paths>({ baseUrl: '/api' })
const { data, error } = await api.GET('/orders/{id}', { params: { path: { id } } })   // data: Order | undefined, error typed from 4xx schemas
```

2. **Runtime schema + inferred type** (zod/valibot/arktype) when there is
   no machine-readable server schema. You get validation and types from one
   definition, and bad data fails loudly at the boundary, not deep in a
   render.

```ts
const User = z.object({ id: z.string().uuid(), name: z.string(), email: z.string().email(), createdAt: z.coerce.date(), role: z.enum(['admin', 'member']) })
export type User = z.infer<typeof User>
export const getUser = (id: string) => http.get(`/users/${id}`).then(User.parse)
```

Parsing cost is real for large payloads (thousands of items): parse once
at the boundary in the query function, not per render; `z.array(Item)` on
a 10k list is fine, `deep` schemas on 100k rows warrant sampling or a
generated type with a trust boundary comment.

3. **Hand-written interface + `as`** when the API is stable and trusted
   (your own monolith, same deploy). Least safe; document the trust.

Never let a response type be `any` and never spread raw response objects
into component props (`{...data}`) because unknown fields leak to the DOM
and the type lies about what is there.

Dates: JSON has none. Decide at the boundary: keep ISO strings and format
with `Intl` where displayed, or `z.coerce.date()` into `Date` objects
(watch serialization across RSC/SSR boundaries; Next and SvelteKit handle
`Date`, plain `JSON.stringify` does not round-trip).

## 9. Utility types that earn their keep

```ts
type Props = React.ComponentProps<typeof Button>                 // props of an existing component
type Variant = NonNullable<Props['variant']>                      // extract a union from a prop
type Row = Awaited<ReturnType<typeof getRows>>[number]            // element type of an async function's array result
type Draft = Partial<Pick<Order, 'notes' | 'shipping'>>           // narrow editable subset
type Strict<T> = { [K in keyof T]-?: Exclude<T[K], undefined> }  // make all required
type Prettify<T> = { [K in keyof T]: T[K] } & {}                 // flatten intersections for readable hover types
type ValueOf<T> = T[keyof T]
type DeepReadonly<T> = { readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K] }

// Template literal types for token names and routes
type Space = `space-${1 | 2 | 3 | 4 | 6 | 8}`
type Route = `/users/${string}` | '/' | '/settings'
```

Prefer deriving types from values (`typeof config`, `keyof`, `as const`)
over duplicating them; a union hand-copied from an array will drift.
`satisfies` validates without widening. Keep conditional/mapped type
wizardry in one `types/` utility file with examples; clever types in
component files make hover tooltips unreadable.

## 10. Framework notes

- **React**: `@types/react` 19 removes implicit `children`, types `ref` as
  a prop, `useRef` requires an argument. `JSX.Element` → `React.JSX.Element`.
  `React.PropsWithChildren<P>` when you need children. Server components
  can be `async` functions returning `Promise<JSX.Element>`.
- **Next**: `PageProps` with `params: Promise<{...}>` in 15; `typedRoutes`
  experimental flag types `<Link href>`; `Metadata` type for exports;
  route handler `NextRequest`/`NextResponse`.
- **Vue**: `vue-tsc` is the type-checker; `defineComponent` for non-SFC;
  `PropType<T>` in Options API; `InstanceType<typeof Comp>` for template
  refs; `Ref<T>`, `ComputedRef<T>`, `MaybeRefOrGetter<T>` in composables.
- **Svelte/SvelteKit**: `./$types` generated per route (`PageData`,
  `PageServerLoad`, `Actions`, `LayoutData`); `App.Locals`, `App.PageData`
  in `app.d.ts`; `svelte-check` runs the checks; `HTMLAttributes<HTMLDivElement>`
  from `svelte/elements`.
- **Angular**: `strictTemplates`, `strictInputAccessModifiers`; typed
  reactive forms (`FormGroup<{ email: FormControl<string> }>`), `nonNullable`
  builder; `Signal<T>`, `WritableSignal<T>`, `InputSignal<T>`.
- **Solid**: `Component<Props>`, `JSX.Element`, `Accessor<T>`/`Setter<T>`;
  do not destructure props (breaks reactivity; `splitProps`/`mergeProps`).
- **Env vars**: declare `ImportMetaEnv` (Vite) or `ProcessEnv` (Next) in a
  `.d.ts` so `import.meta.env.VITE_API` is typed; validate at startup with
  a schema (`t3-env` pattern) so a missing var fails the build, not a user.

## 11. Anti-patterns with fixes

| Anti-pattern | Fix |
|---|---|
| `any` on API data | Codegen or schema inference |
| `as` casts to make props fit | Fix the type at the source |
| `@ts-ignore` | `@ts-expect-error` with reason, or fix |
| Boolean flag props that can conflict | Discriminated union props |
| `isLoading`, `isError`, `data?` as separate fields | `Async<T>` union |
| `React.FC<Props>` with implicit children | Function with explicit `children?: React.ReactNode` |
| `HTMLAttributes<HTMLButtonElement>` | `ComponentPropsWithoutRef<'button'>` |
| `e.target.value` on a generic `Event` | `e.currentTarget` with the typed element, or cast `e.target as HTMLInputElement` |
| `useRef<HTMLDivElement>()` without `null` (React 18) | `useRef<HTMLDivElement>(null)` |
| Duplicated string union next to the array of the same values | `as const` + `typeof arr[number]` |
| Export `type Props` from every file | Named `XProps` |
| `Object.keys(obj) as (keyof T)[]` sprinkled around | A typed `keys()` helper, once |
| `enum` for UI variants | String literal unions (erasable, serializable, no runtime object) unless the repo uses enums |
| `!` after every optional access | Narrow once, early return, or restructure state |
| Loosening `tsconfig` to make a change compile | Fix the code |
| `interface Props { onClick: Function }` | `() => void` or the handler type |
