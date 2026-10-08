# Rust backends

axum and actix-web, error handling with `thiserror` for the library side
and `anyhow` for the application side, the tokio runtime and the blocking
trap, sharing state safely, tower middleware, validation, sqlx from the
app side, graceful shutdown, tracing, and testing. Rust makes the
resilience properties explicit; the job is to not fight the type system
into `unwrap()`.

## Contents

1. Detecting the setup
2. Project shape
3. axum handlers, extractors, state
4. actix-web differences
5. Errors: thiserror, anyhow, and IntoResponse
6. Validation at the edge
7. The async runtime and blocking
8. Sharing state: Arc, Mutex, RwLock, channels
9. tower middleware
10. Database from the app side (sqlx, sea-orm, diesel)
11. Graceful shutdown
12. Logging and tracing
13. Testing
14. Footguns

## 1. Detecting the setup

- `Cargo.toml`: `axum` (tower-based, most common for new services),
  `actix-web` (own runtime model, actors heritage, fast), `rocket`,
  `poem`, `salvo`, `warp` (older). `tokio` with `features = ["full"]` or a
  subset. `tower`, `tower-http` (cors, trace, timeout, compression,
  request-id). `hyper` directly in low-level repos.
- Errors: `thiserror`, `anyhow`, `eyre`, `snafu`. Serialization: `serde`,
  `serde_json`. Validation: `validator`, `garde`. Config: `config`,
  `figment`, `envy`, `dotenvy`. Logging: `tracing`, `tracing-subscriber`,
  `tracing-opentelemetry`. HTTP client: `reqwest` (check `features`).
- DB: `sqlx` (async, compile-time checked queries with `query!` macros
  and an offline `.sqlx/` dir), `sea-orm`, `diesel` (sync; use with
  `spawn_blocking` or `diesel-async`), `tokio-postgres`, `redis`/`fred`.
- Workspace: `[workspace]` with `crates/` is common; find the binary crate
  (`src/main.rs`) and the domain crates.
- Tooling: `cargo clippy -- -D warnings`, `cargo fmt`, `cargo nextest`,
  `sqlx-cli`, `cargo deny`, `rust-toolchain.toml`.

## 2. Project shape

```
src/
  main.rs            parse config, build state, build router, serve with shutdown
  config.rs
  app.rs             fn router(state) -> Router  (testable without a socket)
  error.rs           AppError + IntoResponse
  state.rs           AppState { db, http, config }
  http/
    mod.rs           shared extractors (ValidatedJson, Actor), problem details
    orders.rs        handlers
  orders/
    mod.rs           domain types
    service.rs       use cases
    repo.rs          sqlx queries
  jobs/
```

Or a workspace with `api`, `domain`, `infra` crates when it has grown.
Keep handlers in a module per resource; keep domain types free of axum
and sqlx imports so they can be tested without either. Do not start with
trait objects for every dependency; a concrete `PgPool` in `AppState` is
fine until a second implementation (a fake) is needed.

## 3. axum handlers, extractors, state

```rust
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub http: reqwest::Client,
    pub config: Arc<Config>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/orders", post(create_order).get(list_orders))
        .route("/orders/{id}", get(get_order))
        .route("/healthz", get(|| async { StatusCode::OK }))
        .layer(
            ServiceBuilder::new()
                .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
                .layer(TraceLayer::new_for_http().make_span_with(request_span))
                .layer(PropagateRequestIdLayer::x_request_id())
                .layer(TimeoutLayer::new(Duration::from_secs(30)))
                .layer(RequestBodyLimitLayer::new(1 << 20))
                .layer(CatchPanicLayer::custom(panic_to_problem)),
        )
        .with_state(state)
}

async fn create_order(
    State(state): State<AppState>,
    actor: Actor,                                   // custom extractor: reads session/bearer, 401 on failure
    idem: Option<TypedHeader<IdempotencyKey>>,
    ValidatedJson(input): ValidatedJson<CreateOrder>,   // deserialize + validate, 400/422 on failure
) -> Result<(StatusCode, HeaderMap, Json<OrderDto>), AppError> {
    let order = orders::service::create(&state.db, &actor, input, idem.map(|h| h.0 .0)).await?;
    let mut headers = HeaderMap::new();
    headers.insert(LOCATION, format!("/orders/{}", order.id).parse().unwrap());
    Ok((StatusCode::CREATED, headers, Json(OrderDto::from(order))))
}

async fn list_orders(
    State(state): State<AppState>,
    actor: Actor,
    Query(q): Query<ListOrdersQuery>,
) -> Result<Json<Page<OrderDto>>, AppError> {
    let q = q.validated()?;                           // clamp limit, parse cursor
    let page = orders::service::list(&state.db, &actor, q).await?;
    Ok(Json(page.map(OrderDto::from)))
}
```

