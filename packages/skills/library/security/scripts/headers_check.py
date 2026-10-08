#!/usr/bin/env python3
"""Report the presence and quality of HTTP security headers for a URL. Stdlib only.

Usage:
    python3 headers_check.py https://app.example.com
    python3 headers_check.py https://app.example.com/login --header "Cookie: session=..." --json
    python3 headers_check.py https://api.example.com/me --origin https://evil.example   # CORS probe
    python3 headers_check.py https://app.example.com --insecure                         # self-signed staging only

Performs one GET (following redirects, reporting the final URL) and, when --origin
is given, a second GET with that Origin header to see whether CORS reflects it.
Checks: HSTS, CSP (and the weak directives inside it), X-Content-Type-Options,
X-Frame-Options / frame-ancestors, Referrer-Policy, Permissions-Policy,
Cross-Origin-Opener/Resource-Policy, Cache-Control on HTML, Set-Cookie flags,
CORS allow-origin/credentials, and information-leaking headers (Server with a
version, X-Powered-By, X-AspNet-Version).

Exit code: 0 all good, 1 warnings only, 2 at least one failure, 3 fetch error.
Read-only: sends only GET requests to the URL you give it. Only point it at
systems you own or are authorized to test.
"""
import argparse
import json
import re
import ssl
import sys
import urllib.error
import urllib.request

PASS, WARN, FAIL, INFO = "PASS", "WARN", "FAIL", "INFO"


def fetch(url, extra_headers, insecure):
    ctx = ssl.create_default_context()
    if insecure:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", "headers-check/1.0 (+security skill)")
    for h in extra_headers:
        k, _, v = h.partition(":")
        req.add_header(k.strip(), v.strip())
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            return resp.geturl(), resp.status, resp.headers, resp.read(65536)
    except urllib.error.HTTPError as e:  # still useful: error pages have headers too
        return e.geturl(), e.code, e.headers, e.read(65536) if e.fp else b""


def parse_csp(value):
    directives = {}
    for part in value.split(";"):
        tokens = part.strip().split()
        if tokens:
            directives[tokens[0].lower()] = tokens[1:]
    return directives


