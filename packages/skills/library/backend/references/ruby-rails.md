# Ruby and Rails backends

Rails rewards following its conventions and punishes fighting them. This
covers where business logic goes (the service object debate, honestly),
controllers and strong params, API mode with the error envelope, ActiveJob
with Sidekiq/GoodJob/Solid Queue, concerns used well, N+1 with Bullet,
and the test shape. Notes for Sinatra/Hanami/Grape where they differ.

## Contents

1. Detecting the setup
2. Where logic goes: models, service objects, and the debate
3. Controllers, strong params, form objects
4. The error envelope in API mode
5. Authorization placement (Pundit, CanCanCan, Action Policy)
6. ActiveRecord from the app side: N+1, transactions, locking
7. ActiveJob: Sidekiq, GoodJob, Solid Queue
8. Concerns, done well
9. Configuration and credentials
10. Logging
11. Testing
12. Sinatra, Hanami, Grape
13. Footguns

## 1. Detecting the setup

- `Gemfile.lock`: Rails version (7.1+ has `normalizes`, composite keys,
  async queries; 7.2/8 ship Solid Queue, Solid Cache, authentication
  generator). Ruby version in `.ruby-version`.
- API mode: `config.api_only = true` in `config/application.rb`, or
  `ActionController::API` base class. Full-stack apps use `ActionController::Base`
  with views, Turbo and Hotwire (`turbo-rails`, `stimulus-rails`).
- Auth: `devise`, `devise-jwt`, `rodauth`, `sorcery`, `omniauth`,
  Rails 8's built-in `bin/rails generate authentication`, `doorkeeper`
  (OAuth provider).
- Authorization: `pundit`, `cancancan`, `action_policy`.
- Jobs: `sidekiq` (Redis), `good_job` (Postgres), `solid_queue` (DB,
  Rails 8 default), `delayed_job`, `resque`. Check `config.active_job.
  queue_adapter`.
- Serialization: `jbuilder`, `active_model_serializers`, `blueprinter`,
  `alba`, `jsonapi-serializer`, or `as_json` overrides.
- Service layer: `app/services/`, `app/interactors/` (`interactor` gem),
  `app/operations/` (`dry-transaction`, `trailblazer`), `app/commands/`.
  Use whichever exists.
- Lint/test: `rubocop` with `rubocop-rails`/`rubocop-rspec`, `rspec-rails`
  or Minitest, `factory_bot_rails`, `faker`, `webmock`/`vcr`, `bullet`,
  `shoulda-matchers`, `simplecov`.

## 2. Where logic goes: models, service objects, and the debate

The honest state of the field:

- **Rails' own position** ("vanilla Rails is plenty", Basecamp/37signals
  style): rich models with well-named methods, callbacks used sparingly,
  concerns to group behavior, controllers that call one model method.
  Works well when the domain maps cleanly to records and the team is
  disciplined about model size.
- **Service objects** (`app/services/Orders::Create`): one class per use
  case with a `call` method, orchestrating several models, a transaction,
  and job enqueuing. Works well when operations span multiple records or
  external systems. Degenerates into procedural code that bypasses the
  models' invariants if every tiny thing becomes a service.
- **Both**: models own invariants and single-record behavior (`order.
  cancel!`), services own multi-record workflows (`Orders::Checkout`).
  This is where most mature Rails codebases land.

Decide by reading `app/`. If `app/services/` exists, add services in the
same shape (class per use case, same `call` signature, same return
convention: the record, a `Result`, or raise). If it does not, and the
operation touches one aggregate, put it on the model. Do not add
`dry-monads` or `trailblazer` to a codebase that returns records and
raises.

```ruby
# app/services/orders/create.rb
module Orders
  class Create
    Result = Struct.new(:order, :error, keyword_init: true) do
      def success? = error.nil?
    end

    def initialize(actor:, params:, idempotency_key: nil)
      @actor, @params, @idempotency_key = actor, params, idempotency_key
    end

    def call
      Order.transaction do
        order = @actor.orders.create!(status: :pending, shipping_address_id: @params[:shipping_address_id])
        order.items.insert_all!(@params[:items].map { |i| { sku: i[:sku], qty: i[:qty] } })
        Inventory::Reserve.new(order).call                    # raises Inventory::Insufficient
        OrderConfirmationJob.perform_later(order.id)          # ActiveJob enqueues after commit by default (Rails 7.2+)
        Result.new(order:)
      end
    rescue Inventory::Insufficient => e
      Result.new(error: e)
    end
  end
end
```

