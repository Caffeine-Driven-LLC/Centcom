# Code audit playbook

A systematic process for reviewing an existing codebase for security
issues: map the attack surface, grep for dangerous sinks per language with
the actual commands, trace data flows from source to sink, verify that
every handler is authorized, check secrets, dependencies, headers and
error handling, then produce a prioritized findings report that an
engineering team can act on. Scales from "review this PR" (steps 1, 3, 4
on the diff) to "we inherited this repo" (everything).

## Contents

1. Before starting: scope, access, and ground rules
2. Step 1: Map the attack surface
3. Step 2: Understand the auth and authz architecture
4. Step 3: Sink hunting, per language
5. Step 4: Trace source to sink
6. Step 5: Authorization coverage check
7. Step 6: Secrets, config, and environment
8. Step 7: Dependencies and build
9. Step 8: Runtime checks (if an instance is available)
10. Step 9: Business logic and the threat model
11. Writing the findings report
12. Time budgets and what to skip

## 1. Before starting

- **Scope**: which repos, which services, which environment can be tested,
  what is out of scope (third-party systems, DoS testing). Write it down.
- **Permission**: only test running systems the user owns or has explicit
  authorization to test. Code review of a repo the user gave you is always
  fine; sending requests to a production system is not without their
  say-so.
- **Ground rules for yourself**: every finding is reproduced or labeled
  unconfirmed; severity follows a stated scheme; no payload lists in the
  report (describe the bug and show the fix); do not fix things silently
  during the audit (note, then fix in separate, reviewable commits).
- **Collect context**: README, architecture docs, `SECURITY.md`, previous
  audits/pentest reports, the threat model if one exists, CI config,
  deployment manifests, the ORM and framework versions. Ten minutes here
  saves an hour of guessing.

## 2. Step 1: Map the attack surface

Produce a table of every way data enters. This is the index for the rest
of the audit.

```bash
# Routes: framework-specific; one of these will hit
rg -n "app\.(get|post|put|patch|delete|all|use)\(|router\.(get|post|put|patch|delete|all)\(" --type js --type ts          # Express/Koa/Fastify-ish
rg -n "@(Get|Post|Put|Patch|Delete|All)\(|@Controller\(" --type ts                                                        # NestJS
rg -n "path\(|re_path\(|url\(" --type py -g "urls.py" ; rg -n "@(app|bp|router)\.(route|get|post|put|delete|patch)\(" --type py   # Django / Flask / FastAPI
rg -n "(get|post|put|patch|delete|resources?|match|namespace|scope)\s" config/routes.rb                                  # Rails
rg -n "@(Get|Post|Put|Delete|Patch|Request)Mapping" --type java --type kotlin                                            # Spring
rg -n "Route::(get|post|put|patch|delete|any|resource|apiResource)" routes/                                              # Laravel
rg -n "\.(Handle|HandleFunc|GET|POST|PUT|DELETE|PATCH|Any)\(" --type go                                                  # Go routers
rg -n "(get|post|put|patch|delete|resources?|forward|live|pipe_through)\s" lib/*_web/router.ex                          # Phoenix
# GraphQL: schema files and resolvers
rg -l "type (Query|Mutation)" ; rg -n "resolvers?\s*[:=]|@Resolver|@Mutation|@Query" 
# Websockets / SSE / message consumers / cron
rg -n "socket\.on\(|io\.on\(|ws\.on\(|@SubscribeMessage|channel\.consume|sqs\.receive|@KafkaListener|@RabbitListener|schedule\.|cron\.|@Scheduled|sidekiq|celery\.task|bull|BullMQ"
# File uploads
rg -n "multer|busboy|formidable|request\.files|UploadFile|MultipartFile|\$_FILES|ActiveStorage|CarrierWave|Shrine|multipart"
# Webhooks (inbound) and outbound HTTP
rg -n "webhook|/hooks?/|X-Hub-Signature|Stripe-Signature|svix" -i
rg -n "fetch\(|axios\.|requests\.(get|post)|httpx\.|http\.(Get|Post|NewRequest)|HttpClient|RestTemplate|WebClient|Net::HTTP|Faraday|curl_init|Guzzle"
```

For each entry point record: path/method, authentication required (from
step 2), parameters (path/query/body/headers/files), and the handler
location. A spreadsheet or a markdown table in the audit notes. Mark the
ones reachable anonymously; they get reviewed first.

Also list: admin/debug endpoints (`/admin`, `/actuator`, `/metrics`,
`/graphql` playground, `/_debug`, `/swagger`, `/docs`, `/health` with
details), static file serving configuration, and anything mounted from a
third-party package (`express.static`, Django `static()`, Rails engines,
Spring Boot actuators).

## 3. Step 2: Understand the auth and authz architecture

Before judging any handler, know how identity reaches it.