Extractors run in order and the body extractor must be last. `State<T>`
requires `T: Clone`; put `Arc` around non-cheap things. A custom extractor
for the authenticated actor (`impl FromRequestParts<AppState> for Actor`)
centralizes auth and returns `AppError::Unauthenticated`. Path params in
axum 0.8 use `{id}` syntax (0.7 used `:id`). Use `axum::extract::rejection`
types to convert framework rejections into your envelope (wrap `Json` in
`ValidatedJson` that maps `JsonRejection` → `AppError::Malformed`).

## 4. actix-web differences

`HttpServer::new(move || App::new().app_data(state.clone()).configure
(routes))` runs one `App` per worker thread; state must be `Clone` or
wrapped in `web::Data<T>` (an `Arc`). Handlers return `impl Responder` or
`Result<T, E>` where `E: ResponseError`; implement `ResponseError` for
`AppError` with `status_code()` and `error_response()` writing problem
details. Extractors: `web::Json<T>`, `web::Path<T>`, `web::Query<T>`;
configure `JsonConfig::default().limit(1 << 20).error_handler(...)` to
route deserialization errors through your envelope. Middleware via
`wrap(middleware::Logger::default())`, `actix-web-lab` for request IDs,
`tracing-actix-web`. actix spawns its own runtime per worker; `tokio::
spawn` works inside handlers, but `spawn_blocking` is still needed for
blocking work. `actix_web::rt::System` is tokio underneath since 4.0.

## 5. Errors: thiserror, anyhow, and IntoResponse

Domain and infrastructure errors are enums with `thiserror`; the
application boundary converts them to responses in one `IntoResponse`.
`anyhow` is for `main`, scripts, and places where you only need to
propagate with context, not for errors a caller will match on.

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0} not found")]
    NotFound(&'static str),
    #[error("not allowed")]
    Forbidden,
    #[error("authentication required")]
    Unauthenticated,
    #[error("validation failed")]
    Validation(Vec<FieldError>),
    #[error("malformed request: {0}")]
    Malformed(String),
    #[error("{title}")]
    Conflict { code: &'static str, title: String },
    #[error("upstream {0} unavailable")]
    Upstream(&'static str),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),         // anything unexpected, with context chain
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => AppError::NotFound("resource"),
            sqlx::Error::Database(db) if db.is_unique_violation() => AppError::Conflict { code: "duplicate", title: "Already exists".into() },
            other => AppError::Internal(anyhow::Error::new(other).context("database")),
        }
    }
}

