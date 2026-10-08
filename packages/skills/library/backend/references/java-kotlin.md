# Java and Kotlin backends (Spring Boot and friends)

Spring Boot essentials for someone who wants correctness without the
enterprise ceremony: layering, `@ControllerAdvice` for one error envelope,
bean validation, the `@Transactional` pitfalls that cause real bugs, async
and virtual threads, and test slices that run fast. Notes on Quarkus,
Micronaut and Ktor where they differ.

## Contents

1. Detecting the setup
2. Layering without ceremony
3. Controllers and DTOs
4. Validation
5. Exceptions to responses with @ControllerAdvice
6. @Transactional: what it actually does and where it breaks
7. JPA from the app side: N+1, open-in-view, DTO projections
8. Async, scheduling, virtual threads
9. Configuration
10. Logging
11. Testing slices
12. Kotlin specifics
13. Quarkus, Micronaut, Ktor notes
14. Footguns

## 1. Detecting the setup

- Build: `build.gradle.kts`/`build.gradle` or `pom.xml`. Spring Boot
  version in the plugin block; 3.x means Jakarta namespaces (`jakarta.*`
  not `javax.*`), Java 17+, Hibernate 6, Micrometer tracing. Boot 3.2+
  supports virtual threads; 3.4+ is current at the time of writing.
- Starters present: `spring-boot-starter-web` (servlet, Tomcat) vs
  `-webflux` (reactive, Netty; different programming model, do not mix
  blocking JDBC into it); `-data-jpa`, `-data-jdbc` (simpler aggregate
  model), `-security`, `-validation`, `-actuator`, `-amqp`/`-kafka`,
  `spring-modulith` (enforced module boundaries).
- Kotlin: `kotlin("plugin.spring")`, `kotlin("plugin.jpa")`, `jackson-
  module-kotlin`, coroutines (`kotlinx-coroutines-reactor` in WebFlux).
- Mapping: `mapstruct`, hand-written mappers, or Kotlin extension
  functions. Lombok in Java repos (`@RequiredArgsConstructor`, `@Value`).
- Tests: JUnit 5, `spring-boot-starter-test` (AssertJ, Mockito,
  MockMvc), `testcontainers`, `@ServiceConnection`, `rest-assured`,
  `WireMock`/`MockServer`, `ArchUnit`.
- Migrations: Flyway or Liquibase (`database/` owns their content).
- Docs: `springdoc-openapi`.

## 2. Layering without ceremony

Package by feature, keep three layers, skip the fourth and fifth.

```
com.example.orders/
  OrderController.java      transport: DTOs in/out, no logic
  OrderService.java         use cases, @Transactional here
  Order.java                entity + domain rules (methods like cancel())
  OrderRepository.java      Spring Data interface
  OrderDtos.java            records for requests/responses
  OrderNotFoundException.java
com.example.billing/ ...
com.example.shared/
  web/ProblemDetailsAdvice.java
  config/
```

What to skip: a `Mapper` class per entity when a static factory method on
the record does it; an interface for every service when there is one
implementation (Spring does not need the interface for proxies since
CGLIB); `Impl` suffixes; a `Facade` layer in front of services; `DTO`,
`VO`, `BO`, `PO` suffix zoo. Spring Modulith's `@ApplicationModule` and
its `ApplicationModules.verify()` test is the cheap way to keep feature
packages from reaching into each other's internals.

## 3. Controllers and DTOs

```java
@RestController
@RequestMapping("/orders")
class OrderController {
    private final OrderService orders;
    OrderController(OrderService orders) { this.orders = orders; }   // constructor injection, no @Autowired fields

    @PostMapping
    ResponseEntity<OrderResponse> create(@Valid @RequestBody CreateOrderRequest req,
                                         @AuthenticationPrincipal AppUser actor,
                                         @RequestHeader(value = "Idempotency-Key", required = false) String idemKey) {
        var order = orders.create(actor, req.toCommand(), idemKey);
        return ResponseEntity.created(URI.create("/orders/" + order.id())).body(OrderResponse.from(order));
    }

    @GetMapping
    Page<OrderResponse> list(@AuthenticationPrincipal AppUser actor, @Valid ListOrdersQuery q) {
        return orders.list(actor, q).map(OrderResponse::from);
    }
}

record CreateOrderRequest(
    @NotEmpty @Size(max = 100) List<@Valid LineItemRequest> items,
    @Size(max = 32) String couponCode,
    @NotNull UUID shippingAddressId
) {
    CreateOrderCommand toCommand() { /* ... */ }
}
record LineItemRequest(@NotBlank @Size(max = 64) String sku, @Min(1) @Max(1000) int qty) {}
```

