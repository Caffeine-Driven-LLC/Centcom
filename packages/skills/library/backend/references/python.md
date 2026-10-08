# Python backends

FastAPI, Django and Flask: request validation with pydantic, the async vs
sync decision and the blocking-call trap, Django ORM patterns from the
application side, background work with Celery, arq and RQ, settings
management, typing that catches real bugs, and pytest shapes that use a
real database.

## Contents

1. Detecting the setup
2. Project shape
3. Validation with pydantic
4. FastAPI handlers, dependencies and errors
5. Django: views, services, DRF, ORM from the app side
6. Flask
7. Async vs sync, honestly
8. Background jobs: Celery, arq, RQ, Dramatiq
9. Settings and configuration
10. Typing that pays for itself
11. Logging
12. Testing with pytest
13. Footguns

## 1. Detecting the setup

- Package manager: `uv.lock` / `pyproject.toml` (uv, poetry, pdm, hatch),
  `requirements*.txt` + `pip`, `Pipfile`. Use the same one.
- Python version: `.python-version`, `requires-python`. 3.11+ gives
  `tomllib`, `ExceptionGroup`, better tracebacks; 3.12+ `type` statement.
- Framework: `fastapi` (+ `uvicorn`/`hypercorn`), `django` (+ `djangorestframework`
  or `django-ninja`), `flask`, `litestar`, `starlette` alone.
- Validation: pydantic v2 (`pydantic>=2`; different API from v1:
  `model_validate`, `model_dump`, `ConfigDict`). Django has forms/serializers.
- ORM: Django ORM, `sqlalchemy` (1.4 vs 2.0 style; async via `asyncpg`),
  `sqlmodel`, `tortoise`, `peewee`, raw `psycopg`.
- Jobs: `celery`, `arq` (asyncio + Redis), `rq`, `dramatiq`, `huey`,
  `django-q2`, `procrastinate` (Postgres-backed), `apscheduler`.
- Linters/typers: `ruff` (lint + format), `mypy` or `pyright`, `black`
  (older repos). Check `pyproject.toml` `[tool.*]` sections.
- Tests: `pytest`, `pytest-django`, `pytest-asyncio`, `httpx.AsyncClient`,
  `factory_boy`, `freezegun`/`time-machine`, `respx`/`responses`.

## 2. Project shape

FastAPI, by feature:

```
app/
  main.py            create_app(): middleware, routers, exception handlers, lifespan
  config.py          Settings (pydantic-settings), loaded once
  deps.py            shared Depends: db session, current actor
  errors.py          AppError + handlers
  logging.py
  orders/
    router.py        transport
    schemas.py       pydantic request/response models
    service.py       use cases
    repo.py          queries
    models.py        ORM models
    tests/
  users/ ...
  jobs/
    tasks.py
```

Django: one app per bounded context (`orders/`, `billing/`), each with
`models.py`, `services.py` (or `services/`), `selectors.py` (read
queries), `api.py`/`views.py`, `serializers.py`, `tasks.py`, `tests/`. The
"services and selectors" convention (HackSoft style guide) is the common
answer to "where does business logic go in Django"; follow it if present,
and if the repo keeps logic in model methods and managers (fat models),
follow that instead. Do not introduce a `domain/`, `usecases/`,
`repositories/` tree into a Django project; the ORM is the repository.

## 3. Validation with pydantic

Request models at the edge, separate from ORM models, separate from
response models.

```python
from decimal import Decimal
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

class LineItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    sku: Annotated[str, Field(min_length=1, max_length=64)]
    qty: Annotated[int, Field(ge=1, le=1000)]

class CreateOrderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: Annotated[list[LineItemIn], Field(min_length=1, max_length=100)]
    coupon_code: Annotated[str | None, Field(max_length=32)] = None
    shipping_address_id: UUID

    @field_validator("coupon_code")
    @classmethod
    def upper(cls, v: str | None) -> str | None:
        return v.upper() if v else v

class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)   # build from ORM objects
    id: UUID
    status: Literal["pending", "paid", "shipped", "cancelled"]
    total_minor: int
    currency: str
    created_at: datetime

class ListOrdersQuery(BaseModel):
    limit: Annotated[int, Field(ge=1, le=100)] = 50
    cursor: str | None = None
    status: Literal["pending", "paid", "shipped", "cancelled"] | None = None
```

