# Injection: every class, every mainstream language

Injection happens when data crosses into a parser as code. The fix is the
same for every class: use the mechanism that keeps data and code in
separate channels (bound parameters, argv arrays, autoescaped templates,
typed operators). This file shows what each bug looks like and what the
fix looks like in JS/TS, Python, Go, Java, Ruby and PHP, plus the ORM escape
hatches that reintroduce the bug and the cases (identifiers, `ORDER BY`,
`LIKE`, `IN` lists) where parameterization alone is not enough.

## Contents

1. The one rule and why blocklists fail
2. SQL injection: vulnerable → fixed, per language
3. The cases parameters do not cover: identifiers, ORDER BY, LIKE, IN, LIMIT
4. ORM and query builder escape hatches
5. NoSQL injection: MongoDB operators and friends
6. Command injection: shell-free execution
7. LDAP filter injection
8. Server-side template injection
9. Prototype pollution (JS)
10. Header, log, and CSV injection (brief)
11. Detecting injection in a codebase
12. Tests that prove the fix

## 1. The one rule and why blocklists fail

Every interpreter (SQL engine, shell, LDAP server, template engine, Mongo
query parser) has a grammar. If you build a string and hand it to the
interpreter, the interpreter decides what is code and what is data, using
rules you do not fully know: alternate quote characters, comment syntax,
unicode normalization, encoding differences between your escaping function
and the server's charset, second-order injection where the stored value is
safe today and reinterpreted later. A blocklist is a claim that you know
all of those rules. Parameter binding sidesteps the grammar: the data is
sent separately and the interpreter never parses it as code.

So the fix is never "escape better". It is "stop building the string".
Where a parameter cannot be used (a table name, a sort column), the fix is
an **allowlist mapping** from user-visible tokens to fixed strings you
wrote.

## 2. SQL injection: vulnerable → fixed, per language

### JavaScript / TypeScript (node-postgres, mysql2, better-sqlite3)

```ts
// VULNERABLE: string concatenation; `id` could be "1 OR 1=1" or worse
const r = await pool.query(`SELECT * FROM users WHERE id = ${req.params.id}`);

// FIXED: positional parameters
const r = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);

// mysql2: ? placeholders; use execute() for true server-side prepared statements
const [rows] = await conn.execute('SELECT * FROM users WHERE email = ?', [email]);

// better-sqlite3: named or positional
const row = db.prepare('SELECT * FROM users WHERE email = @email').get({ email });
```

Watch for tagged templates that look safe but are not. `` sql`...${x}` ``
from `slonik`, `postgres` (porsager) or Prisma's `$queryRaw` tagged form
*do* bind parameters; a plain template literal passed to `.query()` does
not. Knex `.raw('... ' + x)` does not; `.raw('... ?', [x])` does.

### Python (psycopg, sqlite3, SQLAlchemy, Django)

```python
# VULNERABLE: f-string / % formatting into the query
cur.execute(f"SELECT * FROM users WHERE email = '{email}'")
cur.execute("SELECT * FROM users WHERE email = '%s'" % email)

# FIXED: driver parameters (psycopg: %s placeholders, values as a separate tuple)
cur.execute("SELECT * FROM users WHERE email = %s", (email,))
# sqlite3 uses ? placeholders
cur.execute("SELECT * FROM users WHERE email = ?", (email,))

# SQLAlchemy Core / 2.0 text(): bound parameters with :name
from sqlalchemy import text
conn.execute(text("SELECT * FROM users WHERE email = :email"), {"email": email})

# Django ORM is parameterized; the raw escape hatches need params too
User.objects.raw("SELECT * FROM app_user WHERE email = %s", [email])      # ok
User.objects.extra(where=[f"email = '{email}'"])                           # VULNERABLE
with connection.cursor() as c:
    c.execute("UPDATE app_user SET last = %s WHERE id = %s", [now, uid])   # ok
```

The classic Python trap: `cur.execute("... %s" % x)` looks like a
placeholder but the `%` operator formats the string *before* `execute`
sees it. The comma is the whole difference.

### Go (database/sql, sqlx, pgx, GORM)

