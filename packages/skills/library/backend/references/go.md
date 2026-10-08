# Go backends

`net/http` and the routers people put on top of it, context propagation as
the backbone of timeouts and cancellation, error wrapping that survives
the trip to the handler, structured concurrency with `errgroup` and worker
pools, graceful shutdown, `slog`, testing with `httptest` and a real
database, and a project layout that stays flat until it needs to grow.

## Contents

1. Detecting the setup
2. Project layout that isn't over-engineered
3. Handlers: net/http 1.22+, chi, echo, gin
4. Validation and decoding
5. Errors: wrapping, sentinel vs typed, mapping to responses
6. Context propagation
7. Structured concurrency and worker pools
8. Graceful shutdown
9. Logging with slog
10. Database access from the app side
11. Testing
12. Footguns

## 1. Detecting the setup

- `go.mod`: Go version (1.22+ has method-and-pattern routing in
  `net/http`, `range` over int; 1.21+ has `slog` and `min`/`max`). Router:
  none (`net/http`), `github.com/go-chi/chi/v5`, `github.com/labstack/echo/v4`,
  `github.com/gin-gonic/gin`, `github.com/gofiber/fiber`. RPC:
  `google.golang.org/grpc`, `connectrpc.com/connect`.
- Validation: `github.com/go-playground/validator/v10` is common; many
  repos hand-validate. Decoding: `encoding/json`; some use `go-json` or
  `sonic`.
- DB: `database/sql` + `pgx` (`jackc/pgx/v5`), `sqlc` (generated typed
  queries; excellent), `sqlx`, `gorm`, `ent`, `bun`. Migrations: `goose`,
  `migrate`, `atlas`.
- Logging: `log/slog`, `zerolog`, `zap`, `logrus` (older). Match it.
- Jobs: `river` (Postgres), `asynq` (Redis), `machinery`, raw SQS/Kafka
  consumers. Scheduling: `robfig/cron`, or the platform.
- Tooling: `golangci-lint` config (`.golangci.yml`), `Makefile`/`Taskfile`,
  `go test ./...`, `testcontainers-go`, `testify` or stdlib asserts,
  `mockery`/`gomock` (be cautious), `go-cmp`.
- Layout: `cmd/<binary>/main.go` + `internal/` is the mainstream shape.

## 2. Project layout that isn't over-engineered

Start flat; add structure when a package exceeds a few thousand lines or
a second binary appears. Avoid the "standard layout" cargo cult of
`pkg/`, `api/`, `domain/`, `usecase/`, `repository/`, `delivery/` trees for
a small service.

```
cmd/
  api/main.go              wire config, deps, server, shutdown; nothing else
  worker/main.go
internal/
  config/config.go         typed env loading
  httpx/                   shared HTTP helpers: problem details, decode, request id middleware
  order/
    order.go               domain types + rules (no I/O)
    service.go             use cases: Service struct with deps
    store.go               Store interface + Postgres impl (or sqlc output)
    handler.go             HTTP transport
    handler_test.go
    service_test.go
  user/ ...
  platform/
    postgres/              pool setup
    queue/
```

Package by domain (`order`, `user`, `billing`), not by layer. Each domain
package exposes a `Service` and the types it needs; the handler lives in
the same package (or a sibling `orderhttp` if transport bloats). Interfaces
are defined by the consumer, kept small, and introduced when a second
implementation (a fake in tests counts) is needed, not preemptively.
`internal/` prevents external import, which is what you want for a service.

## 3. Handlers: net/http 1.22+, chi, echo, gin

### net/http (1.22+) with a handler struct

```go
type OrderHandler struct {
    svc *order.Service
    log *slog.Logger
}

func (h *OrderHandler) Routes(mux *http.ServeMux) {
    mux.Handle("POST /orders", h.create())
    mux.Handle("GET /orders/{id}", h.get())
}

func (h *OrderHandler) create() http.Handler {
    return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
        var in order.CreateInput
        if err := httpx.Decode(r, &in); err != nil {        // size-limited, strict JSON decode + validate
            return err
        }
        actor := auth.ActorFrom(r.Context())
        o, err := h.svc.Create(r.Context(), actor, in)
        if err != nil {
            return err                                        // mapped centrally
        }
        w.Header().Set("Location", "/orders/"+o.ID)
        return httpx.JSON(w, http.StatusCreated, toOrderDTO(o))
    })
}
```

`httpx.Handle` adapts `func(w, r) error` into `http.Handler` and renders
the error once:

```go
type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

func Handle(fn HandlerFunc) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if err := fn(w, r); err != nil {
            RenderProblem(w, r, err)
        }
    })
}
```

Returning errors from handlers instead of writing responses in twenty
places is the single biggest quality improvement available in Go HTTP
code. Middleware as `func(http.Handler) http.Handler`, composed in
`main.go`: request ID → logging → recover → timeout → auth → handler.

