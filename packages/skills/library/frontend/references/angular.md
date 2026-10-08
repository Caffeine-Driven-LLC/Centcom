# Angular

Modern Angular (16 through 20): signals, standalone components, the
`inject()` function, RxJS discipline (where streams still earn their place
and where signals replace them), change detection with and without zones,
the new control flow and `@defer`, forms, routing with functional guards and
resolvers, and the legacy `NgModule` patterns you will meet in older
codebases.

## Contents

1. Detect: version, standalone or NgModule, zoneless
2. Standalone components and `inject()`
3. Signals: `signal`, `computed`, `effect`, `linkedSignal`, `resource`
4. Inputs, outputs, models, and content projection
5. RxJS discipline
6. Change detection
7. Control flow and `@defer`
8. Routing
9. Forms
10. HTTP and data
11. Testing hooks
12. Anti-patterns with fixes

## 1. Detect

```bash
grep -E '"@angular/core"' package.json
grep -rl "standalone: true\|standalone: false" src | head
grep -rl "@NgModule" src | wc -l
grep -rn "provideExperimentalZonelessChangeDetection\|provideZonelessChangeDetection" src
grep -rn "signal(\|computed(\|input(\|input.required" src --include=*.ts | wc -l
```

- 14-15: standalone components exist but opt-in. Signals absent (14) or
  developer preview (16).
- 16-17: signals stable-ish; `inject()`; `@if/@for` control flow (17);
  standalone default in CLI generators from 17.
- 18-19: `input()`, `output()`, `model()` signal APIs; zoneless experimental;
  `resource()` and `linkedSignal` (19); standalone is the default and
  `standalone: true` is implied.
- 20+: zoneless stable; `effect()` semantics finalized; style guide moves
  away from `.component.ts` suffixes (check what the repo does).

Match what the repo does. A `NgModule`-heavy codebase gets a new
`NgModule`-declared component unless the team is migrating; a signals
codebase gets signals, not a new `BehaviorSubject`.

## 2. Standalone components and `inject()`

```ts
import { Component, ChangeDetectionStrategy, inject, computed, input } from '@angular/core'
import { CurrencyPipe } from '@angular/common'
import { CartStore } from './cart.store'

@Component({
  selector: 'app-cart-summary',
  imports: [CurrencyPipe],                              // standalone: declare what the template uses
  changeDetection: ChangeDetectionStrategy.OnPush,      // always, in new components
  template: `
    <p>{{ store.count() }} items · {{ store.total() | currency }}</p>
    <button type="button" (click)="store.clear()" [disabled]="store.count() === 0">Clear</button>
  `,
})
export class CartSummaryComponent {
  protected readonly store = inject(CartStore)          // inject() over constructor params; works in functions too
}
```

`inject()` is callable in constructors, field initializers, and anything
run in an injection context (`runInInjectionContext`, route guards,
`provideX` factories). It is the preferred DI style because it composes
into plain functions.

Bootstrapping: `bootstrapApplication(AppComponent, { providers: [provideRouter(routes), provideHttpClient(withFetch(), withInterceptors([authInterceptor]))] })`.
Feature-level providers go on routes (`providers: []` in a `Route`) to
scope them.

## 3. Signals

```ts
import { signal, computed, effect, linkedSignal, resource } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class CartStore {
  private readonly _items = signal<CartItem[]>([])
  readonly items = this._items.asReadonly()                       // expose read-only
  readonly count = computed(() => this._items().reduce((n, i) => n + i.qty, 0))
  readonly total = computed(() => this._items().reduce((s, i) => s + i.qty * i.price, 0))

  add(item: CartItem) {
    this._items.update(items => {
      const i = items.findIndex(x => x.productId === item.productId)
      return i === -1 ? [...items, item] : items.map((x, idx) => idx === i ? { ...x, qty: x.qty + item.qty } : x)
    })
  }
  clear() { this._items.set([]) }
}
```

Rules:

- `set`/`update` replace the value; signals use `Object.is` equality, so
  mutate-then-set does nothing. Produce new objects/arrays.
- `computed` is lazy, memoized, and must be pure. No side effects, no
  writing signals.