```go
// VULNERABLE
row := db.QueryRow("SELECT * FROM users WHERE id = " + id)
row  = db.QueryRow(fmt.Sprintf("SELECT * FROM users WHERE name = '%s'", name))

// FIXED: placeholders ($1 for Postgres, ? for MySQL/SQLite)
row := db.QueryRowContext(ctx, "SELECT * FROM users WHERE id = $1", id)

// sqlx named parameters
rows, err := db.NamedQuery(`SELECT * FROM users WHERE email = :email`, map[string]any{"email": email})

// GORM: the Where string is parameterized; interpolating into it is the bug
db.Where("name = ?", name).First(&u)                       // ok
db.Where(fmt.Sprintf("name = '%s'", name)).First(&u)       // VULNERABLE
db.Raw("SELECT * FROM users WHERE id = ?", id).Scan(&u)    // ok
db.Order(userSuppliedColumn)                               // VULNERABLE (identifier; see §3)
```

### Java (JDBC, JPA/Hibernate, Spring Data, jOOQ)

```java
// VULNERABLE: Statement with concatenation
Statement st = conn.createStatement();
ResultSet rs = st.executeQuery("SELECT * FROM users WHERE email = '" + email + "'");

// FIXED: PreparedStatement
PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE email = ?");
ps.setString(1, email);
ResultSet rs = ps.executeQuery();

// JPQL / HQL: concatenation is just as injectable as SQL
em.createQuery("SELECT u FROM User u WHERE u.email = '" + email + "'");   // VULNERABLE
em.createQuery("SELECT u FROM User u WHERE u.email = :email", User.class)
  .setParameter("email", email);                                         // ok

// Spring Data @Query: parameters are bound; SpEL concatenation is not
@Query("SELECT u FROM User u WHERE u.email = :email") Optional<User> byEmail(@Param("email") String email);

// jOOQ: the DSL is safe; DSL.field(String) and plain SQL with inlined strings are not
ctx.selectFrom(USERS).where(USERS.EMAIL.eq(email)).fetch();              // ok
ctx.fetch("select * from users where email = '" + email + "'");          // VULNERABLE
ctx.fetch("select * from users where email = ?", email);                 // ok
```

### Ruby (ActiveRecord, Sequel)

```ruby
# VULNERABLE: string interpolation into where/find_by_sql/order
User.where("email = '#{params[:email]}'")
User.find_by_sql("SELECT * FROM users WHERE name = '#{name}'")

# FIXED: placeholders or hash conditions
User.where("email = ?", params[:email])
User.where(email: params[:email])
User.find_by_sql(["SELECT * FROM users WHERE name = ?", name])

# Also injectable in ActiveRecord: order, group, having, select, joins, pluck
User.order(params[:sort])                 # VULNERABLE (Rails 6+ raises on obvious cases, not all)
User.order(Arel.sql(safe_sort))           # only with an allowlisted value, see §3
User.pluck(params[:column])               # VULNERABLE

# Sequel
DB[:users].where(email: email)                         # ok
DB[:users].where(Sequel.lit("email = ?", email))       # ok
DB[:users].where("email = '#{email}'")                 # VULNERABLE
```

Brakeman flags most of these; run it on any Rails codebase.

### PHP (PDO, mysqli, Laravel Eloquent, Doctrine)

```php
// VULNERABLE
$r = $pdo->query("SELECT * FROM users WHERE email = '$email'");
$r = mysqli_query($conn, "SELECT * FROM users WHERE id = " . $_GET['id']);

// FIXED: prepared statements
$st = $pdo->prepare('SELECT * FROM users WHERE email = :email');
$st->execute(['email' => $email]);

$st = $mysqli->prepare('SELECT * FROM users WHERE id = ?');
$st->bind_param('i', $id);
$st->execute();

// Laravel: Eloquent/Query Builder bind; the *Raw methods take bindings as a 2nd arg
User::where('email', $email)->first();                                  // ok
User::whereRaw("email = '$email'")->first();                            // VULNERABLE
User::whereRaw('email = ?', [$email])->first();                         // ok
DB::select('select * from users where id = :id', ['id' => $id]);        // ok
User::orderBy($request->sort)                                           // VULNERABLE (identifier)

// Doctrine DQL
$em->createQuery("SELECT u FROM User u WHERE u.email = '$email'");      // VULNERABLE
$em->createQuery('SELECT u FROM User u WHERE u.email = :email')->setParameter('email', $email);
```

Set `PDO::ATTR_EMULATE_PREPARES => false` so the server, not the PHP
driver, does the binding; emulated prepares have had charset-related
bypasses historically.