```bash
# Where does request.user / current_user / principal come from?
rg -n "req\.user\s*=|request\.user|current_user|@AuthenticationPrincipal|SecurityContextHolder|c\.Get\(\"user\"\)|context\.WithValue\(.*user|Auth::user\(\)|conn\.assigns\.current_user|session\[:user_id\]"
# Middleware / guards / decorators that enforce auth
rg -n "requireAuth|ensureAuthenticated|isAuthenticated|@login_required|@permission_required|LoginRequiredMixin|IsAuthenticated|before_action :authenticate|authenticate_user!|@PreAuthorize|@Secured|@UseGuards|AuthGuard|->middleware\(.auth|plug :require_authenticated|jwt\.verify|passport\.authenticate"
# Where authorization decisions live
rg -n "policy|Policy|can\?|cannot\?|authorize!|authorize\(|@PreAuthorize|hasRole|hasAuthority|ability|Ability|casl|casbin|opa|oso|Gate::|\$this->authorize|permission|Permission" -g '!*test*' -g '!node_modules'
# How the session/token is configured
rg -n "express-session|cookie-session|SESSION_ENGINE|session_store|SessionCreationPolicy|jwt\.sign|jsonwebtoken|PyJWT|jose|SameSite|httpOnly|secure:\s*(true|false)"
```

Write a short description: "Auth: session cookie via `express-session`
(Redis store), set in `POST /login`; `requireAuth` middleware reads
`req.session.userId` and loads user; applied per-route (not globally).
Authz: `can(user, action, resource)` helper in `lib/authz.ts`, called
inside some handlers; tenant scoping via `tenantId` column, filtered
manually in each query." That description tells you what to check: every
route has `requireAuth`? every handler calls `can`? every query filters by
tenant?

Read the auth code itself for the classic bugs (`authn-authz-threats.md`):
session regeneration on login, token validation (alg pinned, exp/aud
checked), reset token entropy and single use, uniform error responses,
rate limiting presence, password hashing algorithm and parameters.

## 4. Step 3: Sink hunting, per language

Run these over the source (exclude `node_modules`, `vendor`, `dist`,
tests unless the test code deploys). Every hit is a candidate to trace in
step 4, not a finding yet.

### JavaScript / TypeScript

```bash
EX='-g !node_modules -g !dist -g !build -g !*.min.js'
rg -n $EX "\.query\(\s*(\`|'|\")[^)]*(\$\{|\+)" ; rg -n $EX "\$queryRawUnsafe|\$executeRawUnsafe|\.raw\(|whereRaw|orderByRaw|sequelize\.query\(|\.literal\("
rg -n $EX "child_process|execSync|spawnSync\(.*shell|exec\(" 
rg -n $EX "\.innerHTML\s*=|outerHTML|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML|v-html|\{@html|bypassSecurityTrust|\.html\("
rg -n $EX "\beval\(|new Function\(|vm\.(run|compile)|setTimeout\(\s*['\"]"
rg -n $EX "res\.redirect\(|location\.(href|assign|replace)\s*=|window\.open\("
rg -n $EX "fetch\(\s*[a-zA-Z_.]+\)|axios\.[a-z]+\(\s*[a-zA-Z_.]+|got\(\s*[a-zA-Z_]|request\(\s*\{?\s*url:\s*[a-zA-Z_]"
rg -n $EX "readFile(Sync)?\(|createReadStream\(|sendFile\(|res\.download\(|path\.join\(.*req\."
rg -n $EX "\$where|find\(\s*req\.(body|query)|findOne\(\s*req\.(body|query)|\.find\(\{[^}]*req\.(body|query)\.[a-zA-Z]+\s*\}"
rg -n $EX "Object\.assign\(\s*[a-zA-Z]+,\s*req\.body|\.\.\.req\.body|\.update\(\s*req\.body|\.create\(\s*req\.body"
rg -n $EX "jwt\.decode\(|verify:\s*false|algorithms:\s*\[\s*\]|ignoreExpiration:\s*true"
rg -n $EX "cors\(\s*\)|origin:\s*(true|'\*'|\"\*\")|Access-Control-Allow-Origin.*req\.headers\.origin"
rg -n $EX "rejectUnauthorized:\s*false|NODE_TLS_REJECT_UNAUTHORIZED"
rg -n $EX "Math\.random\(\)" | rg -i "token|secret|key|session|password|code|nonce"
rg -n $EX "createCipher\(|md5|sha1\(" 
rg -n $EX "deserialize\(|node-serialize|unserialize"
rg -n $EX "new RegExp\(\s*[a-zA-Z_]" 
```

### Python