### chi

Same model, with `chi.URLParam`, route groups, and a mature middleware set
(`middleware.RequestID`, `RealIP`, `Recoverer`, `Timeout`). Use `r.Group`
and `r.Route` for auth-scoped subtrees. `render` is optional; the same
`Handle` adapter works.

### echo

`echo.HandlerFunc` already returns `error`; set `e.HTTPErrorHandler` to
render problem details for `*echo.HTTPError`, your domain errors, and
anything else. `c.Bind(&in)` then `c.Validate(in)` (register a validator).
`e.Use(middleware.RequestID(), middleware.RequestLoggerWithConfig(...),
middleware.Recover(), middleware.TimeoutWithConfig(...))`.

### gin

`gin.HandlerFunc` returns nothing; use `c.Error(err)` plus a final
middleware that reads `c.Errors` and renders, or a small adapter. `c.ShouldBindJSON`
with `binding:"required,min=1"` tags uses validator under the hood. Gin
swallows panics by default with its own 500 page; replace with your
recovery middleware that renders the envelope. Gin's context is not a
`context.Context` for cancellation purposes; always pass `c.Request.Context()`
downstream, never `c`.

## 4. Validation and decoding

```go
func Decode(r *http.Request, dst any) error {
    r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)         // 1 MiB cap
    dec := json.NewDecoder(r.Body)
    dec.DisallowUnknownFields()
    if err := dec.Decode(dst); err != nil {
        var mbe *http.MaxBytesError
        switch {
        case errors.As(err, &mbe):
            return &Problem{Status: 413, Code: "payload_too_large", Title: "Request body too large"}
        default:
            return &Problem{Status: 400, Code: "malformed_body", Title: "Malformed JSON", Detail: err.Error()}
        }
    }
    if dec.More() {
        return &Problem{Status: 400, Code: "malformed_body", Title: "Multiple JSON values"}
    }
    if v, ok := dst.(interface{ Validate() error }); ok {
        if err := v.Validate(); err != nil {
            return err // *ValidationError → 422
        }
    }
    return nil
}
```

Validation can be hand-written (`Validate()` methods returning a
`ValidationError{Fields: []FieldError}`) or `validator` tags; hand-written
is more explicit and gives better messages, tags are faster to write. For
query params, parse into a struct with explicit `strconv` and bounds; cap
`limit`. Do the same for path params (`r.PathValue("id")`): parse into the
ID type, 404 on garbage.

Decode into input structs with no behavior, convert to domain types in
the service. Do not decode straight into the database model.

## 5. Errors: wrapping, sentinel vs typed, mapping to responses

Wrap with context on the way up; inspect with `errors.Is`/`errors.As` at
the top.

```go
// domain
var ErrNotFound = errors.New("not found")
var ErrInsufficientStock = errors.New("insufficient stock")

type ValidationError struct{ Fields []FieldError }
func (e *ValidationError) Error() string { return "validation failed" }

// store
func (s *PGStore) Get(ctx context.Context, id string) (*Order, error) {
    row, err := s.q.GetOrder(ctx, id)
    if errors.Is(err, pgx.ErrNoRows) {
        return nil, fmt.Errorf("order %s: %w", id, ErrNotFound)
    }
    if err != nil {
        return nil, fmt.Errorf("get order %s: %w", id, err)
    }
    return toDomain(row), nil
}

// http mapping, in one place
func RenderProblem(w http.ResponseWriter, r *http.Request, err error) {
    p := &Problem{Status: 500, Code: "internal", Title: "Internal Server Error"}
    var pe *Problem
    var ve *ValidationError
    switch {
    case errors.As(err, &pe):
        p = pe
    case errors.As(err, &ve):
        p = &Problem{Status: 422, Code: "validation_error", Title: "Validation failed", Errors: ve.Fields}
    case errors.Is(err, ErrNotFound):
        p = &Problem{Status: 404, Code: "not_found", Title: "Not found"}
    case errors.Is(err, ErrInsufficientStock):
        p = &Problem{Status: 409, Code: "insufficient_stock", Title: "Insufficient stock"}
    case errors.Is(err, context.DeadlineExceeded):
        p = &Problem{Status: 504, Code: "timeout", Title: "Upstream timeout"}
    }
    if p.Status >= 500 {
        slog.ErrorContext(r.Context(), "unhandled error", "err", err)
    }
    p.Instance = r.URL.Path
    p.RequestID = RequestIDFrom(r.Context())
    w.Header().Set("Content-Type", "application/problem+json")
    w.WriteHeader(p.Status)
    _ = json.NewEncoder(w).Encode(p)
}
```

