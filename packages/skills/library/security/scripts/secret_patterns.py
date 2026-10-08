#!/usr/bin/env python3
"""Scan a directory for strings that look like credentials. Stdlib only, read-only.

Usage:
    python3 secret_patterns.py <dir-or-file> [<dir-or-file> ...]
    python3 secret_patterns.py . --json
    python3 secret_patterns.py . --exclude node_modules --exclude dist --exclude "*.min.js"
    python3 secret_patterns.py . --show-entropy    # also flag long high-entropy tokens (noisier)

Prints one line per hit as  path:line  rule  <redacted match>  and exits 1 when
anything was found, 0 otherwise. The matched value is redacted to its first and
last 3 characters so the report itself does not spread the secret.

This is a fast first pass for environments without gitleaks or trufflehog. It
has a fraction of their rules, no verification against providers, and does not
scan git history. Use it to triage, then run a real scanner:
    gitleaks detect --source . --redact -v
    trufflehog git file://. --only-verified

Rules are intentionally specific (known key prefixes and formats) to keep the
noise low; the optional entropy rule catches unknown formats at the cost of
false positives in minified code, hashes and base64 assets.
"""
import argparse
import fnmatch
import json
import math
import os
import re
import sys

RULES = [
    # name, regex, group index holding the secret (0 = whole match)
    ("aws-access-key-id", re.compile(r"\b((?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16})\b"), 1),
    ("aws-secret-access-key", re.compile(r"(?i)aws(?:.{0,20})?(?:secret|private)(?:.{0,20})?['\"]?\s*[:=]\s*['\"]?([A-Za-z0-9/+=]{40})\b"), 1),
    ("gcp-service-account", re.compile(r"\"type\"\s*:\s*\"service_account\""), 0),
    ("gcp-api-key", re.compile(r"\b(AIza[0-9A-Za-z_-]{35})\b"), 1),
    ("github-token", re.compile(r"\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255})\b"), 1),
    ("github-fine-grained-pat", re.compile(r"\b(github_pat_[A-Za-z0-9_]{80,})\b"), 1),
    ("gitlab-token", re.compile(r"\b(glpat-[A-Za-z0-9_-]{20,})\b"), 1),
    ("slack-token", re.compile(r"\b(xox[abprs]-[A-Za-z0-9-]{10,})\b"), 1),
    ("slack-webhook", re.compile(r"(https://hooks\.slack\.com/services/T[A-Za-z0-9]+/B[A-Za-z0-9]+/[A-Za-z0-9]+)"), 1),
    ("stripe-secret-key", re.compile(r"\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,})\b"), 1),
    ("stripe-webhook-secret", re.compile(r"\b(whsec_[A-Za-z0-9]{20,})\b"), 1),
    ("sendgrid-key", re.compile(r"\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b"), 1),
    ("twilio-key", re.compile(r"\b(SK[0-9a-fA-F]{32})\b"), 1),
    ("mailgun-key", re.compile(r"\b(key-[0-9a-zA-Z]{32})\b"), 1),
    ("openai-key", re.compile(r"\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b"), 1),
    ("anthropic-key", re.compile(r"\b(sk-ant-[A-Za-z0-9_-]{20,})\b"), 1),
    ("npm-token", re.compile(r"\b(npm_[A-Za-z0-9]{36})\b"), 1),
    ("npmrc-auth", re.compile(r"_authToken\s*=\s*([A-Za-z0-9._-]{20,})"), 1),
    ("pypi-token", re.compile(r"\b(pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{20,})\b"), 1),
    ("heroku-key", re.compile(r"(?i)heroku(?:.{0,20})?['\"]?\s*[:=]\s*['\"]?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"), 1),
    ("azure-storage-key", re.compile(r"AccountKey=([A-Za-z0-9+/=]{86,88})"), 1),
    ("azure-client-secret", re.compile(r"(?i)client[_-]?secret['\"]?\s*[:=]\s*['\"]([A-Za-z0-9~._-]{30,})['\"]"), 1),
    ("private-key-block", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----"), 0),
    ("jwt", re.compile(r"\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b"), 1),
    ("database-url-with-password", re.compile(r"\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|mssql|oracle)://[^\s:/@'\"]+:([^\s@'\"]{3,})@[^\s'\"]+)"), 2),
    ("basic-auth-url", re.compile(r"\bhttps?://[^\s:/@'\"]+:([^\s@'\"]{3,})@[^\s'\"]+"), 1),
    ("bearer-token-literal", re.compile(r"(?i)authorization['\"]?\s*[:=]\s*['\"]?bearer\s+([A-Za-z0-9._~+/=-]{20,})"), 1),
    ("generic-api-key-assignment", re.compile(r"(?i)\b(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|signing[_-]?key|encryption[_-]?key)\b['\"]?\s*[:=]\s*['\"]([A-Za-z0-9_\-/+=.]{16,})['\"]"), 1),
    ("password-assignment", re.compile(r"(?i)\b(?:password|passwd|pwd|db_pass|db_password|smtp_pass(?:word)?)\b['\"]?\s*[:=]\s*['\"]([^'\"\s]{8,})['\"]"), 1),
]

ENTROPY_RULE = re.compile(r"['\"]([A-Za-z0-9+/_=-]{32,})['\"]")

PLACEHOLDER = re.compile(
    r"(?i)(example|sample|placeholder|changeme|change_me|your[_-]?|xxx+|\*{3,}|<[^>]+>|\$\{[^}]+\}|%[^%]+%|dummy|fake|test[_-]?key|not[_-]?a[_-]?real|redacted|insert[_-]?here|todo|0{8,}|1234567|abcdef|lorem)"
)

DEFAULT_EXCLUDES = [
    ".git", "node_modules", "vendor", "dist", "build", "target", ".venv", "venv", "__pycache__",
    ".next", ".nuxt", ".svelte-kit", "coverage", ".terraform", "Pods", "*.min.js", "*.map", "*.lock",
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp",
    "*.ico", "*.pdf", "*.zip", "*.gz", "*.tar", "*.jar", "*.class", "*.pyc", "*.so", "*.dylib", "*.dll",
    "*.exe", "*.woff", "*.woff2", "*.ttf", "*.otf", "*.mp4", "*.mp3", "*.svg",
]

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_LINE_LEN = 2000


def shannon_entropy(s):
    if not s:
        return 0.0
    freq = {}
    for ch in s:
        freq[ch] = freq.get(ch, 0) + 1
    n = len(s)
    return -sum((c / n) * math.log2(c / n) for c in freq.values())


def redact(value):
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:3]}{'*' * min(len(value) - 6, 12)}{value[-3:]} (len {len(value)})"