```bash
EX='-g !venv -g !.venv -g !site-packages'
rg -n $EX "\.execute\(\s*(f\"|f'|\"[^\"]*\"\s*%|'[^']*'\s*%|.*\.format\(|.*\+\s*[a-z])" ; rg -n $EX "\.raw\(|\.extra\(|RawSQL\(|text\(\s*f"
rg -n $EX "subprocess\.(run|call|Popen|check_output)\(.*shell\s*=\s*True|os\.system\(|os\.popen\(|commands\."
rg -n $EX "mark_safe\(|\|\s*safe\b|Markup\(|render_template_string\(|autoescape\s*=\s*False|format_html\(.*mark_safe"
rg -n $EX "\beval\(|\bexec\(|compile\(.*exec|__import__\(\s*[a-z]|importlib\.import_module\(\s*[a-z]"
rg -n $EX "pickle\.loads?\(|yaml\.load\((?!.*Loader=yaml\.SafeLoader)|yaml\.unsafe_load|marshal\.loads|shelve|jsonpickle\.decode|torch\.load\("
rg -n $EX "xml\.etree|xml\.dom|xml\.sax|lxml\.etree\.(parse|fromstring|XMLParser)" ; rg -L $EX "defusedxml"
rg -n $EX "requests\.(get|post|put|delete|request)\(\s*[a-z_]|httpx\.[a-z]+\(\s*[a-z_]|urlopen\(\s*[a-z_]|aiohttp.*\.get\(\s*[a-z_]"
rg -n $EX "open\(\s*(os\.path\.join\(.*request|f['\"]|request\.|.*\+\s*(filename|name|path))|send_file\(|send_from_directory\(|FileResponse\("
rg -n $EX "redirect\(\s*(request\.(args|GET|POST|form)|next_url|next\b|url\b)"
rg -n $EX "verify\s*=\s*False|check_hostname\s*=\s*False|CERT_NONE"
rg -n $EX "random\.(random|randint|choice|randrange)\(" | rg -i "token|secret|key|session|password|code|otp|nonce|salt"
rg -n $EX "hashlib\.(md5|sha1)\(|DES|MODE_ECB|AES\.new\([^)]*\)$"
rg -n $EX "DEBUG\s*=\s*True|ALLOWED_HOSTS\s*=\s*\[\s*['\"]\*['\"]|CORS_ALLOW_ALL_ORIGINS\s*=\s*True|CORS_ORIGIN_ALLOW_ALL\s*=\s*True|@csrf_exempt|SESSION_COOKIE_SECURE\s*=\s*False"
rg -n $EX "fields\s*=\s*['\"]__all__['\"]|exclude\s*=\s*\[\]" -g "serializers.py" -g "forms.py"
rg -n $EX "\.objects\.get\(\s*(pk|id)\s*=|get_object_or_404\(\s*[A-Z][A-Za-z]+\s*,\s*(pk|id)\s*=" | rg -v "user=|owner=|tenant=|organization="
```

### Go

```bash
rg -n "fmt\.Sprintf\(\s*\"[^\"]*(SELECT|INSERT|UPDATE|DELETE|WHERE|ORDER BY)" -i ; rg -n "db\.(Query|QueryRow|Exec)(Context)?\(\s*(ctx,\s*)?[a-zA-Z]+\s*\+|\.Raw\(\s*fmt|\.Where\(\s*fmt\.Sprintf|\.Order\(\s*[a-z]"
rg -n "exec\.Command(Context)?\(\s*(ctx,\s*)?\"(sh|bash|cmd)\"|exec\.Command(Context)?\(\s*(ctx,\s*)?[a-z]"
rg -n "text/template" --type go ; rg -n "template\.(HTML|JS|URL|HTMLAttr)\(" --type go
rg -n "http\.(Get|Post|Head)\(\s*[a-z]|http\.NewRequest(WithContext)?\([^,]+,\s*[a-z]|url\.Parse\(\s*r\.(URL|Form|PostForm)"
rg -n "os\.(Open|ReadFile|Create|Remove|Stat)\(\s*(filepath\.Join\([^)]*r\.|r\.URL|r\.Form|path|name|filename)" ; rg -n "http\.ServeFile\(.*r\.URL|http\.FileServer\(http\.Dir\("
rg -n "http\.Redirect\(\s*w,\s*r,\s*r\.(URL|Form)|Redirect\(.*r\.(URL\.Query|FormValue)"
rg -n "InsecureSkipVerify:\s*true|tls\.Config\{\}" 
rg -n "math/rand" --type go | rg -v "_test\.go" ; rg -n "crypto/md5|crypto/sha1|crypto/des|crypto/rc4"
rg -n "jwt\.Parse\(|ParseUnverified|jwt\.ParseWithClaims\(" ; rg -n "SigningMethod" 
rg -n "AllowedOrigins:\s*\[\]string\{\s*\"\*\"|AllowOriginFunc.*return true|Access-Control-Allow-Origin\", r\.Header\.Get"
rg -n "unsafe\.|reflect\.|gob\.NewDecoder" --type go
rg -n "regexp\.MustCompile\(\s*[a-z]|regexp\.Compile\(\s*[a-z]"
```

