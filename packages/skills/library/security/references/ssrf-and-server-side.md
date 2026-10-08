# SSRF and other server-side input handling

The bugs that happen when the server acts on user input as a URL, a file
path, a file, a serialized object, an XML document, a redirect target, or
a regex subject. Each has a well-understood defensive pattern; each is
regularly reintroduced because the vulnerable version is shorter. Examples
show the bug and the fix in the languages where the bug is most common.

## Contents

1. SSRF: why it matters more in the cloud
2. SSRF defenses: allowlist, resolve-and-pin, block private ranges, no blind redirects
3. SSRF in disguise: webhooks, PDF renderers, image fetchers, URL previews, import-from-URL
4. Path traversal
5. File uploads: the full pipeline
6. Serving user files safely
7. Insecure deserialization per language
8. XXE and XML parsers
9. Open redirects
10. ReDoS: finding and fixing catastrophic regexes
11. Zip slip and archive handling
12. Detection commands

## 1. SSRF: why it matters more in the cloud

Server-Side Request Forgery: the server fetches a URL the user influenced.
The attacker uses your server as a proxy into places only it can reach:
`localhost` admin ports, internal services with no auth because "they are
internal", and above all the cloud metadata endpoint (`169.254.169.254`
on AWS/GCP/Azure, `fd00:ec2::254`, `metadata.google.internal`), which hands
out the instance's IAM credentials. One SSRF in a URL-preview feature has
repeatedly turned into full cloud account compromise.

Impact scale: read internal HTTP services → read cloud credentials → act as
the instance role → everything that role can do. Mitigations outside the
code: AWS IMDSv2 required (`HttpTokens: required`, which needs a PUT with a
header that a simple GET SSRF cannot do), GCP metadata requires the
`Metadata-Flavor: Google` header (same idea), minimal instance roles, and
network egress policies.

## 2. SSRF defenses

In order of strength. Use the first that fits; combine when possible.

**A. Do not accept URLs; accept identifiers.** If the feature is "fetch the
user's avatar from GitHub", take a GitHub username and build the URL
yourself. Most "fetch arbitrary URL" features are really "fetch from one of
three known services".

**B. Allowlist hosts** when the destinations are known
(`api.stripe.com`, `*.slack.com`). Compare the parsed hostname against the
list; do not substring-match the URL (`https://evil.example/?x=api.stripe.com`
contains the string).

**C. For genuinely arbitrary URLs (webhooks, link previews): resolve,
validate the IP, then connect to that IP** so DNS rebinding (the hostname
resolves to a public IP during your check and to `127.0.0.1` when the HTTP
client resolves it again) cannot slip through.

```python
# VULNERABLE: fetch whatever the user gave
resp = requests.get(request.json["url"], timeout=5)

# FIXED (Python): validate scheme, resolve, reject private/special ranges, pin the IP, limit redirects
import ipaddress, socket
from urllib.parse import urlparse
import requests

BLOCKED_NETS = [ipaddress.ip_network(n) for n in (
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
    "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4",
    "::1/128", "fc00::/7", "fe80::/10", "::ffff:0:0/96", "64:ff9b::/96")]

def resolve_public(host: str) -> str:
    infos = socket.getaddrinfo(host, None)
    ips = {ipaddress.ip_address(i[4][0]) for i in infos}
    if not ips or any(ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
                      or ip.is_reserved or ip.is_unspecified or any(ip in n for n in BLOCKED_NETS) for ip in ips):
        raise ValueError("destination not allowed")
    return str(next(iter(ips)))

def safe_fetch(url: str) -> requests.Response:
    for _ in range(3):                                  # follow at most 3 redirects, re-validating each
        u = urlparse(url)
        if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password:
            raise ValueError("bad url")
        ip = resolve_public(u.hostname)
        port = u.port or (443 if u.scheme == "https" else 80)
        if port not in (80, 443):
            raise ValueError("port not allowed")
        # Connect to the pinned IP; keep Host/SNI as the hostname. requests cannot pin natively;
        # use a transport adapter (e.g. `requests-toolbelt` HostHeaderSSLAdapter) or httpx with a
        # custom transport. Shown conceptually:
        resp = pinned_get(ip, u.hostname, url, timeout=5, allow_redirects=False, stream=True)
        if resp.is_redirect:
            url = resp.headers["Location"]; continue
        if int(resp.headers.get("Content-Length", 0)) > 5_000_000:
            raise ValueError("too large")
        return resp
    raise ValueError("too many redirects")
```