Keep `call` short, keep the transaction inside the service (not the
controller), raise domain errors as named exception classes, and let the
controller decide the HTTP mapping.

## 3. Controllers, strong params, form objects

```ruby
class OrdersController < ApplicationController
  before_action :authenticate!

  def create
    result = Orders::Create.new(actor: current_user, params: order_params, idempotency_key: request.headers["Idempotency-Key"]).call
    if result.success?
      render json: OrderSerializer.new(result.order), status: :created, location: order_url(result.order)
    else
      render_problem(status: :conflict, code: "insufficient_stock", title: result.error.message)
    end
  end

  def index
    orders = Orders::List.new(actor: current_user, filters: list_params).call
    render json: { data: OrderSerializer.new(orders.records).as_json, pageInfo: orders.page_info }
  end

  private

  def order_params
    params.require(:order).permit(:shipping_address_id, :coupon_code, items: [:sku, :qty])
  end

  def list_params
    params.permit(:limit, :cursor, :status).tap { |p| p[:limit] = p[:limit].to_i.clamp(1, 100) if p[:limit] }
  end
end
```

Strong params control mass assignment; they do not validate types or
ranges. For anything beyond trivial shapes, a form object
(`ActiveModel::Model` + `ActiveModel::Attributes` with validations, or
`dry-validation`/`dry-schema` if present) parses and validates the input
before it reaches the service. Rails 8 adds `params.expect` for stricter
shape checking. Do not put `if params[:items].blank?` logic in controllers;
that is a validation that belongs in the form object.

Controllers stay under ~15 lines per action: auth, parse, call, render.
`rescue_from` in `ApplicationController` handles the known exceptions.

## 4. The error envelope in API mode

```ruby
class ApplicationController < ActionController::API
  include ActionController::MimeResponds

  rescue_from ActiveRecord::RecordNotFound,       with: ->(e) { render_problem(status: :not_found, code: "not_found", title: "Not found") }
  rescue_from ActiveRecord::RecordInvalid,        with: :render_validation_problem
  rescue_from ActionController::ParameterMissing, with: ->(e) { render_problem(status: :bad_request, code: "parameter_missing", title: e.message) }
  rescue_from Pundit::NotAuthorizedError,         with: ->(e) { render_problem(status: :forbidden, code: "forbidden", title: "Not allowed") }
  rescue_from ActionDispatch::Http::Parameters::ParseError, with: ->(e) { render_problem(status: :bad_request, code: "malformed_body", title: "Malformed JSON") }

  private

  def render_problem(status:, code:, title:, detail: nil, errors: nil)
    body = { type: "about:blank", title:, status: Rack::Utils.status_code(status), code:, instance: request.path, requestId: request.request_id, detail:, errors: }.compact
    render json: body, status:, content_type: "application/problem+json"
  end

  def render_validation_problem(e)
    errors = e.record.errors.map { |err| { field: err.attribute.to_s, code: err.type.to_s, message: err.message } }
    render_problem(status: :unprocessable_content, code: "validation_error", title: "Validation failed", errors:)
  end
end
```

`request.request_id` comes from `ActionDispatch::RequestId` (honors
`X-Request-Id` from the proxy) and is tagged in logs via `config.log_tags
= [:request_id]`. Unhandled exceptions in production render Rails' public
500 page as HTML unless you set `config.exceptions_app` or
`config.action_dispatch.show_exceptions = :rescuable` with a JSON-rendering
exceptions app; do that for an API. Do not `rescue_from StandardError` to
render a 500 yourself unless you also report it (Sentry/Honeybadger).

## 5. Authorization placement (Pundit, CanCanCan, Action Policy)

Pundit: `authorize order` in the action (or in the service, passing the
actor), a `OrderPolicy` with `create?`, `show?`, `update?` and a `Scope`
for lists. `verify_authorized` and `verify_policy_scoped` as
`after_action` in the base controller so a forgotten check fails loudly.
Policies are plain Ruby: unit-test them directly. CanCanCan: abilities in
one `Ability` class; `load_and_authorize_resource` is convenient and
opaque, prefer explicit `authorize! :create, Order`. Action Policy adds
caching and pre-checks. Whichever is present, the check happens with the
loaded record, and list endpoints use the scope, not a filter in the
controller. Policy code and the RBAC/ReBAC trade-offs are in
`auth-implementation.md`.

## 6. ActiveRecord from the app side: N+1, transactions, locking

