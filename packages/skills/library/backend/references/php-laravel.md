# PHP and Laravel backends

Laravel gives you a complete shape: form requests for validation, policies
for authorization, API resources for serialization, a queue system with
retries, and a service container. This reference covers using each one
where it belongs, where business logic goes (actions/services), Eloquent
from the application side, and the footguns. Notes for Symfony where it
differs.

## Contents

1. Detecting the setup
2. Structure: where things go
3. Form requests: validation at the edge
4. Controllers and API resources
5. The error envelope
6. Authorization with policies and gates
7. Eloquent from the app side
8. Queues and jobs
9. Scheduling
10. Configuration
11. Logging
12. Testing
13. Symfony notes
14. Footguns

## 1. Detecting the setup

- `composer.json`: `laravel/framework` version (10, 11, 12; 11+ slimmed
  the skeleton: no `app/Http/Middleware/*` files, `bootstrap/app.php`
  configures middleware and exceptions). PHP version (8.2+ for 11).
- Auth: `laravel/sanctum` (SPA cookies + API tokens), `laravel/passport`
  (OAuth2 server), `laravel/fortify` (headless auth backend),
  `laravel/breeze`/`jetstream` (scaffolds), `laravel/socialite` (OAuth
  clients).
- Queue: `QUEUE_CONNECTION` in `.env` (`sync`, `database`, `redis`, `sqs`);
  `laravel/horizon` (Redis dashboard and supervisor).
- API layer: plain controllers + `JsonResource`, or `spatie/laravel-data`,
  `spatie/laravel-query-builder` (safe filtering/sorting from query
  strings), `league/fractal`.
- Structure hints: `app/Actions/` (Jetstream style, one class per use
  case), `app/Services/`, `app/Domain/` (DDD-ish modular layout, e.g.
  `spatie/laravel-package-tools` or the "Laravel beyond CRUD" layout),
  `nwidart/laravel-modules`. Follow what exists.
- Tests: `phpunit` or `pestphp/pest`, `RefreshDatabase`, factories,
  `Http::fake()`, `Queue::fake()`.
- Static analysis: `larastan` (PHPStan), `psalm`; `pint` for formatting.
  Check `phpstan.neon` level and match it.

## 2. Structure: where things go

Default Laravel layout plus one place for use cases:

```
app/
  Http/
    Controllers/Api/OrderController.php      thin: request → action → resource
    Requests/StoreOrderRequest.php           validation + authorization
    Resources/OrderResource.php              serialization
  Actions/Orders/CreateOrder.php             use case (or Services/OrderService.php)
  Models/Order.php                           Eloquent + domain methods (cancel(), scopes)
  Policies/OrderPolicy.php
  Jobs/SendOrderConfirmation.php
  Events/OrderCreated.php, Listeners/
  Exceptions/InsufficientStockException.php
  Support/                                    small shared helpers (not a dump)
```

Actions (one class, one `handle()`/`execute()` method) or a service class
per aggregate; pick what the repo has. Controllers never contain `if`
about business rules; models hold single-record behavior; actions hold
multi-model workflows and transactions. If the repo uses a `Domain/` tree
with `Actions`, `DataTransferObjects`, `Models`, `QueryBuilders` per
domain, add the feature inside the matching domain folder.

## 3. Form requests: validation at the edge

```php
final class StoreOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', Order::class);
    }

    public function rules(): array
    {
        return [
            'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.sku' => ['required', 'string', 'max:64'],
            'items.*.qty' => ['required', 'integer', 'min:1', 'max:1000'],
            'coupon_code' => ['nullable', 'string', 'max:32'],
            'shipping_address_id' => ['required', 'uuid', Rule::exists('addresses', 'id')->where('user_id', $this->user()->id)],
        ];
    }

    protected function prepareForValidation(): void
    {
        if ($this->has('coupon_code')) {
            $this->merge(['coupon_code' => strtoupper(trim($this->input('coupon_code')))]);
        }
    }

    public function toCommand(): CreateOrderCommand
    {
        $v = $this->validated();
        return new CreateOrderCommand(items: array_map(fn ($i) => new LineItem($i['sku'], (int) $i['qty']), $v['items']), couponCode: $v['coupon_code'] ?? null, shippingAddressId: $v['shipping_address_id']);
    }
}
```

`$request->validated()` returns only validated keys (mass-assignment
safety on top of `$fillable`). `Rule::exists` scoped to the user does the
ownership check at validation time, which is acceptable for lookups;
state-dependent rules (stock) belong in the action. `spatie/laravel-data`
DTOs can replace form requests + hand-written commands if the repo uses it.
Query-string validation: a form request on GET works the same
(`'limit' => ['integer', 'between:1,100']`).