#[derive(Serialize)]
struct Problem<'a> {
    r#type: &'a str, title: String, status: u16, code: &'a str, instance: Option<String>,
    #[serde(rename = "requestId")] request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] errors: Option<&'a [FieldError]>,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, errors) = match &self {
            AppError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found", None),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "forbidden", None),
            AppError::Unauthenticated => (StatusCode::UNAUTHORIZED, "unauthenticated", None),
            AppError::Validation(errs) => (StatusCode::UNPROCESSABLE_ENTITY, "validation_error", Some(errs.as_slice())),
            AppError::Malformed(_) => (StatusCode::BAD_REQUEST, "malformed_body", None),
            AppError::Conflict { code, .. } => (StatusCode::CONFLICT, *code, None),
            AppError::Upstream(_) => (StatusCode::SERVICE_UNAVAILABLE, "upstream_unavailable", None),
            AppError::Internal(e) => {
                tracing::error!(error = ?e, "unhandled error");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal", None)
            }
        };
        let title = if status.is_server_error() { "Internal Server Error".to_string() } else { self.to_string() };
        let body = Problem { r#type: "about:blank", title, status: status.as_u16(), code, instance: None, request_id: None, errors };
        let mut resp = (status, Json(body)).into_response();
        resp.headers_mut().insert(CONTENT_TYPE, HeaderValue::from_static("application/problem+json"));
        resp
    }
}
```

A middleware (or `map_response`) fills `instance` and `requestId` from
request extensions so handlers do not. `?` with `From` conversions keeps
handlers clean. Never `.unwrap()`/`.expect()` on anything derived from
input or I/O; `expect` is acceptable for invariants ("header value is
static ASCII") and at startup.

## 6. Validation at the edge

```rust
#[derive(Deserialize, Validate)]
#[serde(deny_unknown_fields)]
pub struct CreateOrder {
    #[validate(length(min = 1, max = 100), nested)]
    pub items: Vec<LineItem>,
    #[validate(length(max = 32))]
    pub coupon_code: Option<String>,
    pub shipping_address_id: Uuid,
}

pub struct ValidatedJson<T>(pub T);

impl<S, T> FromRequest<S> for ValidatedJson<T>
where S: Send + Sync, T: DeserializeOwned + Validate {
    type Rejection = AppError;
    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let Json(value) = Json::<T>::from_request(req, state).await.map_err(|e| AppError::Malformed(e.body_text()))?;
        value.validate().map_err(|e| AppError::Validation(to_field_errors(e)))?;
        Ok(ValidatedJson(value))
    }
}
```

`deny_unknown_fields` for strict inputs. `garde` is the newer alternative
with the same idea. Money as `i64` minor units or `rust_decimal`; time as
`time::OffsetDateTime` or `chrono::DateTime<Utc>` with serde features
enabled; IDs as `Uuid` (parse failure is a 400 for free via the extractor).
Convert input structs to domain types (newtypes like `Sku(String)`) in the
service.

## 7. The async runtime and blocking

tokio's worker threads are few (one per core). Any blocking call on them
(`std::fs`, `std::thread::sleep`, sync DB drivers, CPU-heavy hashing,
`reqwest::blocking`) stalls every task on that worker. Rules:

- Use async-native crates: `tokio::fs`, `tokio::time::sleep`, `sqlx`,
  `reqwest` (async), `redis` with `tokio-comp`.
- CPU-bound or sync-only work goes in `tokio::task::spawn_blocking` (the
  blocking pool is large, 512 by default) or `rayon` for parallel compute.
  Argon2 password hashing is the common case: `spawn_blocking(move ||
  argon2.hash_password(...))`.
- Hold no `std::sync::Mutex` guard across an `.await`; it blocks the
  worker and deadlocks easily. Use `tokio::sync::Mutex` only when you
  must hold across awaits; otherwise `std::sync::Mutex` with short
  critical sections is faster.
- `tokio::spawn` detaches; keep the `JoinHandle` or use `JoinSet`/
  `TaskTracker` so errors are not lost and shutdown can wait.
- Timeouts: `tokio::time::timeout(Duration::from_secs(3), fut).await`;
  reqwest `Client::builder().connect_timeout(..).timeout(..)`.
- Bound fan-out with `tokio::sync::Semaphore` or `futures::stream::
  iter(..).buffer_unordered(8)`.
- `#[tokio::main(flavor = "multi_thread")]` for servers; `current_thread`
  for tests or tiny tools.

## 8. Sharing state: Arc, Mutex, RwLock, channels

- Immutable shared config: `Arc<Config>`. Connection pools are already
  `Clone` + internally shared (`PgPool`, `reqwest::Client`); do not wrap
  them in `Mutex`.
- Mutable shared state inside one process (an in-memory cache, a rate
  limiter): `Arc<Mutex<T>>` or `Arc<RwLock<T>>` with `parking_lot` or std;
  `DashMap` for concurrent maps; `moka` for a real cache with TTL. Remember
  that in-process state does not survive restarts or span instances; use
  Redis for anything that must.