The hard requirement in the comment is the one most "SSRF fixes" miss: if
you validate the hostname and then let the HTTP library resolve it again,
a DNS record with a 0 TTL that alternates answers defeats you. Either pin
the IP at the connection layer, or run the fetch through an egress proxy
that enforces the policy (the operationally cleanest answer for a large
app: all outbound user-influenced requests go through a proxy like Smokescreen
or an Envoy egress with the allow/deny rules in one place).

```ts
// Node: undici lets you control DNS and connection; simplified
import { Agent, request } from 'undici';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

async function assertPublic(host: string) {
  const addrs = await lookup(host, { all: true });
  for (const a of addrs) {
    const r = ipaddr.parse(a.address).range();
    if (r !== 'unicast') throw new Error('destination not allowed');   // rejects private, loopback, linkLocal, etc.
  }
  return addrs[0].address;
}
export async function safeFetch(urlStr: string) {
  const u = new URL(urlStr);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('scheme');
  const ip = await assertPublic(u.hostname);
  const agent = new Agent({ connect: { lookup: (_h, _o, cb) => cb(null, [{ address: ip, family: ip.includes(':') ? 6 : 4 }]) } });
  return request(u, { dispatcher: agent, maxRedirections: 0, headersTimeout: 5000, bodyTimeout: 5000 });
}
```

```go
// Go: a custom DialContext that validates the resolved IP before connecting
dialer := &net.Dialer{Timeout: 5 * time.Second}
transport := &http.Transport{
    DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
        host, port, _ := net.SplitHostPort(addr)
        ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
        if err != nil { return nil, err }
        for _, ip := range ips {
            if ip.IP.IsPrivate() || ip.IP.IsLoopback() || ip.IP.IsLinkLocalUnicast() || ip.IP.IsUnspecified() || ip.IP.IsMulticast() {
                return nil, fmt.Errorf("destination not allowed")
            }
        }
        return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
    },
}
client := &http.Client{Transport: transport, Timeout: 10 * time.Second,
    CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
```

Additional rules regardless of language: only `http`/`https` (no `file:`,
`gopher:`, `ftp:`, `dict:`); no credentials in the URL; restrict ports;
cap response size and time; do not follow redirects automatically
(re-validate each hop); strip the response's `Set-Cookie`/auth headers
before storing anything; run the fetcher with no cloud credentials and in
a network segment that cannot reach internal services (the most robust
fix of all).

IP parsing tricks to be aware of so you use a library rather than a regex:
decimal (`2130706433`), octal (`0177.0.0.1`), IPv6-mapped (`::ffff:127.0.0.1`),
shortened (`127.1`), and `[::]`. `ipaddress` (Python), `ipaddr.js`, `net.IP`
(Go) handle these; string comparison does not.

## 3. SSRF in disguise

Features that fetch URLs on the user's behalf without saying so:

- **Webhook registration** ("send events to this URL"): validate at
  registration *and* at send time (DNS changes); send from an isolated
  worker.
- **URL previews / link unfurling** in chat and CMS.
- **Import from URL** (CSV, image, OPML, calendar `.ics`).
- **PDF/HTML renderers** (wkhtmltopdf, Puppeteer, headless Chrome,
  WeasyPrint): user HTML with `<img src="http://169.254.169.254/...">` or
  `<iframe src="file:///etc/passwd">`. Run the renderer in a sandbox with
  no network, or with a proxy allowlist, and disable local file access.
- **Image processing** (ImageMagick `url:` and `msl:` coders; `ffmpeg`
  playlists). Use a policy.xml that disables those coders; re-encode via a
  library rather than shelling out.