## 3. The cases parameters do not cover

Parameters bind *values*. They cannot bind identifiers (table/column
names), keywords (`ASC`/`DESC`), or structure (number of `IN` items). For
these, map user input to constants you wrote.

### ORDER BY / sort column

```ts
// VULNERABLE: identifier from input
const sort = req.query.sort;                        // "name; DROP TABLE users--"
await db.query(`SELECT * FROM users ORDER BY ${sort}`);

// FIXED: allowlist mapping; anything else falls back or 400s
const SORT_COLUMNS: Record<string, string> = { name: 'name', created: 'created_at', email: 'email' };
const DIRECTIONS = { asc: 'ASC', desc: 'DESC' } as const;
const col = SORT_COLUMNS[String(req.query.sort)] ?? 'created_at';
const dir = DIRECTIONS[String(req.query.dir) as keyof typeof DIRECTIONS] ?? 'DESC';
await db.query(`SELECT * FROM users ORDER BY ${col} ${dir} LIMIT $1`, [limit]);
```

The interpolated values are *your* constants, never the request value.
Same pattern in every language. In Rails:
`User.order(SORT_MAP.fetch(params[:sort], "created_at") => :desc)`. In
Django, `qs.order_by(SORT_MAP.get(sort, "-created_at"))`.

### LIKE patterns

Parameters stop injection but `%` and `_` are still wildcards inside the
value. If the user should not be able to search with wildcards, escape
them and declare the escape char:

```sql
WHERE name LIKE $1 ESCAPE '\'   -- with $1 = escapeLike(input) + '%'
```

```ts
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);
```

This is a correctness/DoS concern (a `%%%` search scans the table), not an
injection one, but it is routinely confused with it.

### IN lists

Generate one placeholder per element; never join the values.

```python
ids = [int(x) for x in request.args.getlist("id")]   # also validates type
placeholders = ",".join(["%s"] * len(ids))
cur.execute(f"SELECT * FROM items WHERE id IN ({placeholders})", ids)
# Postgres alternative: WHERE id = ANY(%s) with a list parameter
cur.execute("SELECT * FROM items WHERE id = ANY(%s)", (ids,))
```

The f-string here only inserts `%s` tokens you generated; the data still
goes through the parameter channel. Cap the list length.

### LIMIT / OFFSET

Most drivers allow binding these as integers. If yours does not, cast to
int in your language first and interpolate the integer. `int(x)` cannot
contain SQL.

### Dynamic table names (multi-tenant schemas, sharding)

Allowlist against the known set, or derive from an id you own
(`f"tenant_{tenant.id}"` where `tenant.id` is an integer from your DB), and
quote identifiers with the driver's identifier quoting (`psycopg.sql.Identifier`,
`pq.QuoteIdentifier`, `format("%I")` in Postgres).

## 4. ORM and query builder escape hatches

Every ORM has a door back to strings. Finding those doors is most of a SQL
audit. Grep for these and verify each one binds its parameters:

| Stack | Escape hatches to audit |
|---|---|
| Prisma | `$queryRawUnsafe`, `$executeRawUnsafe` (the `Unsafe` suffix is the tell; `$queryRaw` tagged template is fine) |
| Knex | `.raw(`, `.whereRaw(`, `.orderByRaw(`, `.joinRaw(`, `.havingRaw(` without bindings array |
| TypeORM | `.query(`, `createQueryBuilder().where(string)` with interpolation, `orderBy(userString)` |
| Sequelize | `sequelize.query(` without `replacements`/`bind`, `literal(`, `Sequelize.literal` in `order` |
| Drizzle | `sql.raw(` (vs `` sql`...` `` which binds) |
| Django | `.raw(`, `.extra(`, `RawSQL(`, `cursor.execute(` with `%`/f-string |
| SQLAlchemy | `text(` with f-string, `.execute(string)`, `literal_column(`, `op(` |
| ActiveRecord | `where(string)`, `order(string)`, `pluck(string)`, `select(string)`, `find_by_sql(string)`, `Arel.sql(`, `sanitize_sql_*` misuse |
| GORM | `Raw(`, `Exec(`, `Where(fmt.Sprintf`, `Order(`, `Select(` with variables |
| Hibernate/JPA | `createNativeQuery(`, `createQuery(` with `+`, `Session.createSQLQuery(` |
| Spring Data | `@Query` with SpEL `#{...}` concatenation, `JdbcTemplate.query(string + x)` |
| Eloquent | `whereRaw`, `selectRaw`, `orderByRaw`, `havingRaw`, `DB::raw(`, `DB::statement(` |
| Doctrine | `createNativeQuery`, `$conn->executeQuery(` with concatenation |
| Mongoose | `$where`, string queries, `find(req.body)` (see §5) |