## 4. Controllers and API resources

```php
final class OrderController extends Controller
{
    public function store(StoreOrderRequest $request, CreateOrder $createOrder): JsonResponse
    {
        $order = $createOrder->handle($request->user(), $request->toCommand(), $request->header('Idempotency-Key'));

        return OrderResource::make($order)->response()->setStatusCode(201)->header('Location', route('orders.show', $order));
    }

    public function index(ListOrdersRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Order::class);
        $orders = Order::query()->whereBelongsTo($request->user())->with('items')
            ->when($request->validated('status'), fn ($q, $s) => $q->where('status', $s))
            ->orderByDesc('created_at')->orderByDesc('id')
            ->cursorPaginate($request->validated('limit', 50));

        return OrderResource::collection($orders);
    }
}

final class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status->value,
            'total' => ['amount' => $this->total_minor, 'currency' => $this->currency],
            'items' => LineItemResource::collection($this->whenLoaded('items')),
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
```

Resources are the serializer: explicit fields, `whenLoaded` so an
unloaded relation is omitted rather than lazily queried, `cursorPaginate`
for unbounded lists (it emits `next_cursor` in `meta`/`links`). Never
`return $order;` (serializes every column, including hidden ones if
`$hidden` is incomplete). Method injection resolves actions from the
container; constructor-inject services if several methods share them.

## 5. The error envelope

Laravel 11+: `bootstrap/app.php` `withExceptions`. Earlier:
`app/Exceptions/Handler.php` `register()`.

```php
->withExceptions(function (Exceptions $exceptions) {
    $exceptions->shouldRenderJsonWhen(fn (Request $r, Throwable $e) => $r->is('api/*') || $r->expectsJson());

    $problem = function (Request $r, int $status, string $code, string $title, array $extra = []) {
        return response()->json(array_merge([
            'type' => 'about:blank', 'title' => $title, 'status' => $status, 'code' => $code,
            'instance' => $r->getPathInfo(), 'requestId' => $r->attributes->get('request_id'),
        ], $extra), $status, ['Content-Type' => 'application/problem+json']);
    };

    $exceptions->render(fn (ValidationException $e, Request $r) => $problem($r, 422, 'validation_error', 'Validation failed', [
        'errors' => collect($e->errors())->flatMap(fn ($msgs, $field) => collect($msgs)->map(fn ($m) => ['field' => $field, 'message' => $m]))->values()->all(),
    ]));
    $exceptions->render(fn (AuthenticationException $e, Request $r) => $problem($r, 401, 'unauthenticated', 'Authentication required'));
    $exceptions->render(fn (AuthorizationException $e, Request $r) => $problem($r, 403, 'forbidden', 'Not allowed'));
    $exceptions->render(fn (ModelNotFoundException|NotFoundHttpException $e, Request $r) => $problem($r, 404, 'not_found', 'Not found'));
    $exceptions->render(fn (DomainException $e, Request $r) => $problem($r, $e->status(), $e->code(), $e->getMessage()));
    $exceptions->render(fn (ThrottleRequestsException $e, Request $r) => $problem($r, 429, 'rate_limited', 'Too many requests')->withHeaders($e->getHeaders()));
    $exceptions->render(fn (Throwable $e, Request $r) => $problem($r, 500, 'internal', 'Internal Server Error'));  // last; reported above by default
})
```

A `DomainException` base with `status()` and `code()` and subclasses like
`InsufficientStockException` (409, `insufficient_stock`) keeps mapping in
one place. `$exceptions->dontReport([DomainException::class])` so expected
failures do not flood Sentry. Add a request ID middleware early
(`$r->attributes->set('request_id', $r->header('X-Request-Id') ?? Str::uuid())`)
and push it into the log context.

## 6. Authorization with policies and gates

```php
final class OrderPolicy
{
    public function viewAny(User $user): bool { return true; }
    public function view(User $user, Order $order): bool { return $order->user_id === $user->id || $user->hasRole('support'); }
    public function create(User $user): bool { return $user->hasVerifiedEmail(); }
    public function cancel(User $user, Order $order): bool { return $this->view($user, $order) && $order->canBeCancelled(); }
}
```

Policies auto-discover by naming (`OrderPolicy` for `Order`). Check in the
form request's `authorize()`, with `$this->authorize('cancel', $order)` in
the controller, or `Gate::authorize` inside the action when the action is
also called from a command or job. Route model binding + `can:` middleware
(`->middleware('can:view,order')`) is fine for simple cases. For lists,
constrain the query (`whereBelongsTo($user)` or a scope), never filter
after loading. Roles/permissions via `spatie/laravel-permission` if
present. Model and policy design trade-offs: `auth-implementation.md`.