- **XML with external entities** (§8), **SVG with `<image href>`**, **Office
  documents with remote templates**, **Markdown with remote images**
  rendered server-side.
- **OpenID/OAuth discovery, JWKS URLs, `jku` headers**: fetching the issuer
  the token names. Allowlist issuers.
- **Database functions**: Postgres `COPY FROM PROGRAM`, `dblink`,
  `pg_read_file`; MySQL `LOAD DATA LOCAL`. Lock down DB roles.

## 4. Path traversal

```js
// VULNERABLE: "../../etc/passwd" or an absolute path
app.get('/download', (req, res) => res.sendFile(path.join(UPLOAD_DIR, req.query.name)));

// FIXED: resolve and verify the prefix; or better, never take a path at all
app.get('/download', (req, res) => {
  const requested = path.resolve(UPLOAD_DIR, String(req.query.name));
  if (requested !== UPLOAD_DIR && !requested.startsWith(UPLOAD_DIR + path.sep)) return res.sendStatus(400);
  res.sendFile(requested);
});
```

`path.join` does not protect you (`join('/u', '../etc')` → `/etc`).
`path.resolve` normalizes; the prefix check (with the trailing separator,
so `/uploads-secret` does not pass for `/uploads`) is the control. In
Python: `candidate = (BASE / name).resolve(); candidate.relative_to(BASE)`
raises `ValueError` when outside (3.9+: `candidate.is_relative_to(BASE)`).
In Java: `base.resolve(name).normalize().startsWith(base)`. In Go:
`filepath.Rel(base, filepath.Join(base, name))` must not start with `..`,
or use `os.OpenRoot` / `fs.Sub` (1.24+) to get a rooted filesystem.

Better still: store files under random names (`uploads/<uuid>`), keep the
user-facing name in the database, and look up by id. The request then
never contains a path.

Encoded variants the resolver handles but a blocklist does not: `%2e%2e%2f`
(decoded by the framework before you see it, or not), `..%c0%af`
(overlong UTF-8, rejected by modern decoders), `....//` (survives naive
`replace('../', '')`), Windows `..\`, and null bytes (`file.txt%00.png`,
rejected by modern runtimes). Symlinks inside the upload directory point
outside it; use `realpath` (which `resolve()`/`realpath` does) and in
Go/Python consider `O_NOFOLLOW`.

## 5. File uploads: the full pipeline

Uploads combine several bug classes. The pipeline that handles them:

1. **Authenticate and authorize** the upload like any other write (who may
   upload, to what, how much).
2. **Limit size** at the edge (nginx `client_max_body_size`, framework
   limits) and per user quota; stream to disk/object storage, do not
   buffer in memory.
3. **Validate the type by content, not by extension or `Content-Type`
   header** (both are client-controlled). Sniff magic bytes (`file-type`
   in Node, `python-magic`/`filetype` in Python, `http.DetectContentType`
   in Go, Apache Tika in Java) and compare to the *allowed* list for this
   feature (avatars: PNG/JPEG/WebP; documents: PDF). Reject on mismatch.
4. **Re-encode images** with a library (sharp, Pillow, `image` in Go,
   ImageMagick with a hardened policy) to strip metadata (EXIF GPS), kill
   polyglots (a file that is both a valid JPEG and valid HTML/JS/PHP), and
   bound dimensions (decompression bombs: a 10 KB PNG that is 50,000 ×
   50,000 pixels; set `Image.MAX_IMAGE_PIXELS`, sharp's `limitInputPixels`).
5. **Generate the stored name**: a random id plus an extension you chose
   from the sniffed type; never the user's filename (traversal, overwrite,
   `.php`, `.htaccess`, unicode tricks). Keep the original name in the DB
   for display, encoded.
6. **Store outside the web root** or in object storage (S3/GCS/Azure Blob)
   with no public listing, and never in a location the web server executes
   from. A `.php` or `.jsp` under the document root is RCE on servers that
   execute by extension.
7. **Scan** if the files are shared with others (ClamAV or a cloud scanning
   service), asynchronously, quarantining until clean.
8. **Serve** per §6.

```ts
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';