### Java / Kotlin

```bash
EX='-g !target -g !build -g !*Test*'
rg -n $EX "createStatement\(\)|executeQuery\(\s*\"[^\"]*\"\s*\+|executeUpdate\(\s*\"[^\"]*\"\s*\+|createQuery\(\s*\"[^\"]*\"\s*\+|createNativeQuery\(\s*\"[^\"]*\"\s*\+|String\.format\(\s*\"(SELECT|UPDATE|DELETE|INSERT)" -i
rg -n $EX "Runtime\.getRuntime\(\)\.exec\(|ProcessBuilder\(\s*\"(sh|bash|cmd)\"|ProcessBuilder\(\s*[a-z]"
rg -n $EX "th:utext|Html\.Raw|<%=|\$\{[a-zA-Z.]+\}" -g "*.jsp" -g "*.html" ; rg -n $EX "escapeXml\s*=\s*\"false\""
rg -n $EX "ObjectInputStream|readObject\(\)|XMLDecoder|XStream|enableDefaultTyping|activateDefaultTyping|@JsonTypeInfo|new Yaml\(\)|SnakeYaml"
rg -n $EX "DocumentBuilderFactory|SAXParserFactory|XMLInputFactory|TransformerFactory|SchemaFactory|XMLReader|SAXReader|Unmarshaller" ; rg -L $EX "disallow-doctype-decl|FEATURE_SECURE_PROCESSING|SUPPORT_DTD"
rg -n $EX "new URL\(\s*[a-z]|URI\.create\(\s*[a-z]|RestTemplate\)?\.(getForObject|exchange|postForObject)\(\s*[a-z]|WebClient.*\.uri\(\s*[a-z]|HttpClient.*\.uri\(\s*[a-z]|openConnection\(\)"
rg -n $EX "new File\(\s*[a-z]|Paths\.get\(\s*[a-z]|new FileInputStream\(\s*[a-z]|getResourceAsStream\(\s*[a-z]|MultipartFile.*getOriginalFilename"
rg -n $EX "sendRedirect\(\s*[a-z]|\"redirect:\"\s*\+|RedirectView\(\s*[a-z]"
rg -n $EX "TrustAllCerts|X509TrustManager\(\)\s*\{|checkServerTrusted\(\)\s*\{\s*\}|ALLOW_ALL_HOSTNAME_VERIFIER|setHostnameVerifier\(.*true|NoopHostnameVerifier"
rg -n $EX "new Random\(|Math\.random\(\)|SecureRandom\(\s*[\"a-z]" ; rg -n $EX "Cipher\.getInstance\(\s*\"(AES|DES|AES/ECB|AES/CBC)[^\"]*\"\)|MessageDigest\.getInstance\(\s*\"(MD5|SHA-?1)\"|\"HmacSHA1\""
rg -n $EX "\.csrf\(\)\.disable\(\)|csrf\.disable\(\)|permitAll\(\)|@CrossOrigin\(\s*\)|allowedOrigins\(\s*\"\*\"|setAllowedOriginPatterns\(.*\*|allowCredentials\(true\)"
rg -n $EX "@RequestBody\s+(User|Account|Member|Order)\b" ; rg -n $EX "BeanUtils\.copyProperties\(|@InitBinder" 
rg -n $EX "@Query\(.*#\{|SpEL|ExpressionParser|parseExpression\(\s*[a-z]|OgnlUtil|MVEL|ScriptEngine.*eval\(\s*[a-z]|GroovyShell"
rg -n $EX "Pattern\.compile\(\s*[a-z]|\.matches\(\s*[a-z][a-zA-Z]*\s*\)" 
```

### Ruby / Rails