- `effect()` is for the outside world: logging, localStorage, syncing a
  non-Angular widget, `document.title`. It is not for deriving state (use
  `computed`) or reacting to inputs to set other state (use `computed` or
  `linkedSignal`). Writing signals inside `effect` is allowed since v19 but
  almost always indicates a missing `computed`. Effects run in an injection
  context (constructor/field) or with `{ injector }`.
- `untracked(() => x())` to read without creating a dependency.
- `linkedSignal(() => source())` for state that resets from a source but
  can be locally overridden (selected item that resets when the list
  changes).
- `resource({ request: () => ({ id: this.id() }), loader: ({ request, abortSignal }) => fetch(...) })`
  (v19+, experimental into 20) models async data as signals with
  `value()`, `status()`, `error()`, `isLoading()`; `rxResource` for
  observable loaders; `httpResource` (v19.2+) for plain GETs.

Signal-based inputs replace `@Input()`:

```ts
export class ProductCardComponent {
  readonly product = input.required<Product>()
  readonly compact = input(false, { transform: booleanAttribute })
  readonly selected = output<Product>()                      // replaces @Output() EventEmitter
  readonly quantity = model(1)                               // two-way: [(quantity)]="qty"
  protected readonly priceLabel = computed(() => formatPrice(this.product().price))
}
```

Where a signal-based codebase meets an RxJS one: `toSignal(obs$, { initialValue })`
and `toObservable(sig)` from `@angular/core/rxjs-interop`. `toSignal`
subscribes immediately and unsubscribes on destroy; do not call it in
methods, only in field initializers/constructor.

## 4. Inputs, outputs, models, and content projection

- Prefer `input()`/`output()`/`model()` in 17.1+; `@Input()`/`@Output()` in
  older code or where the repo has not migrated.
- Required inputs: `input.required<T>()`. Avoid `!` definite assignment on
  decorator inputs.
- Content projection: `<ng-content>` and `<ng-content select="[header]">`
  for composition; `@ContentChild`/`contentChild()` signal queries for
  compound components. `ng-template` + `ngTemplateOutlet` for render-prop
  style customization (row templates in a table).
- `host: { 'class': '...', '[attr.aria-expanded]': 'open()' }` in the
  decorator over `@HostBinding` for new code (style guide direction).

## 5. RxJS discipline

Signals handle synchronous derived state. RxJS still wins for event
streams over time: typeahead (`debounceTime`, `distinctUntilChanged`,
`switchMap`), websockets, polling with backoff, combining multiple async
sources with ordering guarantees, cancellation semantics.

```ts
readonly query = signal('')
readonly results = toSignal(
  toObservable(this.query).pipe(
    debounceTime(300),
    distinctUntilChanged(),
    switchMap(q => q.length < 2 ? of([]) : this.api.search(q).pipe(catchError(() => of([])))),
  ),
  { initialValue: [] as Result[] },
)
```

Rules:

- Never subscribe in a component without a disposal plan. Options:
  `toSignal`, `async` pipe in the template, `takeUntilDestroyed()` (inject
  `DestroyRef` outside constructor), or a `resource`. Hand-managed
  `Subscription` arrays are a smell.
- `switchMap` for "latest wins" (search, navigation-dependent fetch),
  `exhaustMap` for "ignore while busy" (submit buttons), `concatMap` for
  ordered side effects, `mergeMap` only when parallel and order-independent.
- Nested `subscribe` is a flattening operator waiting to be written.
- Error handling inside the pipe (`catchError`) so the stream survives;
  an unhandled error completes the stream and the UI silently stops
  updating.
- `shareReplay({ bufferSize: 1, refCount: true })` for expensive shared
  observables; without `refCount` the source leaks.
- `BehaviorSubject` as state is legacy; new state goes in signals. Do not
  mix both for the same piece of state.

## 6. Change detection

Zone.js (default through v19) patches async APIs and runs change detection
on every tick across the whole tree. `OnPush` restricts a component to
re-check only when an input reference changes, an event fires inside it, a
signal it reads changes, or `markForCheck` is called. Use `OnPush` on every
new component; it is the single biggest performance lever and it forces
immutable update patterns that are also easier to reason about.