For each hit: does the dynamic part come from a constant/allowlist, or
from a request? If from a request, is it bound or interpolated?

## 5. NoSQL injection: MongoDB operators and friends

Mongo queries are JSON. If a request body is parsed as JSON and passed into
a query, the attacker controls *operators*, not just values.

```ts
// VULNERABLE: req.body.password might be { "$ne": "" }, matching any password
const user = await User.findOne({ email: req.body.email, password: req.body.password });

// Also VULNERABLE: whole body as filter
const docs = await Items.find(req.body);
```

Fixes, in order of preference:

```ts
// 1. Validate shape with a schema so values are strings, not objects
const Login = z.object({ email: z.string().email(), password: z.string().min(1) });
const { email, password } = Login.parse(req.body);

// 2. Coerce explicitly if you cannot schema-validate
const email = String(req.body.email);

// 3. Mongoose: enable sanitizeFilter to strip $-prefixed keys from filter values
mongoose.set('sanitizeFilter', true);           // or per query: .setOptions({ sanitizeFilter: true })

// 4. Use $eq to force value semantics for a single field
await User.findOne({ email: { $eq: email } });
```

Never use `$where` or `mapReduce` with strings built from input: they
execute JavaScript on the server. Query-string parsers (`qs`, Express's
default extended parser) turn `?password[$ne]=` into an object, so this
bug reaches GET handlers too; set `app.set('query parser', 'simple')` or
validate.

Other NoSQL / search engines: Elasticsearch `query_string` with user
input allows field access and heavy queries (use `match`/`multi_match`
with the user string as the value); Redis via `EVAL` with interpolated
Lua is code injection (pass arguments as `KEYS`/`ARGV`); DynamoDB
expressions built from strings can inject attribute names (use
`ExpressionAttributeNames`/`Values`); Firestore/Supabase client filters
are structurally typed and mostly safe, but Supabase `.or('...')` string
filters with interpolation are not.

## 6. Command injection: shell-free execution

The bug is invoking a shell (`/bin/sh -c`) with a string that contains
input. The fix is invoking the program directly with an argument vector,
so there is no shell to interpret `;`, `|`, `$(...)`, backticks or
globbing.

```ts
// VULNERABLE: exec() always spawns a shell
import { exec } from 'node:child_process';
exec(`convert ${inputPath} -resize 100x100 ${outPath}`);

// FIXED: execFile/spawn with argv and no shell
import { execFile } from 'node:child_process';
execFile('convert', [inputPath, '-resize', '100x100', outPath], { shell: false }, cb);
```

```python
# VULNERABLE
subprocess.run(f"ping -c 1 {host}", shell=True)
os.system("tar czf backup.tgz " + path)

# FIXED
subprocess.run(["ping", "-c", "1", host], check=True, timeout=10)
subprocess.run(["tar", "czf", "backup.tgz", "--", path], check=True)
```

```go
// VULNERABLE
exec.Command("sh", "-c", "git log "+ref)

// FIXED
exec.CommandContext(ctx, "git", "log", "--", ref)
```

```java
// VULNERABLE
Runtime.getRuntime().exec("sh -c \"ls " + dir + "\"");

// FIXED: ProcessBuilder with discrete args
new ProcessBuilder("ls", "--", dir).start();
```

```ruby
# VULNERABLE: backticks, system with one string, %x, Kernel#open with "|"
`ls #{dir}`
system("ls #{dir}")

# FIXED: system/spawn with multiple args bypasses the shell
system("ls", "--", dir)
out, status = Open3.capture2("ls", "--", dir)
```

```php
// VULNERABLE
shell_exec("ls " . $dir);
exec("convert $in $out");

