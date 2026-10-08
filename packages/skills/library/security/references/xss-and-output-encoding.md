# XSS and output encoding

Cross-site scripting is an output-encoding failure: a value was written into
a context (HTML body, attribute, JavaScript, URL, CSS) without the encoding
that context requires. This file covers the contexts and their encodings,
every mainstream framework's safe default and the escape hatches that
disable it, sanitizing rich HTML with DOMPurify, Trusted Types, and CSP as
the layer that catches what encoding missed. The `frontend` skill has a
short summary; this is the depth.

## Contents

1. Three kinds of XSS and why the distinction barely matters for the fix
2. Encoding contexts: the table that matters
3. Framework defaults and escape hatches
4. The sinks that bypass the framework entirely
5. Rich text: sanitizing with DOMPurify (and server-side equivalents)
6. Markdown, SVG, PDFs and other "not HTML" that is HTML
7. URL handling: javascript:, data:, and user-supplied hrefs
8. Trusted Types
9. CSP as defense in depth (summary; full build in csrf-cors-headers.md)
10. Stored content and second-order rendering
11. Detecting XSS in a codebase
12. Tests

## 1. Three kinds and why the fix is the same

- **Reflected**: the value comes from the current request (`?q=`) and is
  echoed into the page.
- **Stored**: the value was saved earlier (a comment, a profile name) and
  rendered to other users later. Worse, because it reaches people who did
  not click anything.
- **DOM-based**: the server is fine; client JS reads `location.hash`,
  `document.referrer`, `postMessage` data, or a fetched JSON field and
  writes it into the DOM via `innerHTML` or similar.

In all three the fix is identical: encode for the context at the point of
output, use the framework's safe sinks, and sanitize only when HTML is the
*intended* output. The distinction matters for severity (stored > reflected)
and for where to look (DOM-based is invisible to server-side scanners).

## 2. Encoding contexts

The same string needs a different transformation depending on where it
lands. Getting the context wrong (HTML-encoding a value that goes into a
JavaScript string, for instance) does not protect it.

| Context | Example sink | Required encoding | Notes |
|---|---|---|---|
| HTML body | `<p>{{ name }}</p>` | `& < > " '` → entities | Default of every autoescaping template engine |
| HTML attribute, quoted | `<input value="{{ v }}">` | Same entities; **always quote the attribute** | Unquoted attributes break on space; `onfocus=` can be injected |
| HTML attribute, event handler or `style` | `onclick="..."`, `style="..."` | Do not put data here at all | Use data attributes + JS, or CSS classes |
| URL attribute | `<a href="{{ url }}">` | Validate scheme (`https:`/relative), then attribute-encode | `javascript:` and `data:` are the issue; see §7 |
| Query string component | `?q={{ term }}` | `encodeURIComponent` / `urlencode` | Then the whole URL is attribute-encoded if in HTML |
| JavaScript string inside `<script>` | `var x = "{{ v }}"` | JSON-encode and also escape `</` (`<\/`) and `U+2028/2029` | Better: put data in a `<script type="application/json">` or data attribute and read it |
| JavaScript code position | `var x = {{ v }}` | Not possible to encode safely | Never |
| CSS value | `color: {{ v }}` | Allowlist tokens (hex colors, keywords) | CSS injection can exfiltrate via `url()` and attribute selectors |
| HTTP header | `Location: {{ v }}` | Reject CR/LF; validate | See open redirects in `ssrf-and-server-side.md` |
| JSON response body | `res.json({...})` | JSON encoding; serve `Content-Type: application/json` + `nosniff` | Not XSS if never rendered as HTML; becomes XSS when a browser sniffs it |

Passing data from server to client: the robust pattern avoids inline script
string concatenation entirely.

```html
<!-- Server renders JSON with HTML-safe escaping of < > & into a non-executing script -->
<script id="init" type="application/json">{{ initial_state | tojson }}</script>
<script nonce="{{ nonce }}">
  const state = JSON.parse(document.getElementById('init').textContent);
</script>
```