Zoneless (`provideZonelessChangeDetection()`, stable in v20) removes
zone.js; change detection is triggered by signals, `async` pipe, event
listeners and `markForCheck`. Code that mutates fields and expects the
view to update will not work; everything the template reads should be a
signal or updated through a path Angular can see. A zoneless migration
checklist: remove `zone.js` polyfill, convert template-read fields to
signals, replace `setTimeout`-based "wait for CD" hacks with
`afterNextRender`, fix tests that relied on `fixture.detectChanges()`
semantics (`await fixture.whenStable()`).

`ExpressionChangedAfterItHasBeenCheckedError` means you changed state
during the check (in a getter, a child's `ngOnInit` modifying the parent,
or a template function with side effects). Fix the cause; do not paper
over it with `setTimeout` or `detectChanges()`.

Template bindings run on every check: no heavy functions in templates
(`{{ compute(items) }}`); use `computed` or a pure pipe. `@for` with
`track item.id` is mandatory (17+), and the tracker must be stable.

## 7. Control flow and `@defer`

```html
@if (user(); as u) {
  <p>Welcome, {{ u.name }}</p>
} @else if (loading()) {
  <app-skeleton />
} @else {
  <a routerLink="/login">Sign in</a>
}

@for (item of items(); track item.id; let i = $index) {
  <app-row [item]="item" [index]="i" />
} @empty {
  <p>No items yet.</p>
}

@switch (status()) { @case ('error') { <app-error /> } @default { <app-table /> } }

@defer (on viewport; prefetch on idle) {
  <app-heavy-chart [data]="chartData()" />
} @placeholder (minimum 300ms) {
  <div class="chart-skeleton" aria-hidden="true"></div>
} @loading { <app-spinner /> } @error { <p>Chart failed to load.</p> }
```

`@defer` lazy-loads the dependencies of its block into a separate chunk
with triggers: `on idle` (default), `on viewport`, `on interaction`, `on
hover`, `on timer(2s)`, `when condition()`. It is the Angular equivalent of
code splitting below the route level; use it for charts, editors, maps,
below-the-fold widgets. The deferred component must be standalone and not
referenced elsewhere eagerly (or it stays in the main chunk).

`*ngIf`/`*ngFor` still work; migrate with `ng generate @angular/core:control-flow`
when the team agrees, not file by file in an unrelated PR.

## 8. Routing

```ts
export const routes: Routes = [
  { path: '', component: HomeComponent, title: 'Home' },
  {
    path: 'admin',
    canMatch: [() => inject(AuthStore).isAdmin()],                    // functional guards; inject() works here
    loadChildren: () => import('./admin/admin.routes').then(m => m.ADMIN_ROUTES),   // lazy
    providers: [AdminService],                                         // scoped providers
  },
  {
    path: 'products/:id',
    loadComponent: () => import('./product/product.component').then(m => m.ProductComponent),
    resolve: { product: (route: ActivatedRouteSnapshot) => inject(ProductApi).get(route.paramMap.get('id')!) },
    title: (route) => `Product ${route.paramMap.get('id')}`,
  },
  { path: '**', component: NotFoundComponent },
]

// bootstrap: provideRouter(routes, withComponentInputBinding(), withViewTransitions(), withInMemoryScrolling({ anchorScrolling: 'enabled' }))
```

`withComponentInputBinding()` maps route params, query params, and resolved
data to component `input()`s by name, removing most `ActivatedRoute`
plumbing. URL state (filters, pagination) lives in `queryParams`:
`router.navigate([], { queryParams: { page }, queryParamsHandling: 'merge' })`.
Use `routerLink` on `<a>` elements, never `(click)="router.navigate(...)"`
on a `<div>`.

Focus management on navigation: Angular does not move focus on route
change. Subscribe to `NavigationEnd` (or use `withRouterConfig`-adjacent
hooks) and focus the main heading or `<main tabindex="-1">`. See
`accessibility-implementation.md`.

## 9. Forms

Reactive forms are the default for anything non-trivial; typed since v14.

```ts
readonly form = this.fb.nonNullable.group({
  email: ['', [Validators.required, Validators.email]],
  name: ['', [Validators.required, Validators.maxLength(80)]],
  address: this.fb.nonNullable.group({ line1: [''], city: [''] }),
})
private readonly fb = inject(FormBuilder)

submit() {
  if (this.form.invalid) { this.form.markAllAsTouched(); return }
  const value = this.form.getRawValue()   // typed
  this.api.save(value).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ error: (e) => this.applyServerErrors(e) })
}
```