// FIXED: escape each argument and still avoid interpolating options;
// or use Symfony Process with an array
$cmd = sprintf('convert %s %s', escapeshellarg($in), escapeshellarg($out));
$p = new Symfony\Component\Process\Process(['convert', $in, $out]);   // preferred
```

Argument-level concerns remain even without a shell:

- **Option injection.** A filename `-rf` or `--output=/etc/passwd` is still
  an argument. Pass `--` before positional args where the tool supports it,
  or validate the value does not start with `-`.
- **Programs that spawn shells themselves** (`ssh host cmd`, `git` aliases,
  `find -exec`, ImageMagick delegates). Treat the remote/sub command as a
  shell string and allowlist it.
- **Environment.** Do not pass request data into env vars that the child
  interprets (`LD_PRELOAD`, `PATH`, `GIT_SSH_COMMAND`).
- **Allowlist the program itself.** Never let the input choose the binary.

If the task is "run user-supplied code", that is sandboxing, not
argument hygiene: containers with no network, seccomp, resource limits,
and a timeout. Do not try to filter.

## 7. LDAP filter injection

LDAP filters have their own grammar: `(&(uid=USER)(objectClass=person))`.
Unescaped `*`, `(`, `)`, `\`, NUL in `USER` change the filter.

```java
// VULNERABLE
String filter = "(&(uid=" + username + ")(objectClass=person))";

// FIXED: Spring LDAP / UnboundID build filters with escaping done for you
Filter f = Filter.createANDFilter(
    Filter.createEqualityFilter("uid", username),
    Filter.createEqualityFilter("objectClass", "person"));
// or escape explicitly: Filter.encodeValue(username) / LdapEncoder.filterEncode(username)
```

```python
# python-ldap
from ldap.filter import escape_filter_chars, filter_format
flt = filter_format("(&(uid=%s)(objectClass=person))", [username])
```

```js
// ldapjs: use the filter object API, or escape with ldap-escape / `filter.escape`
const { EqualityFilter } = require('ldapjs').filters;
const f = new EqualityFilter({ attribute: 'uid', value: username });
```

Distinguished names (DNs) have a *different* escaping than filters
(`,`, `+`, `"`, `\`, `<`, `>`, `;`, leading/trailing spaces, `#`). Use the
library's DN escaper when building a DN from input; using the filter
escaper for a DN is a classic mistake.

## 8. Server-side template injection

Two different bugs share the name:

**A. User input used as the template.** `render_template_string(user_input)`,
`new Function`, Jinja `Template(user_input)`, ERB `ERB.new(user_input)`,
Twig `createTemplate(user_input)`, Freemarker/Velocity/Thymeleaf
expression evaluation of input. This is remote code execution in most
engines, because template languages can reach the runtime. Fix: never
compile a template from input. If users must customize text (email
templates, notification formats), use a **logic-less** engine (Mustache,
Handlebars with no helpers, Liquid in strict mode) *or* a sandboxed engine
(Jinja2 `SandboxedEnvironment`, Twig sandbox extension, Freemarker with
`TemplateClassResolver.ALLOWS_NOTHING_RESOLVER`), and still treat it as
risky.

```python
# VULNERABLE
return render_template_string(f"Hello {request.args['name']}")

# FIXED: static template, input as a variable (also autoescaped)
return render_template("hello.html", name=request.args["name"])
```

**B. Autoescape disabled or bypassed**, which is XSS; see
`xss-and-output-encoding.md`.

Related: `eval`, `new Function`, `vm.runInContext` with strings from input,
Python `eval`/`exec`, Ruby `instance_eval`/`send(user_method)`, PHP
`eval`/`create_function`/`$$var`/`call_user_func($input)`. Replace with a
dispatch table (`{ "add": add, "sub": sub }[op]`) or a real parser for the
expression language you need (e.g. a math expression library).

## 9. Prototype pollution (JS)

Deep merge, recursive assign, or path-set functions (`merge(target,
userJson)`, `_.set(obj, userPath, v)`, `qs` nested parsing) that walk keys
from input can write to `Object.prototype` via `__proto__` or
`constructor.prototype`. Afterwards every object in the process has the
attacker's property, which flips `if (user.isAdmin)` checks and can reach
RCE through template engines or `child_process` option objects.

```js
// VULNERABLE
function merge(target, src) {
  for (const k in src) {
    if (typeof src[k] === 'object' && src[k] !== null) {
      target[k] = merge(target[k] ?? {}, src[k]);
    } else target[k] = src[k];
  }
  return target;
}
merge(config, JSON.parse(req.body));   // body: {"__proto__":{"isAdmin":true}}

// FIXED
function merge(target, src) {
  for (const k of Object.keys(src)) {                       // own keys only
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (typeof src[k] === 'object' && src[k] !== null) {
      if (!Object.hasOwn(target, k)) target[k] = Object.create(null);
      merge(target[k], src[k]);
    } else target[k] = src[k];
  }
  return target;
}
```