- Background work communicates via `tokio::sync::mpsc` (bounded; the
  bound is your backpressure), `broadcast` for fan-out, `watch` for
  config/shutdown signals, `oneshot` for replies.
- Request-scoped data (actor, request ID) travels in `Request::extensions`
  or `tracing` span fields, not in `AppState`.

## 9. tower middleware

`tower-http` gives you the standard stack: `TraceLayer`, `SetRequestIdLayer`
+ `PropagateRequestIdLayer`, `TimeoutLayer`, `RequestBodyLimitLayer`,
`CorsLayer`, `CompressionLayer`, `CatchPanicLayer`, `NormalizePathLayer`,
`SensitiveHeadersLayer` (so `Authorization` is not logged). Order matters:
`ServiceBuilder` applies top to bottom on the request. Put request ID
first, trace next (so the span has the ID), then timeout, body limit,
auth. Custom middleware: `axum::middleware::from_fn_with_state` for
anything short (auth, rate limiting), `tower::Layer`/`Service` impls for
reusable or performance-critical ones. `tower::limit::ConcurrencyLimitLayer`
and `tower::load_shed::LoadShedLayer` are bulkheads and backpressure in
one line each (`resilience.md`). `tower::retry` exists but retry at the
client level (`reqwest-retry`/`reqwest-middleware`) with a predicate and
budget is clearer.

## 10. Database from the app side (sqlx, sea-orm, diesel)

```rust
pub async fn create(db: &PgPool, actor: &Actor, input: CreateOrder, idem: Option<String>) -> Result<Order, AppError> {
    actor.require(Permission::OrderCreate)?;
    let mut tx = db.begin().await?;
    let order = sqlx::query_as!(OrderRow, r#"INSERT INTO orders (id, user_id, status) VALUES ($1, $2, 'pending') RETURNING id, user_id, status as "status: OrderStatus", created_at"#, Uuid::now_v7(), actor.user_id)
        .fetch_one(&mut *tx).await?;
    // bulk insert items with UNNEST; reserve stock; may return AppError::Conflict
    sqlx::query!("INSERT INTO outbox (id, topic, payload) VALUES ($1, 'order.created', $2)", Uuid::now_v7(), json!({"order_id": order.id}))
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(order.into())
}
```

`PgPoolOptions::new().max_connections(10).acquire_timeout(Duration::from_
secs(3))`; set `statement_timeout` via `after_connect` or the DSN
options. `query!`/`query_as!` check SQL against the database at compile
time (`DATABASE_URL` or `cargo sqlx prepare` for offline CI); use them.
Transactions borrow the pool: pass `&mut *tx` (an `Executor`) into repo
functions, or accept `impl Executor<'_>` generically. No HTTP calls inside
a transaction. N+1: fetch children with `WHERE order_id = ANY($1)` and
group in memory. sea-orm: `find_with_related`/`find_also_related`; diesel:
`belonging_to` + `grouped_by`, and run on `spawn_blocking` or use
`diesel-async`. Schema and index design: `database/references/`.

## 11. Graceful shutdown

```rust
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::load()?;
    init_tracing(&config)?;
    let state = AppState::new(&config).await?;
    let app = router(state.clone());

    let listener = tokio::net::TcpListener::bind(&config.addr).await?;
    tracing::info!(addr = %config.addr, "listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    state.db.close().await;                 // after serve returns: in-flight requests done
    opentelemetry::global::shutdown_tracer_provider();
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async { tokio::signal::ctrl_c().await.expect("ctrl-c handler") };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("sigterm handler").recv().await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
    tracing::info!("shutdown signal received");
}
```

`with_graceful_shutdown` stops accepting and waits for in-flight
connections; wrap the whole `serve` in `tokio::time::timeout` if you need
a hard cap below the orchestrator's grace period. Flip a readiness flag
(`Arc<AtomicBool>` checked by `/readyz`) before draining so the load
balancer stops routing. Background tasks: a `watch` channel or
`CancellationToken` (`tokio-util`) they listen on, plus a `TaskTracker`
you `wait()` on. actix: `HttpServer::shutdown_timeout(25)` and it handles
signals itself.