Guidelines: `%w` exactly once per wrap; message says what you were doing
(`"get order %s"`), not "error occurred"; never log and return the same
error (it gets logged twice); do not return `err` naked from the store
without context unless it is already a domain error; `errors.Join` for
aggregates. Panics are for programmer errors only; the recover middleware
turns them into a 500 with a stack logged.

## 6. Context propagation

`ctx` is the first parameter of every function that does I/O or can take
time. It carries the deadline, cancellation, request ID, trace span and
actor. Rules:

- The server sets a per-request timeout (`http.TimeoutHandler` or
  middleware with `context.WithTimeout`) and `ReadHeaderTimeout`,
  `ReadTimeout`, `WriteTimeout`, `IdleTimeout` on `http.Server`. The
  zero-value `http.Server` has no timeouts at all.
- Every outbound call takes `ctx` and a tighter child deadline:
  `ctx, cancel := context.WithTimeout(ctx, 2*time.Second); defer cancel()`.
  `http.NewRequestWithContext`, `pool.QueryRow(ctx, ...)`, `rdb.Get(ctx, ...)`.
- Do not store `ctx` in a struct; pass it. Do not use `context.Background()`
  inside a request except deliberately for work that must outlive the
  request (then use `context.WithoutCancel(ctx)` to keep values but drop
  cancellation, and give it its own timeout).
- Context values: small, request-scoped, typed keys (`type ctxKey struct{}`),
  with accessor functions (`ActorFrom(ctx)`). Not a dependency injection
  bag.
- Check `ctx.Err()` in long loops; `select` on `ctx.Done()` when waiting.

## 7. Structured concurrency and worker pools