Defenses in order: validate the body with a schema that rejects unknown
keys (`z.object({...}).strict()`); use `Map` or `Object.create(null)` for
dictionaries keyed by input; keep `lodash`, `minimist`, `qs`, `yargs-parser`,
`deepmerge` patched (`npm audit` flags the old ones); for a last line,
`Object.freeze(Object.prototype)` at startup breaks some libraries but
kills the whole class.

## 10. Header, log, and CSV injection (brief)

- **HTTP header injection / response splitting**: CR/LF in a value set into
  a header. Modern frameworks reject them; if you set headers by hand
  (raw sockets, custom proxies), reject `\r` and `\n`.
- **Log injection**: newlines in a logged value forge log lines. Use
  structured (JSON) logging where the value is a field, not a substring;
  see `logging-privacy.md`.
- **CSV/formula injection**: a cell starting with `=`, `+`, `-`, `@`, tab or
  CR is executed by spreadsheets on open. When exporting user data to
  CSV, prefix such cells with a single quote or a space, and quote the
  field.
- **Email header injection**: user input in `Subject:` or `To:` with
  newlines adds recipients. Use the mail library's API, not a hand-built
  header block.

## 11. Detecting injection in a codebase

Sinks to grep (then trace each back to its source). The full command set
is in `code-audit-playbook.md`; the short version:

```bash
# SQL string building
rg -n "(query|execute|exec|raw|Raw)\s*\(\s*(f\"|\"|'|\`).*(\+|\$\{|%s|\{\})" --type-add 'code:*.{js,ts,py,go,java,rb,php}' -t code
rg -n "\.raw\(|whereRaw|orderByRaw|\$queryRawUnsafe|find_by_sql|Arel\.sql|createNativeQuery|RawSQL|\.extra\("
# Shell
rg -n "child_process|exec\(|execSync|shell=True|os\.system|popen|Runtime\.getRuntime\(\)\.exec|ProcessBuilder\(\"(sh|bash)|shell_exec|passthru|system\(|\`"
# NoSQL
rg -n "\\\$where|find\(req\.|findOne\(req\.|\.find\(\{.*req\.(body|query)"
# Templates / eval
rg -n "render_template_string|Template\(|new Function|\beval\(|instance_eval|ERB\.new|createTemplate\("
```

Then run `semgrep --config p/sql-injection --config p/command-injection`
(or the language pack), which does the source-to-sink tracing for the
common frameworks.

## 12. Tests that prove the fix

Write the test with hostile-looking but *legitimate* input and assert the
system treats it as data:

```ts
test('search treats SQL metacharacters as literals', async () => {
  await createUser({ name: "O'Brien; DROP TABLE users--" });
  const res = await api.get('/users').query({ q: "O'Brien; DROP TABLE users--" });
  expect(res.status).toBe(200);
  expect(res.body.map((u) => u.name)).toContain("O'Brien; DROP TABLE users--");
  expect(await db.query('SELECT 1 FROM users LIMIT 1')).toBeTruthy(); // table still there
});

test('sort column is allowlisted', async () => {
  const res = await api.get('/users').query({ sort: 'name; DROP TABLE users' });
  expect([200, 400]).toContain(res.status);          // either fallback or reject, never 500
  expect(res.body.error ?? '').not.toMatch(/syntax|SQL/i);
});

test('login rejects operator objects', async () => {
  const res = await api.post('/login').send({ email: 'a@b.c', password: { $ne: '' } });
  expect(res.status).toBe(400);
});

test('filename with shell metacharacters is processed, not interpreted', async () => {
  const marker = path.join(tmp, 'pwned');
  await convert(`x; touch ${marker}`);           // through the real code path
  expect(fs.existsSync(marker)).toBe(false);
});
```

The assertion is about *behavior under legitimate-but-awkward input*, not
about an attack succeeding. That keeps the suite honest and keeps the
repository free of payload lists.

Cross-references: output-side encoding is `xss-and-output-encoding.md`;
path and URL inputs are `ssrf-and-server-side.md`; the scanning workflow is
`security-testing.md`.