```bash
rg -n "where\(\s*\"[^\"]*#\{|where\(\s*'[^']*#\{|find_by_sql\(\s*\"|order\(\s*params|order\(\s*\"[^\"]*#\{|pluck\(\s*params|select\(\s*params|group\(\s*params|Arel\.sql\(\s*[a-z]|execute\(\s*\"[^\"]*#\{|\.calculate\(\s*params"
rg -n "\`[^\`]*#\{|system\(\s*\"[^\"]*#\{|exec\(\s*\"[^\"]*#\{|%x\(|Open3\.[a-z]+\(\s*\"[^\"]*#\{|IO\.popen\(\s*\"|Kernel\.open\(\s*[a-z]|spawn\(\s*\"[^\"]*#\{"
rg -n "\.html_safe|raw\(|<%==|sanitize\(.*tags:\s*\[\]|content_tag\(.*\.html_safe|link_to\s+[^,]+,\s*params|redirect_to\s+params|redirect_to\s+request\.(referer|referrer|params)"
rg -n "Marshal\.load|YAML\.load\(|YAML\.unsafe_load|Oj\.load\(|JSON\.load\(|\.constantize|\.safe_constantize|send\(\s*params|public_send\(\s*params|instance_eval|class_eval|\beval\("
rg -n "params\.permit!|\.permit\(\s*\)|attr_accessible|protect_from_forgery\s+with:\s*:null_session|skip_before_action\s+:verify_authenticity_token|skip_forgery_protection|config\.action_controller\.permit_all_parameters"
rg -n "Net::HTTP\.(get|post|start)\(\s*(URI\(\s*)?[a-z]|open\(\s*params|URI\.open\(\s*[a-z]|Faraday\.(get|post)\(\s*[a-z]|HTTParty\.(get|post)\(\s*[a-z]|RestClient\.(get|post)\(\s*[a-z]"
rg -n "send_file\(\s*(params|Rails\.root\.join\([^)]*params|\"[^\"]*#\{)|File\.(read|open|write|delete)\(\s*(params|\"[^\"]*#\{)|render\s+(file|template|action):\s*params|render\s+params"
rg -n "\.find\(\s*params\[:id\]\)" | rg -v "current_user\.|current_account\.|policy_scope|\.where\(" 
rg -n "verify_mode\s*=\s*OpenSSL::SSL::VERIFY_NONE|VERIFY_NONE|ssl_verify:\s*false"
rg -n "\brand\(|Random\.new|SecureRandom\.random_number\(\s*[0-9]{1,3}\s*\)" | rg -i "token|secret|key|code|otp|password"
rg -n "Digest::(MD5|SHA1)|OpenSSL::Cipher\.new\(\s*['\"](aes-[0-9]+-(ecb|cbc)|des)" 
rg -n "config\.force_ssl\s*=\s*false|consider_all_requests_local\s*=\s*true|config\.hosts\s*<<\s*nil|config\.hosts\.clear|Rack::Cors.*origins\s+'\*'|origins\s+'\*'"
rg -n "Regexp\.new\(\s*params|=~\s*/[^/]*\([^)]*[+*][^)]*\)[+*]"
```

### PHP

```bash
EX='-g !vendor'
rg -n $EX "mysqli?_query\(\s*[^,]*,\s*\"[^\"]*\\\$|->query\(\s*\"[^\"]*\\\$|->exec\(\s*\"[^\"]*\\\$|->prepare\(\s*\"[^\"]*\\\$|whereRaw\(\s*\"[^\"]*\\\$|DB::raw\(\s*\"[^\"]*\\\$|selectRaw\(.*\\\$|orderByRaw\(.*\\\$|orderBy\(\s*\\\$request|\\\$wpdb->query\(\s*\"[^\"]*\\\$"
rg -n $EX "\b(exec|shell_exec|system|passthru|popen|proc_open|pcntl_exec)\s*\(|\`[^\`]*\\\$[a-zA-Z_]"
rg -n $EX "\{!!|echo\s+\\\$_(GET|POST|REQUEST|COOKIE|SERVER)|print\s+\\\$_(GET|POST)|<\?=\s*\\\$_(GET|POST)|\|\s*raw\b|html_entity_decode\(|strip_tags\(" 
rg -n $EX "\b(eval|assert|create_function|call_user_func|call_user_func_array|array_map|usort|preg_replace)\s*\(\s*(\\\$_(GET|POST|REQUEST)|\\\$[a-z]+)" ; rg -n $EX "preg_replace\(\s*['\"][^'\"]*/e['\"]"
rg -n $EX "\bunserialize\s*\(|phar://|__wakeup|__destruct|igbinary_unserialize"
rg -n $EX "\b(include|include_once|require|require_once)\s*\(?\s*(\\\$_(GET|POST|REQUEST)|\\\$[a-z]+\s*\.|\\\$[a-z]+\s*\))" 
rg -n $EX "simplexml_load_(string|file)\(|DOMDocument|XMLReader|xml_parse\(|LIBXML_NOENT|libxml_disable_entity_loader\(\s*false"
rg -n $EX "file_get_contents\(\s*(\\\$_(GET|POST|REQUEST)|\\\$[a-z]+|['\"]https?://.*\\\$)|curl_setopt\(.*CURLOPT_URL,\s*\\\$|fopen\(\s*\\\$|readfile\(\s*\\\$|file_put_contents\(\s*\\\$|move_uploaded_file\(.*\\\$_FILES\[[^]]+\]\['name'\]|unlink\(\s*\\\$"
rg -n $EX "header\(\s*['\"]Location:\s*['\"]?\s*\.\s*\\\$|redirect\(\s*\\\$request|->redirect\(\)->to\(\s*\\\$|Redirect::to\(\s*\\\$"
rg -n $EX "CURLOPT_SSL_VERIFYPEER\s*(,|=>)\s*(false|0)|CURLOPT_SSL_VERIFYHOST\s*(,|=>)\s*(false|0)|verify_peer\s*=>\s*false|'verify'\s*=>\s*false"
rg -n $EX "\b(rand|mt_rand|uniqid|lcg_value|srand|mt_srand)\s*\(" | rg -i "token|secret|key|session|password|code|otp|salt|nonce"
rg -n $EX "\bmd5\s*\(|\bsha1\s*\(|\bcrypt\s*\(|mcrypt_|openssl_encrypt\(.*(ecb|cbc)" -i
rg -n $EX "\\\$fillable\s*=\s*\[\s*\]|\\\$guarded\s*=\s*\[\s*\]|->fill\(\s*\\\$request->all\(\)|::create\(\s*\\\$request->all\(\)|->update\(\s*\\\$request->all\(\)|forceFill\("
rg -n $EX "APP_DEBUG=true|display_errors\s*=\s*On|'debug'\s*=>\s*true|VerifyCsrfToken.*\\\$except|->withoutMiddleware\(|Access-Control-Allow-Origin:\s*\*|'allowed_origins'\s*=>\s*\[\s*'\*'\s*\]|'supports_credentials'\s*=>\s*true"
rg -n $EX "==\s*\\\$(hash|token|signature|sig|hmac)|\\\$(hash|token|signature|sig|hmac)\s*==[^=]|strcmp\(\s*\\\$(hash|token|sig)" 
rg -n $EX "preg_match\(\s*\\\$|preg_match\(\s*['\"][^'\"]*\([^)]*[+*][^)]*\)[+*]"
```