## 12. Logging and tracing

`tracing` is the standard; structured fields are first-class.

```rust
fn init_tracing(config: &Config) -> anyhow::Result<()> {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tower_http=info,sqlx=warn"));
    let fmt = if config.env == Env::Development { tracing_subscriber::fmt::layer().pretty().boxed() } else { tracing_subscriber::fmt::layer().json().flatten_event(true).boxed() };
    tracing_subscriber::registry().with(filter).with(fmt).init();
    Ok(())
}

// in a handler or service
tracing::info!(order_id = %order.id, total_minor = order.total_minor, "order created");
```

`TraceLayer::new_for_http().make_span_with(...)` creates a span per request
with `request_id`, method, path; everything logged inside the request
inherits those fields. `#[tracing::instrument(skip(db), fields(order_id =
%id))]` on service functions adds spans with arguments (skip secrets and
large payloads). `tracing-opentelemetry` exports spans; `Debug` for errors
(`error = ?e`) prints the context chain from `anyhow`. Field conventions
in `observability.md`.

## 13. Testing

- Unit tests next to the code (`#[cfg(test)] mod tests`) for domain
  logic; no runtime needed.
- Handler tests with `tower::ServiceExt::oneshot` against `router(state)`
  without a socket:

```rust
#[sqlx::test(migrations = "./migrations")]
async fn bad_payload_returns_problem_details(pool: PgPool) {
    let app = router(test_state(pool));
    let res = app.oneshot(Request::post("/orders").header(CONTENT_TYPE, "application/json").header(AUTHORIZATION, test_token()).body(Body::from(r#"{"items":"nope"}"#)).unwrap()).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(res.headers()[CONTENT_TYPE], "application/problem+json");
    let body: serde_json::Value = serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["code"], "validation_error");
    assert_eq!(body["errors"][0]["field"], "items");
}
```

`#[sqlx::test]` creates a fresh database per test from `DATABASE_URL`,
runs migrations, and drops it; this is the real-database approach with
no fixture juggling. Third-party HTTP: `wiremock` with `ResponseTemplate::
new(500)` and `.set_delay(Duration::from_secs(10))` for the timeout case.
Time: inject a `Clock` trait or use `tokio::time::pause()` in tests.
`cargo nextest` for parallel isolation; `cargo clippy -- -D warnings` and
`cargo fmt --check` in CI; `cargo sqlx prepare --check` to keep the
offline query cache honest.

## 14. Footguns

- **`unwrap()`/`expect()` on input or I/O** → panic → 500 (or a crashed
  task if outside the handler). `?` with `From`.
- **Blocking on a tokio worker** (sync DB, `std::thread::sleep`, argon2
  inline). `spawn_blocking`.
- **`std::sync::Mutex` guard held across `.await`.**
- **`tokio::spawn` with no handle** → errors vanish, shutdown cannot wait.
- **`reqwest::Client::new()` per request** → no connection reuse, and no
  timeout by default. One client in state, built with timeouts.
- **Cloning a `String` config into every handler** instead of `Arc`.
  Minor, but it compounds.
- **`#[serde(deny_unknown_fields)]` on response types** → breaks
  tolerant readers of upstream APIs; use it on inputs only.
- **Forgetting `Content-Type: application/problem+json`** on errors when
  returning `Json`.
- **Transactions not committed** because `?` returned early; that is
  correct (rollback on drop), but a long-held `tx` across an outbound HTTP
  call holds a pool connection.
- **`sqlx::query` (unchecked) when `query!` would catch the typo** at
  compile time.
- **Body limit unset** → unbounded memory on large uploads.
- **Logging with `{:?}` of a struct containing secrets.** Implement
  `Debug` manually or wrap with `secrecy::SecretString`.
- **Returning `anyhow::Error` from handlers** → everything is a 500 with
  no mapping. Use the `AppError` enum at the boundary.