`golang.org/x/sync/errgroup` for fan-out with error propagation and a
concurrency cap:

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
results := make([]Price, len(skus))
for i, sku := range skus {
    g.Go(func() error {
        p, err := pricing.Get(ctx, sku)     // ctx cancelled if any sibling fails
        if err != nil {
            return fmt.Errorf("price %s: %w", sku, err)
        }
        results[i] = p                       // distinct index per goroutine: no race
        return nil
    })
}
if err := g.Wait(); err != nil {
    return nil, err
}
```

A worker pool is a bounded set of goroutines reading from a channel:

```go
func (w *Worker) Run(ctx context.Context, jobs <-chan Job, n int) error {
    g, ctx := errgroup.WithContext(ctx)
    for range n {
        g.Go(func() error {
            for {
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case j, ok := <-jobs:
                    if !ok {
                        return nil
                    }
                    if err := w.handle(ctx, j); err != nil {
                        w.log.ErrorContext(ctx, "job failed", "job_id", j.ID, "err", err)   // log, don't abort pool
                    }
                }
            }
        })
    }
    return g.Wait()
}
```

Every goroutine you start must have a known way to end (ctx, closed
channel, or `WaitGroup`). Unbounded `go func()` per request is a memory
leak under load. Use `sync.Mutex` for shared maps or `sync.Map` for
caches; run tests with `-race`. `time.After` in a loop leaks timers before
1.23; use `time.NewTimer` and `Stop`. Pre-1.22, capture loop variables
(`i := i`); 1.22+ fixed per-iteration semantics.

## 8. Graceful shutdown

```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    cfg := config.MustLoad()
    pool := postgres.MustConnect(ctx, cfg.DatabaseURL)
    defer pool.Close()

    srv := &http.Server{
        Addr:              cfg.Addr,
        Handler:           buildHandler(pool, cfg),
        ReadHeaderTimeout: 5 * time.Second,
        ReadTimeout:       10 * time.Second,
        WriteTimeout:      30 * time.Second,
        IdleTimeout:       120 * time.Second,     // > LB idle timeout
    }

    errCh := make(chan error, 1)
    go func() { errCh <- srv.ListenAndServe() }()

    select {
    case err := <-errCh:
        if !errors.Is(err, http.ErrServerClosed) {
            slog.Error("server failed", "err", err); os.Exit(1)
        }
    case <-ctx.Done():
        slog.Info("shutdown signal received")
    }

    health.SetNotReady()                                    // readiness 503 → LB drains
    time.Sleep(cfg.ShutdownDrainDelay)                      // let LB observe it (2-5s on k8s)
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {       // stop accept, wait for in-flight
        slog.Error("graceful shutdown failed", "err", err)
    }
    // then: worker.Stop(shutdownCtx), tracer.Shutdown(shutdownCtx), pool.Close() via defer
}
```

`srv.Shutdown` does not wait for hijacked connections (websockets) or
long-polling; track and close those with `srv.RegisterOnShutdown`. The
shutdown budget must fit inside the orchestrator's grace period.

## 9. Logging with slog

```go
func newLogger(cfg Config) *slog.Logger {
    var h slog.Handler
    if cfg.Env == "development" {
        h = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel})
    } else {
        h = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel})
    }
    return slog.New(h).With("service", "orders-api", "env", cfg.Env)
}
```

Request-scoped fields: a handler that wraps the base handler and reads
`request_id`, `trace_id`, `user_id` from `ctx` in `Handle()`, so
`slog.InfoContext(ctx, "order created", "order_id", id)` carries them
without threading a logger. One request log line in middleware with
method, path, status, `duration_ms`, bytes. Use `slog.Attr`s and typed
keys (`slog.String("order_id", id)`) in hot paths. Implement `LogValuer`
on types with secrets to redact. `zerolog`/`zap` repos: same fields,
their API.

## 10. Database access from the app side

- `pgxpool` with `MaxConns` sized to the DB (not `runtime.NumCPU()*4`),
  `MaxConnLifetime`, `MaxConnIdleTime`; set `statement_timeout` via
  connection config.
- `sqlc` generates typed functions from SQL; prefer it to hand-scanning
  or an ORM in new Go code if the repo has no ORM. With GORM, `Preload`
  for N+1 and beware its default behavior on zero values in `Updates`.
- Transactions wrap the use case: `tx, err := pool.Begin(ctx); defer tx.
  Rollback(ctx)` (no-op after commit); pass `tx` (or a `DBTX` interface
  satisfied by both pool and tx) into store methods. No HTTP calls inside
  a transaction.
- Always `rows.Close()` and check `rows.Err()`; `defer` the close
  immediately after the query.
- Query and index design: `database/references/`.

## 11. Testing

- Table-driven tests with `t.Run` for domain logic; `t.Parallel()` where
  state allows.
- HTTP: `httptest.NewRecorder()` + the handler, or `httptest.NewServer
  (handler)` for client-level tests. Assert status, `Content-Type`, and
  decoded body shape; for errors, decode into `Problem` and check `Code`.
- Real database with `testcontainers-go` (Postgres module) started once in
  `TestMain`, migrations applied, each test in a transaction rolled back
  or truncating. Store tests against a mock DB prove nothing.
- Interfaces for third parties (`type Mailer interface { Send(ctx, Msg)
  error }`) with hand-written fakes that record calls; generated mocks
  only if the repo uses them. `httptest.NewServer` to stub external HTTP,
  including a handler that sleeps past the timeout.
- Time: inject `now func() time.Time` or a `Clock` interface; `synctest`
  (1.25 experiment) or channels for timing-dependent code. Randomness:
  inject `*rand.Rand` with a seed.
- `go test -race -shuffle=on ./...` in CI; `-count=1` to defeat the cache
  when debugging flakes. `-run` and `-short` for fast local loops.

```go
func TestCreateOrder_BadPayload(t *testing.T) {
    h := newTestHandler(t)
    req := httptest.NewRequest(http.MethodPost, "/orders", strings.NewReader(`{"items":"nope"}`))
    req.Header.Set("Content-Type", "application/json")
    rec := httptest.NewRecorder()
    h.ServeHTTP(rec, req)

    if rec.Code != http.StatusBadRequest {
        t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body)
    }
    var p httpx.Problem
    if err := json.NewDecoder(rec.Body).Decode(&p); err != nil {
        t.Fatal(err)
    }
    if p.Code != "malformed_body" || p.RequestID == "" {
        t.Errorf("problem = %+v", p)
    }
}
```

## 12. Footguns

- **`http.Server{}` with no timeouts** and `http.DefaultClient` with no
  timeout. Set them all. Build one `*http.Client{Timeout: ...}` per
  dependency with a tuned `Transport` (`MaxIdleConnsPerHost` defaults to
  2, which starves fan-out).
- **Not draining and closing response bodies** (`io.Copy(io.Discard,
  resp.Body); resp.Body.Close()`), which leaks connections from the pool.
- **Shadowed `err`** inside `if` blocks so the outer check sees nil.
  `golangci-lint` with `govet` shadow catches it.
- **`defer` in a loop** (file handles, rows) runs at function end, not
  iteration end. Extract a function.
- **Goroutine per request with no bound or cancellation.**
- **Writing to `w` after returning an error** (double response, "superfluous
  WriteHeader"). The `Handle` adapter pattern prevents it.
- **Panicking on bad input.** Return an error.
- **Using `log.Fatal` outside `main`.** It skips defers; return the error.
- **`json.Unmarshal` into `map[string]interface{}`** and reaching in with
  type assertions. Decode into a struct.
- **`time.Now()` deep in domain code** making tests flaky; inject a clock.
- **Global `var db *sql.DB`** set in `init()`. Construct in `main`, pass in.
- **Interfaces with ten methods defined next to the implementation.**
  Define small interfaces where they are consumed.
- **Ignoring `ctx` in a hot loop** so cancellation never takes effect.
- **GORM `Find(&users)` in a loop, or `Save` on a struct with zero values**
  wiping columns. Learn its semantics or use sqlc.