## 7. Eloquent from the app side

- **N+1**: `with()` eager loading, `loadMissing()`, `withCount()`.
  `Model::preventLazyLoading(! app()->isProduction())` in a service
  provider raises `LazyLoadingViolationException` in dev/test; turn it
  on. `Model::preventSilentlyDiscardingAttributes()` and
  `preventAccessingMissingAttributes()` (`Model::shouldBeStrict()` for
  all three) catch the other quiet bugs.
- **Transactions**: `DB::transaction(fn () => ..., attempts: 3)` wraps the
  action; retries on deadlock. Jobs dispatched inside: `dispatch(...)->
  afterCommit()` or `ShouldDispatchAfterCommit` on the job (11+ has
  `queue.connections.*.after_commit = true` globally). Events:
  `ShouldDispatchAfterCommit`.
- **Locking**: `lockForUpdate()` inside a transaction; optimistic via a
  `version` column and `where('version', $v)->update([...])` checking the
  affected count.
- **Bulk**: `insert()`, `upsert()`, `chunkById()`/`lazyById()` for large
  sets; `increment()`/`decrement()` instead of read-modify-write.
- **Mass assignment**: `$fillable` on every model (or `$guarded = []` only
  with form requests' `validated()` as the sole input source).
- **Casts**: enums (`'status' => OrderStatus::class`), `immutable_datetime`,
  `AsArrayObject`; money as integer cents, never float casts.
- **Scopes** for reusable query fragments; `whereBelongsTo` for ownership.
- **`$model->refresh()`** after `update()` when you need DB-computed
  values; `update()` returns bool, `updateOrFail()` throws.
- **Accessor/mutator side effects** and model events (`creating`, `saved`)
  that touch other systems are the same trap as Rails callbacks; keep them
  local to the row.
- Schema and index design: `database/references/`.

## 8. Queues and jobs

```php
final class SendOrderConfirmation implements ShouldQueue, ShouldBeUnique
{
    use Queueable;

    public int $tries = 5;
    public int $timeout = 120;
    public array $backoff = [10, 60, 300, 900];      // seconds, per attempt
    public int $uniqueFor = 3600;

    public function __construct(public readonly int $orderId) {}

    public function uniqueId(): string { return (string) $this->orderId; }

    public function middleware(): array { return [new RateLimited('mail'), (new WithoutOverlapping($this->orderId))->releaseAfter(30)]; }

    public function handle(Mailer $mailer): void
    {
        $order = Order::with('user')->findOrFail($this->orderId);
        if ($order->confirmation_sent_at) { return; }               // idempotent
        $mailer->to($order->user)->send(new OrderConfirmationMail($order));
        $order->forceFill(['confirmation_sent_at' => now()])->saveQuietly();
    }

    public function failed(Throwable $e): void { report($e); }      // after all tries → failed_jobs table
    public function retryUntil(): DateTime { return now()->addHours(6); }
}
```

Constructor properties are serialized; pass IDs, not models (Laravel
serializes models by ID and reloads them anyway via `SerializesModels`,
but a deleted model then throws). `$tries`/`$backoff`/`$timeout` are per
job; `php artisan queue:work --tries=3 --timeout=90` sets defaults.
`$timeout` must be shorter than `retry_after` in `config/queue.php` or
the job runs twice. `failed_jobs` is your dead-letter table; `queue:retry`
reprocesses. Horizon for Redis supervision and balancing; `queue:work`
under Supervisor/systemd otherwise. Batches (`Bus::batch`) for fan-out
with `then`/`catch`/`finally`; chains for sequences. `QUEUE_CONNECTION=sync`
in local hides every serialization and timing bug; use `database` or
`redis` locally too. Mail: `Mail::queue`/`->queue()` or a `ShouldQueue`
mailable; never `->send()` in a controller. More in `jobs-and-async.md`.

## 9. Scheduling

`routes/console.php` (11+) or `app/Console/Kernel.php`: `Schedule::job
(new PruneExpiredCarts)->hourly()->onOneServer()->withoutOverlapping()`.
One cron entry runs `schedule:run` every minute; `onOneServer()` needs a
shared cache (Redis/database) and is mandatory on multi-instance deploys.
Scheduled work that takes more than a few seconds dispatches a job rather
than running inline in the scheduler.

## 10. Configuration

`config/*.php` reads `env()` once; application code calls `config
('services.stripe.key')`, never `env()` (with `config:cache` enabled,
`env()` returns null everywhere except the config files). Add new
settings to `config/`, document them in `.env.example`, and validate
required ones at boot in a service provider (`throw_if(blank(config
('services.stripe.key')), ...)`) or with `spatie/laravel-validated-config`.
Secrets come from the environment or a secrets manager; `.env` is local
only and gitignored. More in `config-and-environments.md`.

## 11. Logging

`Log::withContext(['request_id' => $id, 'user_id' => $uid])` in middleware
adds fields to every log line in the request. JSON via the `json`
formatter on the stack channel in production (`'formatter' => JsonFormatter::class`).
`Log::info('order created', ['order_id' => $order->id])`: message plus
context array, not interpolated strings. `report($e)` to send to the
error tracker without rendering. Never log `$request->all()`; use
`$request->except(['password', 'token'])` if you must. Field conventions
in `observability.md`.

## 12. Testing

Pest or PHPUnit, `RefreshDatabase` against the same engine as production
(a Postgres/MySQL service in CI, not SQLite in-memory unless prod is
SQLite; JSON columns, constraints and functions differ). Feature tests
hit routes through the kernel:

```php
it('creates one order for repeated idempotency key', function () {
    $user = User::factory()->has(Address::factory())->create();
    $payload = ['shipping_address_id' => $user->addresses->first()->id, 'items' => [['sku' => 'ABC', 'qty' => 2]]];

    $first = $this->actingAs($user)->withHeader('Idempotency-Key', 'k1')->postJson('/api/orders', $payload);
    $second = $this->actingAs($user)->withHeader('Idempotency-Key', 'k1')->postJson('/api/orders', $payload);

    $first->assertCreated();
    expect($second->json('id'))->toBe($first->json('id'));
    expect(Order::count())->toBe(1);
});

it('returns problem details for a bad payload', function () {
    $this->actingAs(User::factory()->create())->postJson('/api/orders', ['items' => 'nope'])
        ->assertStatus(422)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('code', 'validation_error')
        ->assertJsonPath('errors.0.field', 'items');
});
```

`Queue::fake()` + `Queue::assertPushed(SendOrderConfirmation::class)` for
dispatch; a separate test runs the job with `handle()` directly.
`Http::fake(['api.stripe.com/*' => Http::response([...], 500)])` and
`Http::fake(fn () => throw new ConnectionException())` for the failure
paths. `Mail::fake()`, `Event::fake()`, `Notification::fake()`.
`$this->travelTo(now())` for time. `$this->assertDatabaseHas`. Count
queries in a test with `DB::enableQueryLog()` or `expectsDatabaseQueryCount`
(10+) to pin N+1 fixes.

## 13. Symfony notes

Same ideas, different names: controllers are services with `#[Route]`;
validation via `#[Assert\*]` on DTOs with `#[MapRequestPayload]` (6.3+);
`ExceptionListener`/`#[AsEventListener(KernelEvents::EXCEPTION)]` renders
the envelope (Symfony has `ProblemNormalizer` for RFC 7807 in the
serializer component); voters (`Security\Voter`) are the policy layer;
Messenger for queues with retry strategy and failure transport in
`messenger.yaml`, `#[AsMessageHandler]`, and Doctrine transport for
transactional outbox-ish behavior; Doctrine ORM with explicit `flush()`
and `fetch: EAGER`/`addSelect` joins for N+1; `bin/console` commands and
the Scheduler component. API Platform if present makes resources
declarative; follow its conventions.

## 14. Footguns

- **`env()` in application code** → null once config is cached.
- **Fat controllers** with `DB::transaction` and five models inline.
- **Returning models directly** → leaked columns, lazy-load storm.
- **`QUEUE_CONNECTION=sync` locally** hides job bugs.
- **Model passed to a job that gets deleted** → `ModelNotFoundException`
  on every retry. Handle it or pass the ID.
- **`$timeout` ≥ `retry_after`** → duplicate job execution.
- **Dispatching inside a transaction without `afterCommit`** → job runs
  before the row commits.
- **`->get()->count()`** / `->get()->first()` → loads everything. Use
  `count()`/`first()` on the builder.
- **N+1 in resources** (`$this->items` without `with('items')` and
  `whenLoaded`). `preventLazyLoading`.
- **`$guarded = []` with `$request->all()`** → mass assignment.
- **`try { } catch (\Exception $e) { return response()->json(['error' =>
  $e->getMessage()]); }`** → 200 with error, leaked messages.
- **`Http::get()` without `->timeout()`** (default 30s) and no `->retry()`
  policy. `Http::timeout(3)->connectTimeout(1)->retry(2, 200,
  throw: false)`; see `resilience.md`.
- **Scheduler without `onOneServer()`** on multiple instances.
- **`Mail::send` in a request.**
- **SQLite in tests, MySQL/Postgres in prod.**
- **`Cache::remember` with a key that includes unbounded user input**
  (cache flooding) or without TTL.