Jinja's `tojson` filter, Rails' `json_escape`/`to_json` in ERB, Django's
`json_script` tag, and Next/Remix's built-in hydration serialization all do
the `<`-escaping that plain `JSON.stringify` does not. If you must inline,
`JSON.stringify(x).replace(/</g, '\\u003c')` is the minimum.

## 3. Framework defaults and escape hatches

Every modern framework autoescapes by default. The audit is finding where
it was turned off.

| Framework / engine | Default | Escape hatch to audit | Notes |
|---|---|---|---|
| React / Preact | Escapes text children and attribute values | `dangerouslySetInnerHTML={{__html}}`; `href={userValue}` (scheme not checked by React 18; React 19 warns on `javascript:`); `<a target=_blank>` without `rel` is a different issue | Props spread onto DOM elements from user objects can set `dangerouslySetInnerHTML` |
| Vue | Mustache and `v-bind` escape | `v-html`; `:href` with `javascript:` (Vue does not sanitize); render functions `domProps: { innerHTML }` | Server-rendered Vue inherits the same rules |
| Svelte | Escapes `{expr}` | `{@html expr}` | Svelte docs say it plainly: do not pass user content |
| Angular | Sanitizes `[innerHTML]` with its own sanitizer; escapes bindings | `bypassSecurityTrustHtml/Url/Script/Style/ResourceUrl` via `DomSanitizer` | Angular's sanitizer is decent but strips rather than preserving; DOMPurify is more configurable |
| Solid | Escapes | `innerHTML={}` prop | |
| Lit | Escapes template values | `unsafeHTML()`, `unsafeSVG()`, `unsafeCSS()` | |
| Jinja2 (Flask) | Autoescape **on for `.html/.htm/.xml/.xhtml` templates only** | `|safe`, `Markup()`, `{% autoescape false %}`, `render_template_string` | Templates with other extensions (`.txt`, `.jinja`) are not escaped unless `autoescape=True` is set |
| Django templates | Autoescape on | `|safe`, `mark_safe()`, `{% autoescape off %}`, `format_html` misused with `mark_safe` | `format_html` is the right tool for building HTML with variables |
| ERB (Rails) | Escapes `<%= %>` | `raw`, `.html_safe`, `<%== %>`, `content_tag` with `html_safe` strings; `link_to` with user URL (scheme not checked) | `sanitize` helper exists and is Loofah-based; prefer it over `html_safe` |
| Blade (Laravel) | `{{ }}` escapes | `{!! !!}` | `@json` for passing data to JS |
| Twig (Symfony) | Autoescape on | `|raw`, `{% autoescape false %}` | Use `|e('js')`, `|e('css')`, `|e('url')` for non-HTML contexts |
| Go `html/template` | Context-aware autoescape (HTML, attr, JS, URL, CSS) | `template.HTML()`, `template.JS()`, `template.URL()` type casts | Using `text/template` for HTML output is the common mistake; it does not escape at all |
| Thymeleaf | `th:text` escapes | `th:utext` | |
| JSP / JSTL | Scriptlets do not escape | `<%= %>`, `${}` without `fn:escapeXml` or `<c:out>` | `${}` in JSP EL is **not** escaped; use `<c:out value="${x}"/>` |
| Handlebars | `{{ }}` escapes | `{{{ }}}`, `SafeString` | |
| Mustache / Nunjucks / EJS | Escapes with `{{ }}` / `<%= %>` | `{{{ }}}` / `{{ x | safe }}` / `<%- %>` | EJS `<%-` is the unescaped form |
| Pug | `#{}` escapes | `!{}`, `!=` | |
| Phoenix (HEEx) | Escapes | `raw/1`, `Phoenix.HTML.safe_to_string` on user strings | |
| ASP.NET Razor | `@x` escapes | `@Html.Raw()`, `HtmlString` | |