Records for DTOs (immutable, concise, Jackson handles them). Never expose
entities from controllers: lazy-loading exceptions, infinite recursion on
bidirectional relations, and leaked columns all follow. Return
`ResponseEntity` when you need status or headers; the bare type otherwise.

Jackson config: `spring.jackson.default-property-inclusion=non_null` only
if the API contract says absent and null are the same; `FAIL_ON_UNKNOWN_
PROPERTIES` is false by default in Boot (tolerant reader), turn it on for
strict inputs if desired; `WRITE_DATES_AS_TIMESTAMPS=false` so `Instant`
is ISO 8601. Use `Instant`/`OffsetDateTime`, not `Date`.

## 4. Validation

`spring-boot-starter-validation` enables Bean Validation. `@Valid` on the
`@RequestBody` parameter triggers it; `@Validated` on the class enables
method-level validation (`@RequestParam @Min(1) int limit`). Failures
raise `MethodArgumentNotValidException` (body) or
`HandlerMethodValidationException`/`ConstraintViolationException`
(params); map both in the advice.

Custom constraints for domain rules that are purely structural (a valid
SKU format); rules that need data (SKU exists) belong in the service and
raise domain exceptions mapped to 404/409. Validation groups are rarely
worth it; separate request records for create vs update are clearer.

## 5. Exceptions to responses with @ControllerAdvice

Spring 6 / Boot 3 has `ProblemDetail` (RFC 9457) built in. Enable
`spring.mvc.problemdetails.enabled=true` for framework errors and extend
`ResponseEntityExceptionHandler` for your own:

```java
@RestControllerAdvice
class ProblemDetailsAdvice extends ResponseEntityExceptionHandler {

    @ExceptionHandler(DomainException.class)
    ProblemDetail domain(DomainException ex, HttpServletRequest req) {
        var pd = ProblemDetail.forStatusAndDetail(ex.status(), ex.getMessage());
        pd.setType(URI.create("https://api.example.com/problems/" + ex.code()));
        pd.setTitle(ex.title());
        pd.setProperty("code", ex.code());
        pd.setProperty("requestId", MDC.get("requestId"));
        return pd;
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex, HttpHeaders h, HttpStatusCode s, WebRequest r) {
        var errors = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> Map.of("field", fe.getField(), "code", fe.getCode(), "message", fe.getDefaultMessage()))
            .toList();
        var pd = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_CONTENT, "Validation failed");
        pd.setProperty("code", "validation_error");
        pd.setProperty("errors", errors);
        pd.setProperty("requestId", MDC.get("requestId"));
        return ResponseEntity.status(422).contentType(MediaType.APPLICATION_PROBLEM_JSON).body(pd);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ProblemDetail conflict(DataIntegrityViolationException ex) {
        var pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "Resource conflicts with existing data");
        pd.setProperty("code", "conflict");
        return pd;
    }

    @ExceptionHandler(Exception.class)
    ProblemDetail fallback(Exception ex, HttpServletRequest req) {
        log.error("unhandled error requestId={}", MDC.get("requestId"), ex);
        var pd = ProblemDetail.forStatus(HttpStatus.INTERNAL_SERVER_ERROR);
        pd.setProperty("code", "internal");
        pd.setProperty("requestId", MDC.get("requestId"));
        return pd;        // never ex.getMessage() to the client
    }
}
```

A `DomainException` base class carrying `status()`, `code()`, `title()`
(and subclasses `OrderNotFoundException`, `InsufficientStockException`)
keeps the mapping table small. Spring Security's 401/403 are produced
before the controller by filters; configure `AuthenticationEntryPoint`
and `AccessDeniedHandler` to write the same envelope, or they will be
plain-text.

## 6. @Transactional: what it actually does and where it breaks