const ALLOWED = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]);

export async function handleAvatarUpload(buf: Buffer, userId: string) {
  if (buf.length > 5 * 1024 * 1024) throw new HttpError(413, 'too large');
  const ft = await fileTypeFromBuffer(buf);                       // magic bytes
  if (!ft || !ALLOWED.has(ft.mime)) throw new HttpError(415, 'unsupported type');
  const out = await sharp(buf, { limitInputPixels: 25_000_000 })  // bound decode
    .rotate()                                                     // apply EXIF orientation, then...
    .resize(512, 512, { fit: 'cover' })
    .toFormat('webp')                                             // ...re-encode: strips metadata and polyglots
    .toBuffer();
  const key = `avatars/${userId}/${randomUUID()}.webp`;
  await storage.put(key, out, { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' });
  return key;
}
```

```python
from PIL import Image
Image.MAX_IMAGE_PIXELS = 25_000_000                 # raise DecompressionBombError beyond this
def process_avatar(fp) -> bytes:
    img = Image.open(fp); img.verify()               # cheap structural check
    img = Image.open(fp); img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((512, 512))
    out = io.BytesIO(); img.save(out, format="WEBP", quality=85)   # new file, no metadata
    return out.getvalue()
```

Non-image documents: PDFs can carry JavaScript and embedded files; if you
can, flatten with a tool (Ghostscript re-render, `qpdf --flatten`) or at
least serve them as attachments. Office formats contain macros; strip or
block. ZIPs: see §11. CSVs: formula injection on export (see
`injection.md`).

## 6. Serving user files safely

- Serve from a **separate origin** (`usercontent.example-cdn.net`) that has
  no cookies and no privileges. Then a stored XSS inside a file is an XSS
  on a worthless origin.
- `Content-Type` set by *you* from the sniffed type, never from the
  stored user header; `X-Content-Type-Options: nosniff` so the browser
  does not reinterpret.
- `Content-Disposition: attachment; filename="..."` for anything not
  meant to render inline (HTML, SVG, PDF unless you accept the risk, XML,
  anything unknown). Encode the filename (RFC 5987 `filename*=UTF-8''...`)
  and strip CR/LF and quotes from it.
- Use **signed, expiring URLs** (S3 presigned, GCS signed, CloudFront signed
  cookies) for private files so the authorization decision happens in your
  app and the bytes stream from storage. Expiry minutes, not days. Do not
  put signed URLs in logs.
- `Cache-Control: private` for per-user files; public immutable caching
  only for content-addressed public assets.
- Never let the storage bucket be listable or publicly readable by default
  (see `cloud-and-infra.md`).

## 7. Insecure deserialization per language

Native serialization formats can encode *objects with behavior*; deserializing
attacker bytes runs attacker-chosen code paths. The fix is universal: never
deserialize untrusted data with a native format. Use JSON (or protobuf,
MessagePack) with a schema, and treat the result as data.

| Language | Dangerous | Safe alternative |
|---|---|---|
| Python | `pickle.loads`, `cPickle`, `shelve`, `marshal`, `yaml.load` without `Loader=SafeLoader`, `jsonpickle`, `dill`, `torch.load` on untrusted models | `json`, `yaml.safe_load`, `pydantic` models; `torch.load(weights_only=True)`; safetensors |
| Java | `ObjectInputStream.readObject`, XMLDecoder, XStream default, Jackson with `enableDefaultTyping`/`@JsonTypeInfo` on `Object`, SnakeYAML `new Yaml().load` (pre-2.0), Hessian/Kryo on untrusted input | JSON via Jackson with default typing off; `ObjectInputFilter` allowlist if serialization is unavoidable; SnakeYAML `SafeConstructor` |
| .NET | `BinaryFormatter` (now disabled by default), `SoapFormatter`, `NetDataContractSerializer`, `Json.NET` with `TypeNameHandling != None`, `LosFormatter`, `ObjectStateFormatter` | `System.Text.Json`; `TypeNameHandling.None`; `DataContractJsonSerializer` |
| Ruby | `Marshal.load`, `YAML.load` (pre-Psych 4; now `unsafe_load`), `Oj` with object mode, Rails `ActiveSupport::MessageVerifier` with a leaked secret, cookies with `Marshal` serializer | `JSON.parse`, `YAML.safe_load`, Rails `:json` cookie serializer |
| PHP | `unserialize()` on input, phar:// stream wrappers, `__wakeup`/`__destruct` gadgets | `json_decode($x, true)`; `unserialize($x, ['allowed_classes' => false])` if forced |
| Node | `node-serialize`, `serialize-javascript` *parsing*, `js-yaml` `load` with default schema pre-4.0 (now safe), `eval`-based parsers | `JSON.parse`; `js-yaml` 4+ `load` (safe by default) |
| Go | `encoding/gob` is data-only (no code exec) but still validate; `yaml.v2` is fine | Prefer JSON with struct types and validation |

```python
# VULNERABLE
session = pickle.loads(base64.b64decode(request.cookies["s"]))
config = yaml.load(user_file)               # default Loader in PyYAML < 5.1 was unsafe; explicit unsafe loaders still exist

# FIXED
session = json.loads(signer.unsign(request.cookies["s"]))     # signed JSON, data only
config = yaml.safe_load(user_file)
```

```java
// VULNERABLE
ObjectMapper m = new ObjectMapper(); m.enableDefaultTyping();     // polymorphic gadgets
Object o = new ObjectInputStream(req.getInputStream()).readObject();

// FIXED
ObjectMapper m = new ObjectMapper();                              // default typing off
MyDto dto = m.readValue(req.getInputStream(), MyDto.class);       // concrete target type
// If legacy Java serialization is unavoidable:
ObjectInputStream ois = new ObjectInputStream(in);
ois.setObjectInputFilter(ObjectInputFilter.Config.createFilter("com.example.dto.*;!*"));
```

Signed-and-then-deserialized is only as safe as the key: if the signing
secret (Rails `secret_key_base`, Django `SECRET_KEY`, Flask `SECRET_KEY`,
Laravel `APP_KEY`) leaks, signed-cookie deserialization becomes RCE in
frameworks that still use native serializers. That is why these keys are
in `secrets.md` as top-tier and why JSON serializers are the default now.

## 8. XXE and XML parsers

XML External Entity: a document declares `<!ENTITY x SYSTEM "file:///etc/passwd">`
and references `&x;`; the parser reads the file into the document. Also
SSRF via `SYSTEM "http://169.254.169.254/..."` and DoS via entity
expansion ("billion laughs"). Fix: disable DTDs entirely, or at least
external entities, on **every** parser instance, including the ones inside
SOAP, SAML, RSS, SVG, DOCX, and XSLT libraries.

```java
// Java: the two lines that matter, on every factory you create
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);   // best: no DTD at all
dbf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
dbf.setXIncludeAware(false); dbf.setExpandEntityReferences(false);
// Same idea for SAXParserFactory, XMLInputFactory (XMLInputFactory.SUPPORT_DTD=false, IS_SUPPORTING_EXTERNAL_ENTITIES=false),
// TransformerFactory (ACCESS_EXTERNAL_DTD="", ACCESS_EXTERNAL_STYLESHEET=""), SchemaFactory, Unmarshaller (JAXB via a safe XMLInputFactory)
```

```python
# Python: stdlib xml.* is vulnerable to some attacks; use defusedxml
import defusedxml.ElementTree as ET
tree = ET.fromstring(data)                 # raises on DTD/entities by default
# lxml: etree.XMLParser(resolve_entities=False, no_network=True, dtd_validation=False, load_dtd=False)
```

```js
// Node: fast-xml-parser and @xmldom/xmldom do not resolve external entities;
// libxmljs: parseXml(x, { noent: false, dtdload: false, nonet: true })
```

```php
// PHP 8+: external entity loading is disabled by default. On older: libxml_disable_entity_loader(true);
$dom = new DOMDocument(); $dom->loadXML($xml, LIBXML_NONET | LIBXML_DTDLOAD ^ LIBXML_DTDLOAD);  // avoid LIBXML_NOENT
```

```csharp
// .NET: XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null }
```

```ruby
# Ruby Nokogiri: default is safe (NONET, no entity substitution). Do not pass Nokogiri::XML::ParseOptions::NOENT.
```

SAML and SOAP libraries parse XML with signatures; use their current
versions and keep the parser hardening they ship. XML signature wrapping
is its own class; use a maintained library and validate against a schema
before signature verification.

## 9. Open redirects

```python
# VULNERABLE: ?next=https://evil.example steals the session on SSO flows, phishes users with your domain
return redirect(request.args.get("next", "/"))

# FIXED: only relative paths, no scheme, no protocol-relative, no backslashes
from urllib.parse import urlparse
def safe_next(raw: str, default="/") -> str:
    if not raw or not raw.startswith("/") or raw.startswith("//") or raw.startswith("/\\"):
        return default
    p = urlparse(raw)
    if p.scheme or p.netloc:
        return default
    return raw
# Django has url_has_allowed_host_and_scheme(url, allowed_hosts={request.get_host()}, require_https=True)
```

```ts
// Node/Express
function safeRedirectTarget(raw: unknown, fallback = '/') {
  if (typeof raw !== 'string') return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  try { const u = new URL(raw, 'https://placeholder.invalid'); return u.origin === 'https://placeholder.invalid' ? u.pathname + u.search + u.hash : fallback; }
  catch { return fallback; }
}
```

If you must redirect to other hosts (multi-domain product), use an
allowlist of hostnames compared after parsing, or sign the redirect URL
server-side when you generate it. `startsWith("https://app.example.com")`
passes `https://app.example.com.evil.example`; `url.includes(host)` passes
anything. Browsers also treat `\` as `/` in URLs and accept `https:evil`
without slashes; parsing with `URL` normalizes those.

Severity is usually medium alone, higher when the redirect sits on an
OAuth `redirect_uri`-registered path (code theft) or a login page (phishing
with a trusted domain).

## 10. ReDoS

Backtracking regex engines (JS, Python `re`, Java, Ruby, PHP PCRE without
JIT limits) take exponential time on patterns with nested or overlapping
quantifiers applied to crafted input: `^(a+)+$`, `(\w+\s?)*$`,
`^([a-zA-Z0-9])(([\-.]|[_]+)?([a-zA-Z0-9]+))*(@){1}...` (the famous
email regex). One request can pin a CPU core for minutes.

Finding them: `semgrep --config p/regex-dos` or the ESLint
`regexp/no-super-linear-backtracking` rule (`eslint-plugin-regexp`);
`recheck` (CLI and library) analyzes a pattern and reports vulnerability;
`rxxr2`, `safe-regex` (crude). Review any regex applied to user input with
nested quantifiers (`(x+)+`, `(x*)*`), alternations with overlap
(`(a|a)+`, `(\w|\d)+`), or unbounded repeats followed by something that
can fail late.

Fixing:

- Use a **linear-time engine**: RE2 (`re2` npm binding, Go's `regexp` is RE2
  by default, Rust `regex`, Python `google-re2`), or Node 20+ `v` flag does
  not help here; Java has no built-in RE2 (use `com.google.re2j`).
- **Bound the input length** before matching (an email over 254 chars is
  invalid anyway).
- **Rewrite** to remove ambiguity: make repeated groups mutually exclusive
  (`[^@]+@[^@]+\.[^@]+` for a rough email check), anchor, use possessive
  quantifiers/atomic groups where the engine has them (Java `++`, PCRE
  `(?>...)`).
- Use a **parser or a library** instead of a regex for emails, URLs, dates.
- Add a **timeout** where the engine supports it (.NET `Regex` with
  `matchTimeout`, PHP `pcre.backtrack_limit`, Ruby 3.2+ `Regexp.timeout=`).

```js
// VULNERABLE: nested quantifier, applied to a request header
const ok = /^(\w+\s?)*$/.test(req.headers['x-name']);

// FIXED: bounded length, unambiguous pattern
const name = String(req.headers['x-name'] ?? '');
const ok = name.length <= 100 && /^\w+(?: \w+)*$/.test(name);
```

## 11. Zip slip and archive handling

Archive entries can be named `../../etc/cron.d/x`; extracting with a naive
loop writes outside the target. Also: symlink entries pointing outside,
hard links, absolute paths, enormous uncompressed sizes (zip bombs), and
thousands of entries.

```python
import zipfile, pathlib
def safe_extract(zpath, dest: pathlib.Path, max_total=500_000_000, max_entries=10_000):
    dest = dest.resolve(); total = 0
    with zipfile.ZipFile(zpath) as z:
        infos = z.infolist()
        if len(infos) > max_entries: raise ValueError("too many entries")
        for info in infos:
            target = (dest / info.filename).resolve()
            if not target.is_relative_to(dest): raise ValueError("path outside destination")
            if info.is_dir(): continue
            if (info.external_attr >> 16) & 0o120000 == 0o120000: raise ValueError("symlink entry")
            total += info.file_size
            if total > max_total: raise ValueError("archive too large")
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
```

Node: `yauzl` or `adm-zip` with the same checks; `tar` package has
`strip`/`filter` options and rejects absolute paths by default in recent
versions. Java: check `entry.getName()` resolved against the destination
with `normalize().startsWith()`. Go: `archive/zip` plus the `filepath.Rel`
check; Go 1.24 `os.Root` is ideal. Python 3.12+ `tarfile.extractall(filter='data')`
does most of this for tar.

## 12. Detection commands

```bash
# Outbound requests with variable URLs
rg -n "(requests|httpx)\.(get|post|request)\(\s*[a-z_]+|fetch\(\s*[a-z_.]+\)|axios\.(get|post)\(\s*[a-z_.]+|http\.Get\(\s*[a-z]+|HttpClient|URL\(\s*[a-z_.]+\)\.openConnection|curl_init\(\s*\$|Net::HTTP\.get\(\s*URI\(\s*[a-z]"
# Paths from input
rg -n "sendFile\(|res\.download\(|send_file\(|open\(\s*(os\.path\.join|f\"|request)|readFile(Sync)?\(.*req\.|os\.ReadFile\(.*r\.(URL|Form)|new File\(.*request|file_get_contents\(\s*\$_(GET|POST)"
# Deserialization
rg -n "pickle\.loads?|yaml\.load\((?!.*SafeLoader)|yaml\.unsafe_load|Marshal\.load|YAML\.(load|unsafe_load)|unserialize\(|ObjectInputStream|enableDefaultTyping|TypeNameHandling|BinaryFormatter|node-serialize"
# XML
rg -n "DocumentBuilderFactory|SAXParserFactory|XMLInputFactory|etree\.(parse|fromstring)|xml\.dom\.minidom|libxml|DOMDocument|XmlReader|Nokogiri::XML\("
# Redirects
rg -n "redirect\(\s*(req|request|params)|res\.redirect\(.*req\.|redirect_to\s+params|Location.*req\.(query|params)|sendRedirect\(.*getParameter"
# Regex on input with nested quantifiers (crude)
rg -n "\([^)]*[+*][^)]*\)[+*]" --type js --type ts --type py --type java --type rb
```

Then `semgrep --config p/ssrf --config p/insecure-transport --config
p/regex-dos` or the language pack, and `bandit`/`gosec`/`brakeman`/`find-sec-bugs`
which all have deserialization and XXE checks.

Cross-references: `injection.md` for command and template injection;
`xss-and-output-encoding.md` for serving HTML/SVG; `cloud-and-infra.md` for
IMDSv2, egress policies and bucket settings; `authn-authz-threats.md` for
OAuth redirect URI matching.