For each escape hatch found: what feeds it? If a constant or a server-
generated string, fine, add a comment. If anything derived from user
content, it needs the sanitizer in §5 or must become a safe sink.

Vulnerable → fixed in the two most common cases:

```jsx
// VULNERABLE: user bio rendered as HTML
<div dangerouslySetInnerHTML={{ __html: user.bio }} />

// FIXED (bio is plain text): let React escape it; preserve newlines with CSS
<div style={{ whiteSpace: 'pre-wrap' }}>{user.bio}</div>

// FIXED (bio is intentionally rich HTML): sanitize with an allowlist
import DOMPurify from 'dompurify';
const clean = DOMPurify.sanitize(user.bio, { USE_PROFILES: { html: true } });
<div dangerouslySetInnerHTML={{ __html: clean }} />
```

```python
# VULNERABLE (Django): mark_safe on user content
return mark_safe(f"<b>{user.display_name}</b>")

# FIXED: format_html escapes the arguments and marks only the template safe
from django.utils.html import format_html
return format_html("<b>{}</b>", user.display_name)
```

## 4. The sinks that bypass the framework entirely

Framework escaping covers templates. Raw DOM APIs do not go through it:

| Sink | Risk | Safe alternative |
|---|---|---|
| `el.innerHTML = x`, `outerHTML`, `insertAdjacentHTML` | HTML parse | `textContent`; or sanitize |
| `document.write(x)` | HTML parse | Do not use |
| `$(x)`, `$(el).html(x)`, `.append(x)` with strings (jQuery) | `$("<img onerror=...>")` parses HTML when the string starts with `<` | `$.parseHTML` + sanitize, or `.text(x)` |
| `eval`, `new Function`, `setTimeout(string)` | Code | Never with data |
| `el.setAttribute('href', x)`, `location = x`, `location.href = x`, `window.open(x)` | `javascript:` URLs | Validate scheme (§7) |
| `el.setAttribute('on*', x)`, `el.style.cssText = x`, `el.setAttribute('style', x)` | Handler/CSS injection | Do not set from data |
| `iframe.srcdoc = x`, `<iframe src="data:text/html,...">` | Full document | Sanitize, or sandbox the iframe |
| `script.src = x`, `link.href = x` (stylesheet), `import(x)` | Loads attacker-controlled code | Allowlist origins; CSP `script-src` |
| `Range.createContextualFragment(x)`, `DOMParser.parseFromString(x, 'text/html')` then inserting | HTML parse | Sanitize before inserting; parsing alone is fine |
| `postMessage` handlers that trust `event.data` | DOM XSS | Check `event.origin` against an allowlist, then treat data as untrusted |
| `location.hash`, `location.search`, `document.referrer`, `window.name` as sources | DOM XSS input | Treat as user input |

```js
// VULNERABLE: DOM-based XSS from the hash
document.getElementById('msg').innerHTML = decodeURIComponent(location.hash.slice(1));

// FIXED
document.getElementById('msg').textContent = decodeURIComponent(location.hash.slice(1));
```

## 5. Rich text: sanitizing with DOMPurify

When the product requires user HTML (comments with formatting, CMS content,
email bodies rendered in a web client), encoding is wrong because it would
show the tags. Sanitize with an **allowlist** of elements and attributes,
using a maintained library, and sanitize on output (or on input *and*
output; the output pass is the one that matters, because the rules and
the library change).

```js
import DOMPurify from 'dompurify';

const policy = {
  ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'ul', 'ol', 'li',
                 'blockquote', 'code', 'pre', 'h2', 'h3', 'img'],
  ALLOWED_ATTR: ['href', 'title', 'alt', 'src'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/(?!\/))/i,   // no javascript:, data:, protocol-relative
  FORBID_TAGS: ['style', 'svg', 'math'],                   // svg/math have their own script surfaces
  FORBID_ATTR: ['style'],
  ADD_ATTR: ['target'],                                    // if you allow target, enforce rel below
  RETURN_TRUSTED_TYPE: false,
};

export function cleanHtml(dirty) {
  return DOMPurify.sanitize(dirty, policy);
}

// Enforce rel on links that open new windows
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer');
  }
});
```