Then run the SAST tool for the language (`security-testing.md` §2-3),
which catches sinks the regexes miss and does the first level of source
tracing for you. Treat the union as the candidate list.

## 5. Step 4: Trace source to sink

For each candidate: open the file, find where the dynamic value comes
from, and follow it backwards until you reach either a constant, a
validated/allowlisted value, or an untrusted source.

Untrusted sources: request path/query/body/headers/cookies, file uploads,
websocket messages, queue messages produced by user actions, database
columns that were user input, third-party API responses, environment
variables an operator could set in a shared platform (less common), LLM
output, retrieved documents.

Questions at each hop:

1. What transformation happened? Validation (shape), sanitization
   (transform), encoding (for a specific sink), or just renaming?
2. Is the validation sufficient *for this sink*? A type check (`is a
   string`) is not an allowlist for an `ORDER BY` column. HTML-encoding is
   not URL validation.
3. Can the validation be bypassed by a different path to the same sink
   (another handler, a background job, an admin tool)?
4. Does the value cross a storage boundary and come back later (second-
   order)? Then the output-side control is the one that matters.

Record each traced candidate as one of: **confirmed** (untrusted → sink
with no adequate control; write the request that demonstrates it or the
test that fails), **safe** (constant or adequate control; note why in one
line so you do not re-trace it), or **unclear** (needs runtime info or
more time; list it in the report as such).

Prioritize tracing by exposure: anonymous endpoints first, then
authenticated-any-user, then privileged. Within those, sinks in order of
impact: command execution and deserialization (RCE), SQL (data), SSRF
(cloud creds), path/file (data/RCE), XSS (sessions), redirects.

## 6. Step 5: Authorization coverage check

Using the route table from step 1 and the architecture from step 2:

1. **Every route goes through authentication unless it is on the public
   list.** Build the public list explicitly (login, signup, reset,
   health, public assets, webhooks with signature verification, public
   read-only API). Everything else must be covered by the auth middleware
   or decorator. In frameworks with per-route decorators, grep for routes
   *without* one:

```bash
# Flask/FastAPI example: route decorators not followed by an auth decorator within 3 lines
rg -n -A3 "@(app|bp|router)\.(route|get|post|put|delete|patch)\(" --type py | rg -B1 -A2 "def " | rg -v "login_required|Depends\(get_current_user\)|Depends\(require" | rg "def "
# Rails: controllers without authenticate_user! (and not skipping on purpose)
for f in app/controllers/**/*.rb; do rg -q "authenticate_user!|before_action :authenticate|before_action :require_login" "$f" || echo "NO AUTH FILTER: $f"; done
# Express: routes mounted before the auth middleware, or routers without it
rg -n "app\.use\(|router\.use\(" src/ | head -40      # read the order
```

2. **Every handler with an object identifier applies object-level
   authorization.** For each route with `:id`/`{id}`/`<pk>`: does the
   query include the caller's tenant/owner, or does a policy check run
   before the action? Use the grep from `authn-authz-threats.md` §16 for
   lookups by primary key with no second condition, and read each one.