- `includes` (let AR choose), `preload` (separate query), `eager_load`
  (JOIN) for associations you will touch. `strict_loading` on the model
  or query (`Order.strict_loading.find(id)`) raises on lazy loads;
  `config.active_record.strict_loading_by_default = true` in test is a
  strong N+1 guard. Bullet in development logs/raises on N+1 and unused
  eager loads.
- `find_each`/`in_batches` for large sets; `pluck`/`pick` for columns;
  `exists?` over `present?`; `update_all`/`insert_all`/`upsert_all` for bulk
  (they skip validations and callbacks; know that).
- Counter caches and `size` vs `count` vs `length`: `size` is smart,
  `count` always queries, `length` loads.
- Transactions: `Order.transaction do ... end` wraps the use case;
  exceptions roll back; `ActiveRecord::Rollback` rolls back silently.
  Nested `transaction` blocks join by default; `requires_new: true` for a
  savepoint. `after_commit` callbacks and `ActiveJob` enqueues (7.2+
  default `enqueue_after_transaction_commit`) run after the outer commit;
  on older Rails enqueue in `after_commit` or risk the job running before
  the row exists.
- Locking: `with_lock` / `lock!` for pessimistic row locks inside a
  transaction; `lock_version` column for optimistic (`StaleObjectError`
  → 409/412).
- Callbacks: fine for denormalization inside the same record; avoid
  callbacks that touch other systems or other records (`after_save`
  sending email is the classic trap). Move that to the service or an
  `after_commit` job enqueue.
- Schema and index design: `database/references/`.

## 7. ActiveJob: Sidekiq, GoodJob, Solid Queue

```ruby
class OrderConfirmationJob < ApplicationJob
  queue_as :mailers
  retry_on Net::OpenTimeout, Net::ReadTimeout, wait: :polynomially_longer, attempts: 5
  discard_on ActiveRecord::RecordNotFound                   # order deleted; nothing to do
  limits_concurrency to: 1, key: ->(order_id) { "order:#{order_id}" } if respond_to?(:limits_concurrency)  # Solid Queue

  def perform(order_id)
    order = Order.find(order_id)
    return if order.confirmation_sent_at?                   # idempotent
    OrderMailer.confirmation(order).deliver_now
    order.update_column(:confirmation_sent_at, Time.current)
  end
end
```

Pass IDs (GlobalID works for records but passing the record is still
discouraged because it is reloaded anyway and fails if deleted). Jobs are
retried, so `perform` must be idempotent. `retry_on` with exponential
wait and jitter (`:polynomially_longer` adds jitter in 7.1+); `discard_on`
for permanent failures; let unknown errors bubble to the adapter's retry
and dead set. Sidekiq-specific: `sidekiq_options retry: 5, dead: true`,
unique jobs via `sidekiq-unique-jobs` or Sidekiq Enterprise; Sidekiq runs
jobs concurrently in threads, so no shared mutable state. GoodJob and
Solid Queue are Postgres/DB-backed (transactional enqueue, no Redis);
Solid Queue has recurring tasks in `config/recurring.yml`. Scheduling:
`sidekiq-cron`/`sidekiq-scheduler`, GoodJob cron, Solid Queue recurring,
or `whenever`; never a `loop { sleep }` in a Rake task. Mail: `deliver_
later` always; `deliver_now` only inside a job. More in `jobs-and-async.md`.

## 8. Concerns, done well

A concern is a module for behavior shared by several models or
controllers (`Archivable`, `HasSlug`, `Taggable`) with its own tests. A
concern that is included in exactly one model to make the file shorter is
just hiding size; split the model's responsibilities instead (extract a
service, a value object, or an associated record). Concerns should not
depend on each other's private state. `included do` for scopes,
associations, callbacks; `class_methods do` for class-level API.

## 9. Configuration and credentials

`Rails.application.credentials` (encrypted, per-environment with
`config/credentials/production.yml.enc` and `RAILS_MASTER_KEY` from the
environment) or plain ENV via `ENV.fetch("STRIPE_API_KEY")` (fails fast on
missing). Pick what the repo uses. `config_for(:payments)` loads
`config/payments.yml` with ERB and environments into a typed-ish hash.
`dotenv-rails` for local only. Never `ENV["X"]` (returns nil silently)
for required values; never check in `master.key`. `config.hosts`, `force_
ssl`, `log_level`, and `cache_store` per environment in `config/
environments/*.rb`. More in `config-and-environments.md`.

## 10. Logging