```html
<form [formGroup]="form" (ngSubmit)="submit()" novalidate>
  <label for="email">Email</label>
  <input id="email" type="email" formControlName="email" [attr.aria-invalid]="form.controls.email.invalid && form.controls.email.touched" aria-describedby="email-err" />
  @if (form.controls.email.touched && form.controls.email.hasError('required')) {
    <p id="email-err" role="alert">Email is required.</p>
  }
</form>
```

Template-driven forms (`ngModel`) are fine for a two-field form in a
codebase that uses them. Async validators for server checks with
`updateOn: 'blur'`. Custom `ControlValueAccessor` for reusable inputs so
they participate in forms and receive validation state. Signal forms are
experimental in v21; do not adopt unless the repo already has.

## 10. HTTP and data

`HttpClient` returns cold observables; one subscription equals one
request. Patterns:

```ts
@Injectable({ providedIn: 'root' })
export class ProductApi {
  private readonly http = inject(HttpClient)
  list(params: { q?: string; page: number }) {
    return this.http.get<Page<Product>>('/api/products', { params: new HttpParams({ fromObject: params as any }) })
  }
}

// In a component (v19+): signals-first async data with cancellation
readonly id = input.required<string>()
readonly product = rxResource({ request: () => this.id(), loader: ({ request: id }) => this.api.get(id) })
// template: @if (product.isLoading()) ... @else if (product.error()) ... @else { product.value() }
```

Pre-19: `toSignal(this.id$.pipe(switchMap(id => this.api.get(id))))` or
`async` pipe. For a caching layer (dedupe, stale-while-revalidate,
invalidation) comparable to TanStack Query, `@tanstack/angular-query-experimental`
exists; NgRx `signalStore` with `withEntities`/`rxMethod` is the choice in
NgRx codebases. Do not build a cache out of `shareReplay` and a `Map` by
hand when either is present.

Interceptors (functional, `withInterceptors([...])`) for auth headers,
error normalization and retries with backoff on idempotent requests only.
Typed responses: `http.get<T>` is a cast, not validation; parse at the
boundary (zod) if the API is not generated/typed (see `typescript.md`).

## 11. Testing hooks

`TestBed` with standalone imports; `ComponentFixture`; prefer
`@testing-library/angular` queries by role/label when present. For signal
inputs: `fixture.componentRef.setInput('product', p)`. `provideHttpClientTesting()`
+ `HttpTestingController` for HTTP; `provideRouter([])` for router deps;
`fakeAsync`/`tick` for timers. Zoneless tests: `await fixture.whenStable()`
after state changes. See `testing.md` for the general philosophy.

## 12. Anti-patterns with fixes

| Anti-pattern | Fix |
|---|---|
| `effect()` writing a signal that could be `computed` | `computed` or `linkedSignal` |
| `BehaviorSubject` + manual `.next()` for component state in a signals codebase | `signal` |
| `subscribe()` with no teardown | `toSignal`, `async` pipe, `takeUntilDestroyed`, `resource` |
| Nested `subscribe` | `switchMap`/`exhaustMap`/`concatMap` |
| `Default` change detection on new components | `OnPush` |
| Methods called in templates (`{{ total() }}` that recomputes) | `computed` or pure pipe |
| `@for` without stable `track` (or `track $index` on editable lists) | `track item.id` |
| Mutating an array then `set()`ting the same reference | New array |
| `setTimeout(() => this.cdr.detectChanges())` | Fix the data flow; use `afterNextRender` for DOM work |
| `any` on `HttpClient` responses | Generic type + boundary validation |
| Eagerly imported feature modules/components | `loadChildren`/`loadComponent`/`@defer` |
| Constructor with eight injected params | `inject()` fields; or the class does too much |
| `(click)` on `<div>` for navigation | `<a routerLink>` |
| `ngOnChanges` to recompute from inputs | `computed` on signal inputs |
| `ViewChild` + `nativeElement` focus in `ngAfterViewInit` with `setTimeout` | `viewChild()` signal + `afterNextRender` |