def excluded(path, patterns):
    name = os.path.basename(path)
    return any(fnmatch.fnmatch(name, p) or fnmatch.fnmatch(path, p) for p in patterns)


def iter_files(roots, patterns):
    for root in roots:
        if os.path.isfile(root):
            yield root
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not excluded(os.path.join(dirpath, d), patterns)]
            for fn in filenames:
                p = os.path.join(dirpath, fn)
                if excluded(p, patterns):
                    continue
                try:
                    if os.path.islink(p) or os.path.getsize(p) > MAX_FILE_BYTES:
                        continue
                except OSError:
                    continue
                yield p


def looks_binary(chunk):
    return b"\x00" in chunk


def scan_file(path, show_entropy):
    hits = []
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError:
        return hits
    if looks_binary(raw[:4096]):
        return hits
    text = raw.decode("utf-8", errors="replace")
    is_example_file = re.search(r"(\.example|\.sample|\.template|\.dist)$", path) is not None
    for lineno, line in enumerate(text.splitlines(), 1):
        if len(line) > MAX_LINE_LEN:
            line = line[:MAX_LINE_LEN]
        for name, rx, group in RULES:
            for m in rx.finditer(line):
                value = m.group(group) if group else m.group(0)
                if PLACEHOLDER.search(value) or (is_example_file and name in ("generic-api-key-assignment", "password-assignment")):
                    continue
                hits.append({"path": path, "line": lineno, "rule": name, "redacted": redact(value)})
        if show_entropy:
            for m in ENTROPY_RULE.finditer(line):
                value = m.group(1)
                if PLACEHOLDER.search(value):
                    continue
                if re.fullmatch(r"[0-9a-f]{32,}", value, re.I):   # hashes: md5/sha; usually not secrets
                    continue
                if shannon_entropy(value) >= 4.5 and re.search(r"(?i)key|secret|token|pass|auth|cred", line):
                    hits.append({"path": path, "line": lineno, "rule": "high-entropy-near-keyword", "redacted": redact(value)})
    return hits


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--exclude", action="append", default=[], help="glob to exclude (repeatable); defaults already skip node_modules, .git, build dirs, binaries")
    ap.add_argument("--no-default-excludes", action="store_true")
    ap.add_argument("--show-entropy", action="store_true", help="also report high-entropy strings near credential keywords")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    patterns = ([] if args.no_default_excludes else DEFAULT_EXCLUDES) + args.exclude
    all_hits = []
    files = 0
    for p in iter_files(args.paths, patterns):
        files += 1
        all_hits.extend(scan_file(p, args.show_entropy))

    # de-duplicate identical hits (same line matched by overlapping rules)
    seen = set()
    hits = []
    for h in all_hits:
        key = (h["path"], h["line"], h["rule"])
        if key not in seen:
            seen.add(key)
            hits.append(h)

    if args.json:
        print(json.dumps({"files_scanned": files, "hits": hits}, indent=2))
    else:
        for h in hits:
            print(f"{h['path']}:{h['line']}  {h['rule']:<30} {h['redacted']}")
        print(f"\n{files} files scanned, {len(hits)} potential secret(s). "
              + ("Verify each, rotate anything real, then run gitleaks/trufflehog including history." if hits else "Run gitleaks for history and broader rules."))
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