`config.log_tags = [:request_id]` at minimum. For JSON, `lograge` with
`custom_options` adding `user_id`, `params` (filtered), `duration`; or
`rails_semantic_logger`. `config.filter_parameters` already filters
`password`, `token`, `secret` and more in `config/initializers/filter_
parameter_logging.rb`; add your own keys. `Rails.logger.info(event: "order_
created", order_id: order.id)` reads as structured in lograge/semantic
logger. Query logging: `config.active_record.query_log_tags_enabled =
true` annotates SQL with controller/action/job, which is gold for slow
query investigation. Field conventions in `observability.md`.

## 11. Testing

RSpec or Minitest, whatever the repo has. Shape:

- **Model specs** for validations, scopes, state transitions (fast, real
  DB rows via factories, `shoulda-matchers` where it reads well).
- **Service specs** for use cases: happy path, each domain failure, the
  "run twice" case, and `have_enqueued_job`.
- **Request specs** (`spec/requests`), not controller specs, for the HTTP
  contract: status, `content_type`, body shape, auth failures, bad
  payloads. Hit the app with real middleware.
- **Policy specs** for authorization.
- **Job specs** with `perform_now` and `ActiveJob::TestHelper`.
- Real database (transactional fixtures or `database_cleaner` truncation
  for system tests); never stub `Order.find`. Stub HTTP with `webmock`
  (`stub_request(...).to_timeout` for the timeout case) or `vcr`.
  `travel_to` for time. `Bullet` enabled in test with `Bullet.raise = true`
  to fail on N+1. Factories over fixtures when `factory_bot` is present;
  keep factories minimal and use traits.

```ruby
RSpec.describe "POST /orders", type: :request do
  let(:user) { create(:user, :with_address) }
  let(:headers) { auth_headers(user).merge("Content-Type" => "application/json") }

  it "creates one order for the same idempotency key" do
    body = { order: { shipping_address_id: user.addresses.first.id, items: [{ sku: "ABC", qty: 2 }] } }.to_json
    2.times { post "/orders", params: body, headers: headers.merge("Idempotency-Key" => "k1") }
    expect(response).to have_http_status(:created)
    expect(Order.count).to eq(1)
  end

  it "returns problem details for a bad payload" do
    post "/orders", params: { order: { items: "nope" } }.to_json, headers: headers
    expect(response).to have_http_status(:unprocessable_content)
    expect(response.content_type).to start_with("application/problem+json")
    expect(response.parsed_body).to include("code" => "validation_error", "requestId" => be_present)
  end
end
```

## 12. Sinatra, Hanami, Grape

Sinatra: `error` blocks for the envelope, `Rack::Protection`, explicit
JSON parsing (`JSON.parse(request.body.read)` with rescue → 400); bring
your own structure (`lib/` with services). Hanami 2: actions are classes
with `params` schemas (dry-validation) built in, `handle_exception` for
mapping, slices as bounded contexts; follow its layout. Grape: `params do
... end` blocks validate; `rescue_from` for the envelope; `error!(..., 422)`
with a hash body; mount inside Rails routes.

## 13. Footguns

- **Fat controllers** with the transaction and six model calls inline.
  Service or model method.
- **`rescue => e` then `render json: { error: e.message }`** with 200, or
  `rescue nil`. Named exceptions, `rescue_from`, correct status.
- **`after_save` sending email or calling an API.** `after_commit` enqueue
  or do it in the service via a job.
- **Enqueuing inside a transaction** on Rails < 7.2 (job runs before
  commit). `after_commit` or the `enqueue_after_transaction_commit` config.
- **`.each` over a relation then `.association`** → N+1. `includes` +
  Bullet + `strict_loading`.
- **`Model.where(...).count` in a view loop** → N+1 counts. Counter cache
  or a grouped query.
- **`update_attribute`/`update_column` to skip validations** as a habit.
  Know when callbacks are intentionally skipped.
- **`ENV["KEY"]` for required config** → nil until production.
- **`params.permit!`** or `params.to_unsafe_h` into `create`.
- **`deliver_now` in a request.**
- **Sidekiq job with a record argument** that gets deleted → job fails
  forever. Pass IDs, `discard_on RecordNotFound`.
- **Non-idempotent job** that charges twice on retry.
- **Default `protect_from_forgery` behavior in API mode** confusion:
  API mode skips CSRF (token auth); full-stack apps need it on. Do not
  disable it to make a fetch work; send the token.
- **Running `rails db:migrate` logic in a controller** or doing schema
  changes outside migrations (`database/` owns migrations).
- **`Time.now`** instead of `Time.current` (ignores the app time zone);
  `Date.today` vs `Date.current`.