`@Transactional` works through a proxy around the bean. The transaction
begins when a call enters the proxy and commits (or rolls back) when it
returns. Everything below follows from that.

- **Self-invocation does not go through the proxy.** `this.innerTransactional()`
  from a method in the same class runs with no new transaction. Move the
  method to another bean or restructure.
- **Only `public` methods** are proxied (Spring 6 relaxed this for
  CGLIB-based proxies to protected/package-private but leave the habit).
  `final` classes/methods cannot be proxied in Java; Kotlin needs the
  `kotlin-spring` plugin to open them.
- **Checked exceptions do not roll back by default.** Only `RuntimeException`
  and `Error` do. Use `@Transactional(rollbackFor = Exception.class)` or
  (better) unchecked domain exceptions.
- **Catching the exception inside the transactional method** means Spring
  never sees it and commits. If you catch to translate, rethrow something
  unchecked.
- **Put it on the service, not the repository or controller.** One use
  case = one transaction. Spring Data repository methods are already
  transactional individually, which is why two repository calls without a
  service-level `@Transactional` are two transactions (and a partial
  write on failure).
- **`readOnly = true`** on reads: lets Hibernate skip dirty checking and
  lets a router send it to a replica. Use it.
- **Propagation**: `REQUIRED` (default) joins an existing transaction;
  `REQUIRES_NEW` suspends it and starts another (for audit logs that must
  survive rollback; it uses a second connection, mind the pool);
  `NOT_SUPPORTED` for calling a third party from within a transactional
  flow. Nested transactions via savepoints (`NESTED`) only with JDBC.
- **No I/O to other systems inside a transaction.** Sending an email or
  calling Stripe inside `@Transactional` holds a connection for the
  duration and cannot be rolled back. Publish an event and handle it after
  commit: `@TransactionalEventListener(phase = AFTER_COMMIT)` or Spring
  Modulith's event publication registry (outbox, see `jobs-and-async.md`).
- **`@Async` or a new thread inside a transaction** runs outside it; the
  transaction is thread-bound.
- **Timeouts**: `@Transactional(timeout = 5)` and `spring.jpa.properties.
  jakarta.persistence.query.timeout`; a connection pool timeout (`spring.
  datasource.hikari.connection-timeout`) so a saturated pool fails fast.
- **Pool sizing**: HikariCP `maximum-pool-size` 10 is the default and a
  good start; more connections rarely help a database.

```java
@Service
public class OrderService {
    @Transactional
    public Order create(AppUser actor, CreateOrderCommand cmd, String idemKey) {
        policy.assertCan(actor, Permission.ORDER_CREATE);
        var order = Order.create(actor.id(), cmd);                      // domain rules on the entity
        inventory.reserve(order.items());                              // may throw InsufficientStockException (unchecked)
        orders.save(order);
        events.publishEvent(new OrderCreated(order.id()));             // delivered AFTER_COMMIT
        return order;
    }

    @Transactional(readOnly = true)
    public Page<Order> list(AppUser actor, ListOrdersQuery q) { ... }
}
```

## 7. JPA from the app side: N+1, open-in-view, DTO projections

- **Disable open-in-view**: `spring.jpa.open-in-view=false`. The default
  (true) keeps the persistence context open through view rendering/JSON
  serialization, which silently masks N+1 by lazy-loading during
  serialization and holds the connection for the whole request. Turning
  it off makes `LazyInitializationException` surface the problem where
  you can fix it.
- **Fix N+1** with `@EntityGraph(attributePaths = {"items", "customer"})`
  on the repository method, `JOIN FETCH` in JPQL, or `@BatchSize` on the
  collection. Verify with `spring.jpa.show-sql` in tests or
  `datasource-proxy`/`p6spy` query-count assertions.
- **DTO projections** for reads (`interface OrderSummary { UUID getId(); ... }`
  or a record constructor in JPQL `select new ...`) avoid loading entities
  at all and are the fastest option for list endpoints.
- **Pagination with `JOIN FETCH` on collections** loads everything in
  memory (`HHH90003004` warning). Paginate the parent IDs first, then
  fetch children with an `IN` query, or use `@BatchSize`.
- `equals`/`hashCode` on entities: by business key or ID-after-persist,
  never Lombok `@Data` on an entity.