3. **Every state-changing handler allowlists writable fields.** Mass
   assignment grep from the same section.

4. **Role-gated routes are gated at the route group**, not only inside the
   handler; the UI hiding a link is not a control.

5. **Non-HTTP entry points** (jobs, consumers, websockets, GraphQL
   resolvers, admin CLIs) apply the same checks; GraphQL resolvers in
   particular often fetch by id with a dataloader that has no viewer.

6. **Multi-tenant**: pick five queries at random in the data layer and
   confirm tenant scoping; check search indexes and caches; check
   `tenant_id` is never accepted from the request body on create.

Then confirm with the matrix test (`security-testing.md` §7) on at least
the top ten endpoints by sensitivity. A grep says "probably"; the test
says "yes".

## 7. Step 6: Secrets, config, and environment

```bash
gitleaks detect --source . --redact -v          # includes history
trufflehog git file://. --only-verified
python3 scripts/secret_patterns.py .            # fallback
git log --all --diff-filter=A --name-only | rg -i "\.env$|\.pem$|\.key$|id_rsa|credentials|serviceaccount.*\.json|\.p12$|\.jks$|\.npmrc$|\.pypirc$|\.netrc$" | sort -u
rg -n "NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_" .env* src/ 2>/dev/null | rg -i "secret|key|token|password"   # server secrets shipped to the browser?
rg -n "process\.env\.[A-Z_]+|os\.environ|os\.Getenv|System\.getenv|ENV\[" | rg -v "test" | rg -i "console\.log|logger|print\(|fmt\.Print|puts"   # env being logged
```

Review: how production config is loaded (file in image? env? secret
manager?); whether `.env` files are in `.gitignore` *and* absent from
history; debug flags (`logging-privacy.md` §12 grep); CORS and cookie
settings; whether the Dockerfile copies secrets or the whole context;
whether CI workflows expose secrets to untrusted triggers
(`dependencies-supply-chain.md` §6); default credentials in
`docker-compose.yml` that might be used in a deployed environment.

## 8. Step 7: Dependencies and build

```bash
# Is the lockfile present and honored?
ls package-lock.json pnpm-lock.yaml yarn.lock Pipfile.lock poetry.lock uv.lock go.sum Cargo.lock Gemfile.lock composer.lock packages.lock.json 2>/dev/null
rg -n "npm install|pip install -r|bundle install|composer update" .github/ Dockerfile* .gitlab-ci.yml 2>/dev/null | rg -v "npm ci|--frozen-lockfile|--immutable|--locked|--deployment|--require-hashes"
# Audit
osv-scanner -r . ; npm audit --omit=dev ; pip-audit ; govulncheck ./... ; bundle exec bundler-audit check --update ; composer audit ; cargo audit
# Unpinned actions and base images
rg -n "uses:\s*[^@]+@(v?[0-9]+(\.[0-9]+)*|main|master|latest)\s*$" .github/workflows/
rg -n "^FROM .*:(latest|[0-9.]+)\s*$" Dockerfile* | rg -v "@sha256"
rg -n "pull_request_target|workflow_run" .github/workflows/
zizmor .github/workflows/ 2>/dev/null
# Install scripts
rg -n "\"(pre|post)install\"" package.json node_modules/*/package.json node_modules/@*/*/package.json 2>/dev/null | head -50
```

Record: lockfile status, count of high/critical in production
dependencies with reachability notes for the top few, unpinned CI
dependencies, and whether update automation exists.

## 9. Step 8: Runtime checks (if an instance is available and in scope)

```bash
URL=https://staging.example.com
python3 scripts/headers_check.py $URL
curl -sI $URL | rg -i "server:|x-powered-by|x-aspnet"
# Error handling
curl -s -X POST $URL/api/anything -H 'Content-Type: application/json' -d '{bad' | head -c 600
curl -s $URL/api/invoices/00000000-0000-0000-0000-000000000000 -H "Authorization: Bearer invalid" | head -c 600
curl -s "$URL/nonexistent-page-$(date +%s)" | rg -i "stack|trace|exception|at .*\.(js|py|rb|java):" 
# Debug/admin endpoints exposed?
for p in /admin /actuator /actuator/env /metrics /graphql /playground /swagger /swagger-ui /api-docs /docs /redoc /_debug /debug /phpinfo.php /.env /.git/HEAD /server-status /console /rails/info /__debug__ /elmah.axd /trace.axd; do printf "%-20s %s\n" $p "$(curl -s -o /dev/null -w '%{http_code}' $URL$p)"; done
# CORS reflection
curl -sI -H "Origin: https://not-yours.example" $URL/api/me | rg -i "access-control"
# Cookie flags
curl -sI $URL/login | rg -i "set-cookie"
# TLS
testssl.sh --quiet $URL 2>/dev/null | rg -i "vulnerable|weak|TLS 1\.0|TLS 1\.1|offered" 
```