def check(final_url, status, headers, body, cors_headers=None, probe_origin=None):
    results = []
    h = {k.lower(): v for k, v in headers.items()}
    all_set_cookies = headers.get_all("Set-Cookie") or []
    is_https = final_url.lower().startswith("https://")
    ctype = h.get("content-type", "")
    is_html = "text/html" in ctype

    def add(level, name, detail):
        results.append({"level": level, "check": name, "detail": detail})

    add(INFO, "final-url", f"{final_url} (HTTP {status}, {ctype or 'no content-type'})")
    if not is_https:
        add(FAIL, "https", "final URL is not HTTPS")

    # HSTS
    hsts = h.get("strict-transport-security")
    if not is_https:
        add(INFO, "hsts", "skipped (not HTTPS)")
    elif not hsts:
        add(FAIL, "hsts", "missing Strict-Transport-Security")
    else:
        m = re.search(r"max-age=(\d+)", hsts)
        age = int(m.group(1)) if m else 0
        if age < 15552000:
            add(WARN, "hsts", f"max-age={age} is under 180 days ({hsts})")
        else:
            add(PASS, "hsts", hsts)
        if "includesubdomains" not in hsts.lower():
            add(INFO, "hsts", "includeSubDomains not set (fine if subdomains are not all HTTPS)")

    # CSP
    csp = h.get("content-security-policy")
    csp_ro = h.get("content-security-policy-report-only")
    if not csp and not csp_ro:
        add(FAIL if is_html else WARN, "csp", "no Content-Security-Policy (or Report-Only) header")
    else:
        for label, value in (("csp", csp), ("csp-report-only", csp_ro)):
            if not value:
                continue
            d = parse_csp(value)
            script = d.get("script-src", d.get("default-src", []))
            problems = []
            if "'unsafe-inline'" in script and not any(s.startswith("'nonce-") or s.startswith("'sha") for s in script):
                problems.append("script-src allows 'unsafe-inline' with no nonce/hash (CSP will not stop XSS)")
            if "'unsafe-eval'" in script:
                problems.append("script-src allows 'unsafe-eval'")
            if "*" in script or "https:" in script or "http:" in script:
                problems.append("script-src allows a scheme or wildcard source")
            if any(s in ("data:", "blob:") for s in script):
                problems.append("script-src allows data:/blob:")
            if "object-src" not in d and "default-src" not in d:
                problems.append("no object-src or default-src")
            elif d.get("object-src", d.get("default-src")) not in (["'none'"],):
                problems.append("object-src is not 'none'")
            if "base-uri" not in d:
                problems.append("no base-uri (base tag hijack)")
            if "frame-ancestors" not in d:
                problems.append("no frame-ancestors (clickjacking; X-Frame-Options may cover)")
            if "report-to" not in d and "report-uri" not in d:
                problems.append("no reporting directive")
            if "script-src" not in d and "default-src" not in d:
                problems.append("neither script-src nor default-src set")
            if problems:
                add(WARN if label == "csp" else INFO, label, "; ".join(problems) + f"  [{value[:160]}{'...' if len(value) > 160 else ''}]")
            else:
                add(PASS, label, value[:200])
        if csp_ro and not csp:
            add(WARN, "csp", "only Report-Only is set; nothing is enforced")

    # nosniff
    xcto = h.get("x-content-type-options", "")
    add(PASS if xcto.lower() == "nosniff" else FAIL, "x-content-type-options", xcto or "missing")

    # Framing
    xfo = h.get("x-frame-options", "")
    fa = parse_csp(csp).get("frame-ancestors") if csp else None
    if fa:
        add(PASS, "frame-protection", f"CSP frame-ancestors {' '.join(fa)}" + (f"; X-Frame-Options {xfo}" if xfo else ""))
    elif xfo.upper() in ("DENY", "SAMEORIGIN"):
        add(PASS, "frame-protection", f"X-Frame-Options {xfo} (consider CSP frame-ancestors too)")
    else:
        add(FAIL if is_html else WARN, "frame-protection", "neither frame-ancestors nor X-Frame-Options")

    # Referrer-Policy
    rp = h.get("referrer-policy", "")
    good_rp = {"no-referrer", "strict-origin", "strict-origin-when-cross-origin", "same-origin", "no-referrer-when-downgrade"}
    if not rp:
        add(WARN, "referrer-policy", "missing (browser default is strict-origin-when-cross-origin; set it explicitly)")
    elif rp.lower().split(",")[-1].strip() in good_rp and rp.lower() != "no-referrer-when-downgrade":
        add(PASS, "referrer-policy", rp)
    else:
        add(WARN, "referrer-policy", f"{rp} (leaks full URL cross-origin or on downgrade)")

    # Permissions-Policy
    pp = h.get("permissions-policy", "")
    add(PASS if pp else WARN, "permissions-policy", pp[:160] if pp else "missing (disable camera/microphone/geolocation etc. you do not use)")

    # COOP / CORP
    coop = h.get("cross-origin-opener-policy", "")
    add(PASS if coop else INFO, "cross-origin-opener-policy", coop or "missing (same-origin recommended for apps without cross-origin popups)")
    corp = h.get("cross-origin-resource-policy", "")
    add(PASS if corp else INFO, "cross-origin-resource-policy", corp or "missing")

    # Cache-Control on HTML
    cc = h.get("cache-control", "")
    if is_html and all_set_cookies:
        if "no-store" in cc or "private" in cc:
            add(PASS, "cache-control", cc)
        else:
            add(WARN, "cache-control", f"HTML with Set-Cookie but Cache-Control is '{cc or 'missing'}' (consider no-store/private for authenticated pages)")

    # Cookies
    for sc in all_set_cookies:
        name = sc.split("=", 1)[0].strip()
        flags = sc.lower()
        issues = []
        if "secure" not in flags:
            issues.append("no Secure")
        if "httponly" not in flags:
            issues.append("no HttpOnly")
        if "samesite" not in flags:
            issues.append("no SameSite")
        elif "samesite=none" in flags and "secure" not in flags:
            issues.append("SameSite=None without Secure")
        if re.search(r";\s*domain=", flags):
            issues.append("Domain attribute set (shared with all subdomains)")
        if name.startswith("__Host-"):
            has_root_path = re.search(r";\s*path=/\s*(;|$)", flags) is not None
            if "domain=" in flags or not has_root_path or "secure" not in flags:
                issues.append("__Host- prefix requires Secure, Path=/, and no Domain")
        looks_session = re.search(r"sess|auth|token|jwt|sid|login", name, re.I)
        level = (FAIL if looks_session else WARN) if issues else PASS
        add(level, f"cookie:{name}", "; ".join(issues) if issues else "Secure, HttpOnly, SameSite present")

    # Information leakage
    server = h.get("server", "")
    if re.search(r"\d", server):
        add(WARN, "server-header", f"'{server}' includes a version")
    elif server:
        add(INFO, "server-header", server)
    for leak in ("x-powered-by", "x-aspnet-version", "x-aspnetmvc-version", "x-generator", "x-drupal-cache", "x-runtime"):
        if leak in h:
            add(WARN, leak, f"present: {h[leak]}")
    if body and re.search(rb"(Traceback \(most recent call last\)|at [\w$.]+\([\w$.]+\.java:\d+\)|node_modules/|Stack trace:|Whoops|DEBUG = True|<title>Werkzeug Debugger)", body):
        add(FAIL, "body-leak", "response body looks like a stack trace or debug page")

    # CORS
    acao = h.get("access-control-allow-origin")
    acac = h.get("access-control-allow-credentials", "").lower() == "true"
    if acao == "*" and acac:
        add(FAIL, "cors", "Allow-Origin * with credentials (spec-violating; some servers emit it)")
    elif acao == "*":
        add(INFO, "cors", "Allow-Origin * (only acceptable for public unauthenticated resources)")
    elif acao:
        add(INFO, "cors", f"Allow-Origin {acao}" + (" with credentials" if acac else ""))
    if cors_headers is not None:
        ch = {k.lower(): v for k, v in cors_headers.items()}
        p_acao = ch.get("access-control-allow-origin")
        p_acac = ch.get("access-control-allow-credentials", "").lower() == "true"
        if p_acao == probe_origin:
            add(FAIL if p_acac else WARN, "cors-reflection", f"reflects arbitrary Origin {probe_origin}" + (" WITH credentials (cross-site data theft)" if p_acac else ""))
        elif p_acao in (None, ""):
            add(PASS, "cors-reflection", f"unknown origin {probe_origin} gets no Allow-Origin")
        else:
            add(INFO, "cors-reflection", f"probe origin {probe_origin} -> Allow-Origin {p_acao}")
        if "vary" in h and "origin" in h["vary"].lower():
            add(PASS, "cors-vary", h["vary"])
        elif acao and acao != "*":
            add(WARN, "cors-vary", "Allow-Origin varies but Vary: Origin missing (cache poisoning risk)")

    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url")
    ap.add_argument("--header", action="append", default=[], help='extra request header, e.g. "Cookie: a=b" (repeatable)')
    ap.add_argument("--origin", help="also send a request with this Origin header to probe CORS reflection")
    ap.add_argument("--insecure", action="store_true", help="skip TLS verification (staging with self-signed certs only)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    try:
        final_url, status, headers, body = fetch(args.url, args.header, args.insecure)
        cors_headers = None
        if args.origin:
            _, _, cors_headers, _ = fetch(args.url, args.header + [f"Origin: {args.origin}"], args.insecure)
    except Exception as e:  # noqa: BLE001
        print(f"fetch error: {e}", file=sys.stderr)
        return 3

    results = check(final_url, status, headers, body, cors_headers, args.origin)
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        width = max(len(r["check"]) for r in results)
        for r in results:
            print(f"[{r['level']:4}] {r['check']:<{width}}  {r['detail']}")
        counts = {lvl: sum(1 for r in results if r["level"] == lvl) for lvl in (PASS, WARN, FAIL)}
        print(f"\n{counts[PASS]} pass, {counts[WARN]} warn, {counts[FAIL]} fail")
    if any(r["level"] == FAIL for r in results):
        return 2
    if any(r["level"] == WARN for r in results):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