`extra="forbid"` rejects unknown keys (good for inputs); leave the default
`ignore` for responses. Use `Decimal` or integer minor units for money,
never `float`. `from_attributes=True` lets `OrderOut.model_validate(orm_obj)`
work. Keep validators pure; no DB lookups in a validator (do that in the
service, where you can return a proper 404/409).

## 4. FastAPI handlers, dependencies and errors

```python
# orders/router.py
from fastapi import APIRouter, Depends, Header, Response, status

router = APIRouter(prefix="/orders", tags=["orders"])

@router.post("", status_code=status.HTTP_201_CREATED, response_model=OrderOut)
async def create_order(
    body: CreateOrderIn,
    response: Response,
    actor: Actor = Depends(current_actor),
    svc: OrderService = Depends(get_order_service),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> OrderOut:
    order = await svc.create(actor, body, idempotency_key=idempotency_key)
    response.headers["Location"] = f"/orders/{order.id}"
    return OrderOut.model_validate(order)

@router.get("", response_model=Page[OrderOut])
async def list_orders(q: Annotated[ListOrdersQuery, Query()], actor: Actor = Depends(current_actor), svc=Depends(get_order_service)):
    return await svc.list(actor, q)
```

`Depends` is the DI mechanism; use it for the DB session, the current
actor, and services. Dependencies can be overridden in tests
(`app.dependency_overrides[get_order_service] = lambda: fake`). Put
`response_model` on every route so output is filtered to the declared
fields (this is what stops `password_hash` leaking) and documented.

Errors in one place:

```python
# errors.py
class AppError(Exception):
    def __init__(self, code: str, status: int, detail: str, errors: list | None = None):
        self.code, self.status, self.detail, self.errors = code, status, detail, errors

def not_found(what: str) -> AppError: return AppError("not_found", 404, f"{what} not found")

def problem(request: Request, status: int, code: str, title: str, errors=None) -> JSONResponse:
    return JSONResponse(
        status_code=status, media_type="application/problem+json",
        content={"type": "about:blank", "title": title, "status": status, "code": code,
                 "instance": str(request.url.path), "requestId": request.state.request_id,
                 **({"errors": errors} if errors else {})},
    )

def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app(request: Request, exc: AppError):
        return problem(request, exc.status, exc.code, exc.detail, exc.errors)

    @app.exception_handler(RequestValidationError)
    async def _val(request: Request, exc: RequestValidationError):
        errors = [{"field": ".".join(str(p) for p in e["loc"][1:]), "code": e["type"], "message": e["msg"]} for e in exc.errors()]
        return problem(request, 422, "validation_error", "Validation failed", errors)

    @app.exception_handler(Exception)
    async def _any(request: Request, exc: Exception):
        logger.exception("unhandled error", extra={"request_id": request.state.request_id})
        return problem(request, 500, "internal", "Internal Server Error")
```

Use `lifespan` (not deprecated `on_event`) to open and close pools:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db = await create_pool(settings.database_url)
    yield
    await app.state.db.close()
```

Uvicorn handles SIGTERM by stopping accept and waiting for in-flight
requests up to `--timeout-graceful-shutdown`; run behind Gunicorn with
uvicorn workers in production for multi-process.

## 5. Django: views, services, DRF, ORM from the app side

Services own writes and transactions; selectors own reads; views are thin.

```python
# orders/services.py
from django.db import transaction

@transaction.atomic
def order_create(*, actor: User, data: CreateOrderIn) -> Order:
    if not actor.has_perm("orders.add_order"):
        raise PermissionDenied
    order = Order.objects.create(customer=actor, status=Order.Status.PENDING)
    OrderItem.objects.bulk_create([OrderItem(order=order, sku=i.sku, qty=i.qty) for i in data.items])
    transaction.on_commit(lambda: send_order_confirmation.delay(order.id))   # never inside the txn
    return order