Then the authz matrix against the instance with two real test accounts,
and a ZAP baseline (`security-testing.md` §5). Keep every request you
send within the scope the user agreed to; never test rate limiting or
anything DoS-like without explicit permission.

## 10. Step 9: Business logic and the threat model

Scanners and greps are done; now think. Pick the three most valuable
flows (money, data export, permission changes, account recovery) and walk
each with `threat-modeling.md` §6 positions: the authenticated unprivileged
user, the lying frontend, the former member, the concurrent requester.

Specific checks: prices/quantities/discounts recomputed server-side;
state machines enforce transitions (an order cannot go from `refunded` to
`shipped`); coupons and invites are single-use atomically; numeric fields
reject negatives and overflow; pagination/limit parameters are capped;
export endpoints filter by tenant; email change requires verification of
the new address *and* notification of the old; account deletion requires
re-auth; admin impersonation is logged; webhooks verify signatures and
timestamps and are idempotent; file downloads check ownership not just
existence.

## 11. Writing the findings report

Structure: executive summary (five lines: scope, method, count by
severity, the two things to fix first), findings sorted by severity, then
positive observations (what is done well, so the team knows what to keep),
then methodology and limitations (what you could not test).

Severity scheme (state it): Critical = unauthenticated RCE, cross-tenant
data access at scale, cloud credential exposure, auth bypass. High =
authenticated cross-user data access/modification, stored XSS reaching
privileged users, SSRF to internal network, leaked production secret.
Medium = reflected XSS, CSRF on a meaningful action, missing rate limiting
on auth, IDOR on low-sensitivity data, verbose errors with internals,
weak crypto on non-critical data. Low = missing headers without a
demonstrated impact, information disclosure (versions), best-practice
deviations. Informational = observations and hardening suggestions.

Each finding:

```markdown
### [H-2] Invoice PDF download does not check ownership (IDOR)

**Severity:** High  **Confidence:** Confirmed (reproduced in staging)
**Location:** `src/routes/invoices.ts:88` (`GET /api/invoices/:id/pdf`), `src/services/pdf.ts:40`
**Description:** The handler loads the invoice by primary key and streams the PDF.
The `requireAuth` middleware is present, but no check ties the invoice to the
caller's account. Invoice ids are sequential integers.
**Impact:** Any authenticated user can download any customer's invoice (names,
addresses, line items, amounts). With sequential ids this is enumerable:
~120k invoices.
**Evidence:** As test user B (account 2), `GET /api/invoices/1041/pdf` (owned by
account 1) returned 200 and the PDF. Test: `tests/security/test_authz_matrix.py::test_authz[b-GET-/api/invoices/{inv}/pdf]` fails on current main.
**Fix:** Load through the scoped repository (`InvoiceRepo.forAccount(req.user.accountId)`)
so foreign ids 404, matching `GET /api/invoices/:id` at line 61. Audit the other
four routes under `/invoices/:id/*` (list in Appendix A); `:id/share` has the same pattern.
Consider UUIDs for new invoices to remove enumerability (secondary).
**Verification:** The matrix test passes; `curl` as user B returns 404; the PDF
route appears in the authz coverage meta-test.
**References:** `security/references/authn-authz-threats.md` §10
```

Rules for the report: one finding per root cause (if six routes share
the bug, one finding with six locations); evidence that a developer can
re-run; a fix that names the existing mechanism to use, not a vague
"add authorization"; verification steps; no payloads beyond what is
needed to show the behavior; confidence labeled honestly; pre-existing
tickets or accepted risks referenced rather than re-reported.

Deliver the report where the team works (a markdown file in the repo
under `docs/security/` or the issue tracker, one issue per finding with
the severity label), and offer to pair on the top two.

## 12. Time budgets and what to skip

| Budget | Do |
|---|---|
| 1 hour (PR review) | Steps 3-4 on the diff; step 5 for any new/changed route; secrets grep on the diff; SCA if the lockfile changed |
| Half day | Steps 1-2 fully; step 3 for the two most relevant sink classes; step 5 on all routes; step 6; step 7 audit commands; report |
| 2-3 days | Everything above, step 8 against staging, step 9 on the top three flows, matrix tests written and committed for the top endpoints |
| Ongoing | Turn each manual check into a semgrep rule or a test (`security-testing.md`) so the next audit starts from a higher floor |

Skip (or defer, with a note): styling of the report over its accuracy;
re-auditing code covered by a recent pentest unless it changed; third-
party SaaS internals; theoretical findings with no path from an
attacker-controlled source; DoS testing without permission.

Cross-references: every class's details in its own reference; the grep
patterns here are candidates and the per-class files explain what a
confirmed instance looks like and how to fix it.