Rules of thumb:

- Start from a tight allowlist and open it on request, never from
  "everything minus script".
- No `style` attributes or `<style>`: CSS can position invisible overlays
  over real UI (clickjacking inside your own page) and exfiltrate via
  `url()` in older engines.
- No `<svg>`/`<math>` unless you need them; they carry `<script>`,
  `<foreignObject>`, and event handlers through odd parsers.
- `<img src>` to arbitrary hosts leaks viewer IPs and referers; proxy
  images or restrict `src` to your own storage host if that matters.
- Sanitizers operate on a DOM. Server-side (Node), use
  `isomorphic-dompurify` or DOMPurify with `jsdom`. Mismatches between the
  sanitizer's parser and the browser's parser ("mXSS") are why you use a
  maintained library and update it; do not write your own regex sanitizer.
- Set a length limit before sanitizing; sanitizers are not fast on
  megabytes of nested tags.

Server-side equivalents by language: Python `nh3` (Rust-based; replaces
the unmaintained `bleach`); Ruby `Loofah`/`Rails::Html::SafeListSanitizer`
(the `sanitize` helper); Java `OWASP Java HTML Sanitizer`; PHP
`HTMLPurifier` or Symfony `HtmlSanitizer`; Go `bluemonday` (`UGCPolicy()`
is a good start); .NET `HtmlSanitizer` (mganss).

```python
import nh3
clean = nh3.clean(dirty, tags={"p","br","b","i","em","strong","a","ul","ol","li","code","pre"},
                  attributes={"a": {"href", "title"}}, url_schemes={"http", "https", "mailto"},
                  link_rel="noopener noreferrer")
```

```go
p := bluemonday.UGCPolicy()
p.AllowAttrs("class").Matching(regexp.MustCompile(`^language-[a-z]+$`)).OnElements("code")
clean := p.Sanitize(dirty)
```

## 6. Markdown, SVG, PDFs and other "not HTML" that is HTML

- **Markdown** renders to HTML and most renderers pass raw HTML through by
  default. Either disable raw HTML in the renderer (`marked`: use a
  sanitizer after, since `sanitize` option was removed; `markdown-it`:
  `html: false`; `remark`: do not use `rehype-raw`, or follow with
  `rehype-sanitize`; Python `markdown`: pass output through `nh3`;
  `commonmarker`: `unsafe: false`) *and* sanitize the output. Link
  `href`s in markdown still allow `javascript:` in several renderers;
  the sanitizer catches that.
- **SVG uploads** are XML documents that can contain `<script>` and event
  handlers. If users upload avatars, do not serve SVG from your origin.
  Options: convert to PNG server-side; serve from a separate sandboxed
  origin (`usercontent.example.net`) with `Content-Disposition: attachment`
  or a strict CSP (`script-src 'none'`); or sanitize SVG with DOMPurify's
  SVG profile and still serve it from a separate origin.
- **PDFs** rendered by the browser plugin can run JavaScript (Acrobat
  JS) in some viewers and are an origin for `postMessage`. Serve user
  PDFs with `Content-Disposition: attachment` or from a sandboxed origin.
- **HTML emails displayed in a web app**: sanitize with a very tight
  policy, block remote images by default, and render inside a sandboxed
  iframe (`sandbox="allow-same-origin"` is *not* a sandbox; use `sandbox`
  with no `allow-scripts` and a different origin).
- **User-uploaded HTML files** (reports, exports): never serve from the
  app origin. `Content-Type: text/plain` or a separate origin.