# orders/selectors.py
def order_list(*, actor: User, status: str | None, limit: int, cursor: str | None) -> QuerySet[Order]:
    qs = Order.objects.filter(customer=actor).select_related("customer").prefetch_related("items").order_by("-created_at", "-id")
    if status: qs = qs.filter(status=status)
    return apply_cursor(qs, cursor)[: limit + 1]
```

`transaction.on_commit` is the single most important Django idiom for
jobs: enqueuing inside `atomic` means the worker may run before the row is
visible (or after a rollback). Use `django-ninja` (pydantic) or DRF
serializers for the transport layer; do not put business logic in
serializers' `create()` beyond mapping.

ORM app-side patterns:

- `select_related` for FK/one-to-one (JOIN), `prefetch_related` for
  reverse FK and M2M (second query with `IN`). Missing these is the N+1.
  Install `nplusone` or `django-silk` in dev; assert query counts in tests
  with `django_assert_num_queries`.
- `.only()`/`.defer()` for wide tables; `.values()` for reports.
- `update_fields=` on `save()`; `F()` expressions for increments
  (`stock=F("stock") - qty`) instead of read-modify-write.
- `select_for_update()` inside `atomic` for row locks; `get_or_create`/
  `update_or_create` are racy without a unique constraint (catch
  `IntegrityError`).
- `bulk_create`, `bulk_update`, `iterator(chunk_size=...)` for large sets.
- `QuerySet` is lazy; `len(qs)` and `if qs:` evaluate it. `qs.exists()`
  and `qs.count()` when that is what you mean.
- `ATOMIC_REQUESTS=True` wraps every view in a transaction; convenient,
  but it holds a connection for the whole request and makes
  `on_commit` fire at the end of the view. Know which mode the repo uses.
- Index and query-plan guidance: `database/references/`.

DRF: `ViewSet` + `Serializer` + `permission_classes`; custom exception
handler (`REST_FRAMEWORK["EXCEPTION_HANDLER"]`) to render the envelope;
`CursorPagination` for lists; `throttle_classes` for rate limits.

## 6. Flask

Blueprints per feature, an app factory, `g` for request-scoped state,
`@app.errorhandler` for the envelope, pydantic (or marshmallow if present)
for validation since Flask has none built in. Flask is sync; run under
Gunicorn with several workers (and `gthread` or `gevent` for I/O-heavy
loads). `flask-sqlalchemy` sessions are scoped per request; commit in the
service, `teardown_appcontext` removes the session. Jobs via Celery or RQ.

```python
bp = Blueprint("orders", __name__, url_prefix="/orders")

@bp.post("")
@login_required
def create_order():
    data = CreateOrderIn.model_validate(request.get_json(force=True))   # ValidationError → 422 via errorhandler
    order = order_service.create(g.actor, data)
    return jsonify(OrderOut.model_validate(order).model_dump()), 201, {"Location": f"/orders/{order.id}"}
```

## 7. Async vs sync, honestly

Async pays when the service is I/O-bound with many concurrent connections
(chat, proxies, fan-out to several APIs per request, websockets). It
costs a stricter discipline: one blocking call in an `async def` stalls
every request on that worker. Sync with multiple processes/threads is
simpler, debuggable, and fast enough for most CRUD APIs.

Rules when you are in async code:

- Every library you call must be async-native (`httpx.AsyncClient`,
  `asyncpg`/SQLAlchemy async, `redis.asyncio`, `aiobotocore`). `requests`,
  `psycopg2`, `boto3`, `time.sleep`, file I/O, `bcrypt` are blocking.
- Wrap unavoidable blocking calls: `await asyncio.to_thread(fn, *args)` or
  `run_in_executor`. FastAPI runs plain `def` endpoints in a threadpool
  automatically; `async def` endpoints run on the loop. A `def` endpoint
  that is I/O-bound is fine; an `async def` endpoint calling `requests` is
  the trap.
- Django: the ORM is sync; in async views use `await Model.objects.aget()`
  (4.1+) or `sync_to_async`. Mixing carelessly raises
  `SynchronousOnlyOperation`.
- Bound concurrency: `asyncio.Semaphore(10)` around fan-outs;
  `asyncio.TaskGroup` (3.11+) for structured concurrency so a failure
  cancels siblings and exceptions are not lost. Never `create_task` and
  forget the handle (garbage collected, exception swallowed).
- Timeouts: `asyncio.timeout(3)` (3.11+) or `httpx.Timeout(connect=1,
  read=3, write=3, pool=1)`.
- Detect blocking in dev: `PYTHONASYNCIODEBUG=1` or `loop.slow_callback_
  duration`.

If the repo is sync, stay sync. Do not convert one endpoint to async.

## 8. Background jobs: Celery, arq, RQ, Dramatiq

Patterns that apply to all of them; mechanics in `jobs-and-async.md`.

Celery:

```python
@shared_task(
    bind=True, acks_late=True, autoretry_for=(TransientError,), retry_backoff=True,
    retry_backoff_max=600, retry_jitter=True, max_retries=5, time_limit=120, soft_time_limit=100,
)
def send_order_confirmation(self, order_id: int) -> None:
    order = Order.objects.select_related("customer").get(pk=order_id)   # re-fetch; never pass ORM objects
    if order.confirmation_sent_at:                                      # idempotency
        return
    mailer.send(...)
    Order.objects.filter(pk=order_id, confirmation_sent_at__isnull=True).update(confirmation_sent_at=now())