- Optimistic locking with `@Version` and map `ObjectOptimisticLockingFailureException`
  to 409/412.
- Spring Data JDBC is a saner choice for aggregate-oriented models with
  no lazy loading; if the repo uses it, do not add JPA.
- Schema, indexes, query plans: `database/references/`.

## 8. Async, scheduling, virtual threads

- `@Async` needs `@EnableAsync` and a configured executor (the default is
  unbounded-ish `SimpleAsyncTaskExecutor` in older versions; define a
  `ThreadPoolTaskExecutor` with a bounded queue). Exceptions from `void`
  `@Async` methods are lost unless an `AsyncUncaughtExceptionHandler` is
  set; return `CompletableFuture` instead.
- `@Scheduled(cron = "...")` runs on one thread by default; set
  `spring.task.scheduling.pool.size`. In a multi-instance deployment every
  instance runs the schedule; use ShedLock or a DB-backed job runner
  (JobRunr, Quartz clustered, db-scheduler) to run once. See
  `jobs-and-async.md`.
- Virtual threads (Boot 3.2+, Java 21): `spring.threads.virtual.enabled=true`
  makes Tomcat and `@Async` use them. Blocking I/O then scales like
  async without reactive code. Watch for `synchronized` blocks pinning
  carriers (Java 24 fixes most of this) and for connection-pool limits
  becoming the bottleneck.
- WebFlux: only if the repo is already reactive; mixing JDBC into a
  reactive pipeline blocks the event loop. Use R2DBC or `Schedulers.
  boundedElastic()` deliberately.
- Messaging: `spring-kafka`/`spring-amqp` listeners with manual ack,
  idempotent consumers keyed on message ID, dead-letter topics/queues
  configured; `jobs-and-async.md` covers the patterns.

## 9. Configuration

```java
@ConfigurationProperties(prefix = "app.payments")
@Validated
public record PaymentsProperties(@NotBlank String apiKey, @NotNull @DurationMin(millis = 100) Duration timeout, @Min(0) @Max(5) int maxRetries) {}
// @EnableConfigurationProperties(PaymentsProperties.class) or @ConfigurationPropertiesScan
```

Typed, validated at startup, bound from `application.yml` + env vars
(`APP_PAYMENTS_API_KEY`) + profiles (`application-prod.yml`). Avoid
`@Value("${...}")` scattered across beans. Secrets arrive as env vars or
via Vault/Secrets Manager integration (`spring-cloud-vault`,
`spring-cloud-aws-secrets-manager`); never in `application.yml` committed
to git. Actuator: expose `health`, `info`, `prometheus`; lock down
`env`/`configprops`/`heapdump` or disable them in production. More in
`config-and-environments.md`.

## 10. Logging

SLF4J API with Logback (default). JSON in production via `logstash-
logback-encoder` or Boot 3.4+'s `logging.structured.format.console=ecs`.
Put `requestId`, `traceId`, `spanId`, `userId` in the MDC via a filter
(Micrometer Tracing populates `traceId`/`spanId` automatically). Use
parameterized messages (`log.info("order created orderId={} total={}",
id, total)`) and structured arguments (`StructuredArguments.kv("orderId",
id)`) so fields are queryable. Never `e.printStackTrace()`; never log at
`ERROR` for 4xx. Levels and field names in `observability.md`.

## 11. Testing slices

Boot's full context is slow (seconds); slices load only what a layer
needs.

- `@WebMvcTest(OrderController.class)` + `MockMvc` + `@MockBean OrderService`
  for controller behavior: status codes, validation errors, envelope
  shape. Fast.
- `@DataJpaTest` + `@Testcontainers` + `@ServiceConnection` Postgres for
  repository queries against the real database. `@AutoConfigureTestDatabase
  (replace = NONE)` so it does not swap in H2 (H2 is not Postgres; tests
  that pass on H2 and fail in prod are common).
- `@SpringBootTest(webEnvironment = RANDOM_PORT)` + `TestRestTemplate`/
  `WebTestClient` + Testcontainers for a handful of end-to-end flows,
  including the "same Idempotency-Key twice" and "forbidden" cases.
- Plain JUnit for domain entities and pure services with constructor-
  injected fakes; no Spring context at all.