The general principle: anything the browser might interpret as a document
is a document. Serve user-controlled documents from an origin that holds
no cookies and has no privileges.

## 7. URL handling

```jsx
// VULNERABLE: href from user profile; "javascript:alert(document.cookie)" executes on click
<a href={profile.website}>Website</a>

// FIXED: parse, check scheme, fall back
function safeHttpUrl(input) {
  try {
    const u = new URL(input, window.location.origin);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : undefined;
  } catch { return undefined; }
}
const href = safeHttpUrl(profile.website);
{href ? <a href={href} rel="noopener noreferrer nofollow ugc" target="_blank">Website</a> : <span>Website</span>}
```

Points that trip people:

- Checking with `startsWith('http')` passes `httpx:` and misses leading
  whitespace/control chars that browsers strip (`"  javascript:..."`,
  `"java\tscript:"`). Parse with `URL` and compare `protocol`.
- `data:` URLs in `href` download or render content; in `src` of an
  `<iframe>` they create an attacker document. Block unless you need them.
- Protocol-relative `//evil.example` is a valid URL to another host.
- `rel="noopener"` prevents the opened tab from reaching `window.opener`
  (modern browsers default to this for `target=_blank`, but set it);
  `nofollow ugc` are SEO hints, not security.
- Redirect targets are a separate problem: `ssrf-and-server-side.md` §
  open redirects.

## 8. Trusted Types

Trusted Types is a CSP directive (`require-trusted-types-for 'script'`)
that makes the browser refuse string assignments to dangerous DOM sinks
(`innerHTML`, `script.src`, `eval`, ...) unless the value is a
`TrustedHTML`/`TrustedScript`/`TrustedScriptURL` object produced by a
registered policy. It turns "find every `innerHTML`" into a runtime
guarantee: the only way to write HTML is through your sanitizer policy.

```http
Content-Security-Policy: require-trusted-types-for 'script'; trusted-types dompurify default
```

```js
// Define the single policy that is allowed to produce TrustedHTML
if (window.trustedTypes && trustedTypes.createPolicy) {
  trustedTypes.createPolicy('default', {
    createHTML: (s) => DOMPurify.sanitize(s, { RETURN_TRUSTED_TYPE: false }),
    createScriptURL: (s) => {
      const u = new URL(s, location.origin);
      if (u.origin === location.origin || u.origin === 'https://cdn.example.com') return u.href;
      throw new TypeError('blocked script URL ' + s);
    },
  });
}
// DOMPurify can also return TrustedHTML directly: DOMPurify.sanitize(x, { RETURN_TRUSTED_TYPE: true })
```

Rollout: start with `Content-Security-Policy-Report-Only` and a
`report-to` endpoint; every violation report is an `innerHTML` you did not
know about. Frameworks: Angular has first-class support; React works with
a default policy; many third-party scripts (analytics, A/B tools) violate
it, which is exactly the point. Browser support is Chromium-based only at
the time of writing, so it is a hardening layer for the users it covers,
not a replacement for encoding.

## 9. CSP as defense in depth

A good CSP means that when encoding fails and a `<script>` tag or
`onerror=` handler lands in the page, the browser refuses to run it.
The core:

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{random per response}' 'strict-dynamic';
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none';
  report-to csp-endpoint