```

Pass IDs, not objects (serialization, staleness). `acks_late=True` plus
idempotent handlers gives at-least-once; the default `acks_late=False`
loses the job if the worker dies mid-task. Set `task_time_limit`. Use
`task_routes` to separate queues for slow vs fast tasks. Celery Beat for
schedules (`django-celery-beat` to store them in the DB). `task_always_
eager=True` in tests is convenient but hides serialization bugs; have at
least one test that runs through the broker.

arq (asyncio): `WorkerSettings` with `functions`, `cron_jobs`, `max_tries`,
`job_timeout`; `await redis.enqueue_job("send_confirmation", order_id,
_job_id=f"confirm:{order_id}")` for dedup. RQ: simple, sync, `Retry(max=3,
interval=[10, 60, 300])`, `job_timeout`. Dramatiq: `@dramatiq.actor
(max_retries=5, min_backoff=1000, time_limit=120000)`.

Procrastinate or `django-q2` with the Postgres broker when the repo has no
Redis and the volume is modest; they give you transactional enqueue for
free.

## 9. Settings and configuration

```python
# config.py
from pydantic import PostgresDsn, RedisDsn, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
    env: Literal["development", "test", "staging", "production"] = "development"
    database_url: PostgresDsn
    redis_url: RedisDsn
    secret_key: SecretStr
    stripe_api_key: SecretStr
    http_timeout_seconds: float = 3.0
    log_level: str = "INFO"

settings = Settings()   # fails at import with a clear error if a required var is missing
```

`SecretStr` prevents accidental logging (`repr` is `**********`). Django:
`settings.py` reads `os.environ` once via `django-environ` or `pydantic-
settings`; split `settings/base.py`, `local.py`, `production.py` if the
repo does; never commit `.env`. More in `config-and-environments.md`.

## 10. Typing that pays for itself

- Type every function signature in services and repos; let inference do
  locals. `mypy --strict` or `pyright` in `strict` mode for new modules if
  the repo is close; otherwise match the repo's level and never add
  `# type: ignore` without a reason comment.
- `TypedDict`/pydantic for shaped dicts; `Literal` for enums in APIs;
  `Enum` for domain states; `NewType("OrderId", UUID)` when IDs get mixed
  up.
- `Protocol` for dependency interfaces (`class Mailer(Protocol): def send
  (self, ...) -> None: ...`) so services can take a fake in tests without
  inheritance.
- `Result`-style returns are not idiomatic Python; raise typed exceptions
  from the domain (`class InsufficientStock(DomainError)`) and map them in
  one place. Do not catch `Exception` in services.
- `django-stubs` / `djangorestframework-stubs`, `types-requests`,
  `sqlalchemy[mypy]` for third-party types.

## 11. Logging

Use `structlog` if present, otherwise stdlib `logging` with a JSON
formatter (`python-json-logger`) in production and a readable one in dev.
Bind `request_id` via a contextvar in middleware so every log line in the
request carries it:

```python
import structlog
log = structlog.get_logger()

# middleware
structlog.contextvars.clear_contextvars()
structlog.contextvars.bind_contextvars(request_id=request_id, path=request.url.path)
# anywhere
log.info("order_created", order_id=str(order.id), total_minor=order.total_minor)
```

`logger.exception(...)` inside `except` to capture the traceback once;
`logger.error(..., exc_info=True)` elsewhere. Never `print`. Never log
`request.body` or headers wholesale. Field conventions and levels in
`observability.md`.

## 12. Testing with pytest

- Real database. `pytest-django` wraps each test in a transaction and
  rolls back (`@pytest.mark.django_db`); for FastAPI + SQLAlchemy, a
  session fixture that begins a transaction and rolls back, or
  testcontainers Postgres with `TRUNCATE` between tests. Do not mock the
  ORM.
- HTTP through the app: `httpx.AsyncClient(transport=ASGITransport(app=app))`
  for FastAPI, Django's `client` / DRF `APIClient`, Flask `app.test_client()`.
- Override dependencies for third parties (`app.dependency_overrides`),
  stub outbound HTTP with `respx` (httpx) or `responses` (requests).
  Include a timeout test and a 500 test.
- `factory_boy` factories over fixture JSON; `freezegun`/`time-machine`
  for time; fixed `random.Random(seed)` injected for randomness.
- Celery: `CELERY_TASK_ALWAYS_EAGER` for most tests plus one broker-backed
  test; call `task.apply(args=...)` directly in unit tests.
- `pytest -x -q --reuse-db` locally; `pytest-xdist -n auto` with a DB per
  worker in CI. Mark slow tests and run them in a separate job.

```python
@pytest.mark.django_db
def test_create_order_twice_with_same_idempotency_key_creates_one(api_client, user, django_assert_num_queries):
    api_client.force_authenticate(user)
    body = {"items": [{"sku": "ABC", "qty": 2}], "shipping_address_id": str(user.address.id)}
    r1 = api_client.post("/orders", body, format="json", HTTP_IDEMPOTENCY_KEY="k1")
    r2 = api_client.post("/orders", body, format="json", HTTP_IDEMPOTENCY_KEY="k1")
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"]
    assert Order.objects.count() == 1

def test_bad_payload_returns_problem_details(api_client, user):
    api_client.force_authenticate(user)
    r = api_client.post("/orders", {"items": "nope"}, format="json")
    assert r.status_code == 422
    assert r["Content-Type"].startswith("application/problem+json")
    assert r.json()["code"] == "validation_error"
    assert r.json()["errors"][0]["field"] == "items"
```

## 13. Footguns

- **Blocking call in `async def`** (`requests.get`, `time.sleep`, sync
  ORM) stalls the event loop for every request.
- **Mutable default argument** (`def f(items=[])`) shared across calls.
  Use `None` and create inside.
- **`except Exception: pass`** or `except: return None`. Swallowed errors,
  silent data loss. Catch specific exceptions; re-raise or translate.
- **Enqueuing inside `transaction.atomic`** without `on_commit`: the
  worker runs before the commit.
- **Passing ORM objects to Celery**. Pass IDs.
- **Naive datetimes**. `USE_TZ=True` in Django; `datetime.now(tz=UTC)`
  everywhere; never `datetime.utcnow()` (naive, deprecated).
- **`float` for money**.
- **`QuerySet` evaluated in a loop** (N+1). `select_related`/`prefetch_
  related`; assert query count in a test.
- **`get_or_create` without a unique constraint** races under concurrency.
- **Settings read via `os.environ[...]` scattered across modules**.
  Centralize in `Settings`.
- **Gunicorn sync workers with a long upstream call** → worker exhaustion.
  Use timeouts, `gthread`, or move to a job.
- **`DEBUG=True` in a deployed environment** leaks settings and SQL in
  error pages.
- **Logging `request.POST` or `request.body`** with passwords in it.
- **`pytest` tests that hit the real third-party API** because nobody
  stubbed it. Stub with `respx`/`responses`; fail the test suite on
  unexpected outbound requests (`respx.mock(assert_all_mocked=True)`).