- `WireMock` for third-party HTTP, with a stub that delays past the
  client timeout.
- Share one container across the test JVM (`static` container or
  Testcontainers reuse) to keep CI under control; Spring caches contexts
  with identical configuration, so avoid `@MockBean` variations that
  create new contexts per class.

```java
@WebMvcTest(OrderController.class)
class OrderControllerTest {
    @Autowired MockMvc mvc;
    @MockBean OrderService orders;

    @Test
    void badPayloadReturnsProblemDetails() throws Exception {
        mvc.perform(post("/orders").with(user("alice")).with(csrf())
                .contentType(APPLICATION_JSON).content("{\"items\":\"nope\"}"))
           .andExpect(status().isUnprocessableContent())
           .andExpect(content().contentTypeCompatibleWith(APPLICATION_PROBLEM_JSON))
           .andExpect(jsonPath("$.code").value("validation_error"))
           .andExpect(jsonPath("$.errors[0].field").value("items"));
    }
}
```

## 12. Kotlin specifics

- `kotlin("plugin.spring")` opens `@Component`/`@Transactional` classes so
  proxies work; `kotlin("plugin.jpa")` adds no-arg constructors for
  entities. Without them you get silent "transaction not applied" or
  "no default constructor" at runtime.
- Data classes for DTOs; avoid data classes for JPA entities (generated
  `equals`/`hashCode`/`toString` over lazy relations). Use plain classes
  with `var` properties or Spring Data JDBC.
- Null safety at the boundary: `jackson-module-kotlin` makes missing
  non-null properties fail deserialization (good, 400). Bean Validation
  on Kotlin needs `@field:NotBlank` targeting.
- Coroutines in WebFlux (`suspend fun` controllers) are natural; in MVC
  with virtual threads just write blocking code.
- `runCatching { }` as a try/catch replacement swallows
  `CancellationException` in coroutines; rethrow it.
- `@Transactional` on a `suspend fun` is supported in Spring 6 with
  reactive transaction managers only.

## 13. Quarkus, Micronaut, Ktor notes

Quarkus and Micronaut do DI at build time (no runtime reflection proxies):
the same `@Transactional` self-invocation caveat applies in Quarkus
(interceptors), and JAX-RS (`@Path`, `@POST`) replaces Spring MVC with an
`ExceptionMapper<T>` for the envelope. Quarkus `@Scheduled` and Panache
(active-record flavored JPA) are idiomatic there. Ktor is a thin
framework: routes are DSL, you bring DI (Koin) and validation yourself,
`install(StatusPages)` is where the envelope lives, and `Exposed` or
`jOOQ` replace JPA. The layering and resilience advice is unchanged.

## 14. Footguns

- **Field injection** (`@Autowired private X x`) hides dependencies and
  makes tests need the container. Constructor injection.
- **Entities returned from controllers** → lazy init exceptions,
  recursion, leaked fields.
- **`@Transactional` on a private/self-invoked/final method** → no
  transaction, no error.
- **Checked exception inside `@Transactional`** → commits anyway.
- **Email/HTTP call inside `@Transactional`** → long-held connections,
  unrollbackable side effects. `AFTER_COMMIT` listener or outbox.
- **`open-in-view=true`** hiding N+1 until production load.
- **H2 in tests, Postgres in prod.** Testcontainers.
- **`@SpringBootTest` on every test** → 10-minute suites. Slices and
  plain JUnit.
- **`catch (Exception e) { log.error(...); return null; }`** in services.
- **`ResponseEntity.ok(Map.of("error", ...))`** → 200 with error.
- **`new RestTemplate()` or `WebClient.create()` without timeouts.**
  Configure `connectTimeout`/`readTimeout` via `RestClient.builder()` with
  a `ClientHttpRequestFactory` or Reactor Netty `HttpClient` options; one
  client bean per dependency. See `resilience.md`.
- **Unbounded `@Async` executor** → OOM under load.
- **`@Scheduled` on three instances** → three runs. ShedLock/JobRunr.
- **Actuator `env` and `heapdump` exposed publicly.**
- **Lombok `@Data` on entities.**
- **`java.util.Date` and `LocalDateTime` for instants.** `Instant`.