```

What makes it actually work versus theater:

- No `'unsafe-inline'` in `script-src`. With it, injected inline scripts
  run and the CSP stops nothing. Nonces or hashes instead.
- No `'unsafe-eval'` unless a dependency genuinely needs it (then isolate
  that dependency or replace it).
- `'strict-dynamic'` lets nonce'd scripts load further scripts, so you do
  not need to allowlist every CDN host (host allowlists are bypassable
  through JSONP endpoints and open redirects on those hosts).
- `object-src 'none'` and `base-uri 'none'` close the Flash/plugin and
  `<base>` hijack routes.
- Report-only first, read the reports, then enforce.

The step-by-step build, nonce plumbing per framework, and the reporting
setup are in `csrf-cors-headers.md` §CSP. CSP does not stop HTML
injection that does not need script (phishing forms, CSS overlays), so
it is the second layer, not the first.

## 10. Stored content and second-order rendering

Data sanitized at input time becomes unsafe when: the sanitizer library
is upgraded and the old output is no longer considered clean; the content
is rendered in a new context (an email, a PDF, a mobile WebView, an admin
panel built with a different framework); the content is exported and
re-imported; or a field that was "plain text" is later displayed with
`v-html` because someone wanted line breaks.

Therefore: encode or sanitize at **output**, every time, for the context at
hand. Input-time sanitization is an optimization and a UX choice (reject
`<script>` in a username so the user sees it was rejected), not the
security control. Store the user's original text; never store "pre-
escaped" HTML in the database, because double-encoding bugs follow and
nobody remembers which fields are which.

Admin panels deserve a special mention: the user who can inject into a
field that admins view (support tickets, order notes, usernames in an
audit log) gets XSS in the most privileged session in the system.

## 11. Detecting XSS in a codebase

```bash
# Framework escape hatches
rg -n "dangerouslySetInnerHTML|v-html|\{@html|bypassSecurityTrust|unsafeHTML|\|\s*safe\b|mark_safe|\.html_safe|<%==|\{!!|\|\s*raw\b|th:utext|template\.HTML\(|Html\.Raw|<%-\s|\{\{\{"
# Raw DOM sinks
rg -n "\.innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write|\.html\(|srcdoc|createContextualFragment"
# Sources that are commonly forgotten
rg -n "location\.(hash|search|href)|document\.referrer|window\.name|postMessage|addEventListener\(['\"]message"
# Templates that may not be autoescaped
rg -l "render_template_string|autoescape\s*(=|:)\s*(False|false|off)" ; rg -l "text/template" --type go
```

Then `semgrep --config p/xss` (or `p/react`, `p/django`, `p/flask`,
`p/rails`), which knows the frameworks' sinks. For DOM XSS in a running
app, ZAP's active scan with the DOM XSS rule, or manual testing with a
harmless marker string (`xss-test-<random>`) and checking where it lands
in the DOM via devtools: if the marker appears inside an attribute or a
script block rather than as text, the context is wrong regardless of
whether a payload would execute.

## 12. Tests

```ts
// Component test: user content is text, not markup
test('renders bio as text', () => {
  render(<Profile bio={'<img src=x onerror="document.title=1">'} />);
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
});

// Sanitizer policy test: pins the allowlist so a future "just allow style" is a visible diff
test('cleanHtml policy', () => {
  expect(cleanHtml('<p onclick="x">hi</p>')).toBe('<p>hi</p>');
  expect(cleanHtml('<a href="javascript:x">l</a>')).toBe('<a>l</a>');
  expect(cleanHtml('<a href="https://ok.example" target="_blank">l</a>'))
    .toContain('rel="noopener noreferrer"');
  expect(cleanHtml('<style>body{}</style><b>t</b>')).toBe('<b>t</b>');
});

// Integration: header present and inline script would be blocked
test('CSP has no unsafe-inline for scripts', async () => {
  const res = await request(app).get('/');
  const csp = res.headers['content-security-policy'];
  expect(csp).toMatch(/script-src[^;]*'nonce-/);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
});
```

```python
# Django: template escapes and format_html is used
def test_display_name_is_escaped(client, user_factory):
    user_factory(display_name="<b>bold</b>")
    html = client.get("/members/").content.decode()
    assert "&lt;b&gt;bold&lt;/b&gt;" in html
    assert "<b>bold</b>" not in html
```

Cross-references: CSP construction and headers in `csrf-cors-headers.md`;
template injection (input as the template) in `injection.md`; serving
uploaded files in `ssrf-and-server-side.md`; the UI-side summary in
`frontend/SKILL.md`.
