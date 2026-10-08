#!/usr/bin/env python3
"""Summarize a unified diff for review sizing and risk triage.

Reads a unified diff from stdin (git diff, gh pr diff, a .patch file) and
prints:

  - totals: files, added/removed lines, hand-written vs generated vs test
  - files grouped by top-level directory with per-file +/-
  - risk flags by category (migrations, auth, config/secrets, lockfiles,
    CI, infra, dependencies, generated, binary, deletions, large files)
  - dangerous-line hits inside added/removed lines (destructive SQL,
    removed guards, disabled TLS, skipped tests, lint disables, etc.)
  - the largest hunks (where attention is most needed)
  - test-to-code ratio and a suggested review depth

Usage:
  git diff main...HEAD | python3 diff_stats.py
  gh pr diff 123 | python3 diff_stats.py --top 15
  python3 diff_stats.py < change.patch --json

Options:
  --top N      number of largest hunks / files to show (default 10)
  --json       emit machine-readable JSON instead of text
  --no-lines   skip the dangerous-line scan (faster on huge diffs)

Stdlib only. Heuristics are deliberately broad; treat flags as prompts to
look, not verdicts. Exit code is 0 unless the input is not a diff.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field, asdict

# --------------------------------------------------------------------------
# Classification patterns
# --------------------------------------------------------------------------

TEST_PATH = re.compile(
    r"(^|/)(tests?|__tests__|spec|specs|test_utils|testing|fixtures?)(/|$)"
    r"|(_test|\.test|\.spec|_spec|Test|Tests|Spec)\.[a-z]+$"
    r"|(^|/)test_[^/]+\.py$"
    r"|(^|/)conftest\.py$",
    re.IGNORECASE,
)

GENERATED_PATH = re.compile(
    r"\.(pb|pb2|pb2_grpc|generated|gen|g|d|min|bundle|snap)\.[a-z]+$"
    r"|(^|/)(generated|gen|__generated__|__snapshots__|dist|build|out|target|\.next|coverage)/"
    r"|\.snap$|\.lock$|-lock\.(json|yaml)$|(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|go\.sum|Podfile\.lock|Package\.resolved|packages\.lock\.json|uv\.lock|bun\.lockb?|flake\.lock)$"
    r"|(^|/)(schema\.graphql|openapi\.(json|yaml|yml)|swagger\.(json|yaml))$"
    r"|\.(svg|png|jpe?g|gif|ico|woff2?|ttf|otf|eot|pdf|zip|jar|wasm|so|dylib|dll|exe|bin|mp[34]|webm|mov)$",
    re.IGNORECASE,
)

RISK_PATH: dict[str, re.Pattern[str]] = {
    "migration": re.compile(
        r"(^|/)(migrations?|migrate|db/migrate|alembic/versions|prisma/migrations|flyway|liquibase|schema)(/|$)"
        r"|(^|/)[0-9]{4,}[_-].*\.(sql|rb|py|js|ts|go|kt|java|cs|php)$|schema\.(prisma|rb|sql)$|structure\.sql$",
        re.IGNORECASE,
    ),
    "auth": re.compile(
        r"(auth|authn|authz|login|logout|session|password|passwd|credential|oauth|oidc|saml|jwt|token|permission|policy|policies|rbac|acl|guard|middleware/auth|cors|csrf)",
        re.IGNORECASE,
    ),
    "payments": re.compile(r"(payment|billing|invoice|stripe|paypal|braintree|checkout|refund|charge|ledger|wallet|payout)", re.IGNORECASE),
    "config": re.compile(
        r"(^|/)(\.env[^/]*|config|configs|settings|appsettings[^/]*\.json|application[^/]*\.(ya?ml|properties)|\.npmrc|\.yarnrc[^/]*|pyproject\.toml|setup\.cfg|tsconfig[^/]*\.json|\.babelrc|babel\.config\.[a-z]+|webpack\.config\.[a-z]+|vite\.config\.[a-z]+|next\.config\.[a-z]+|nuxt\.config\.[a-z]+|jest\.config\.[a-z]+|vitest\.config\.[a-z]+|\.eslintrc[^/]*|eslint\.config\.[a-z]+|biome\.json|ruff\.toml|\.golangci\.ya?ml|\.rubocop\.ya?ml|rustfmt\.toml|clippy\.toml|\.editorconfig|\.prettierrc[^/]*)(/|$)",
        re.IGNORECASE,
    ),
    "secrets": re.compile(r"(secret|\.pem$|\.key$|\.p12$|\.pfx$|\.jks$|\.keystore$|id_rsa|credentials|service[_-]?account.*\.json$|\.htpasswd$|\.netrc$)", re.IGNORECASE),
    "lockfile": re.compile(
        r"(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|go\.sum|Podfile\.lock|Package\.resolved|packages\.lock\.json|uv\.lock|bun\.lockb?|flake\.lock|mix\.lock|pubspec\.lock)$",
        re.IGNORECASE,
    ),
    "dependencies": re.compile(
        r"(^|/)(package\.json|requirements[^/]*\.txt|Pipfile|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile|composer\.json|build\.gradle(\.kts)?|pom\.xml|settings\.gradle(\.kts)?|Package\.swift|Podfile|pubspec\.yaml|mix\.exs|[^/]*\.csproj|Directory\.Packages\.props|deno\.json|bun\.toml)$",
        re.IGNORECASE,
    ),
    "ci": re.compile(
        r"(^|/)(\.github/(workflows|actions)/|\.gitlab-ci\.ya?ml|\.circleci/|Jenkinsfile|azure-pipelines[^/]*\.ya?ml|bitbucket-pipelines\.ya?ml|\.travis\.ya?ml|buildkite/|\.buildkite/|cloudbuild\.ya?ml|\.drone\.ya?ml|codemagic\.ya?ml|\.pre-commit-config\.ya?ml|\.husky/|lefthook\.ya?ml)",
        re.IGNORECASE,
    ),
    "infra": re.compile(
        r"(^|/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|[^/]*\.tf|[^/]*\.tfvars|terragrunt\.hcl|k8s/|kubernetes/|helm/|charts/|manifests/|[^/]*\.(cfn|cloudformation)\.(ya?ml|json)|template\.ya?ml|serverless\.ya?ml|Pulumi\.[^/]*\.ya?ml|cdk\.json|fly\.toml|render\.ya?ml|vercel\.json|netlify\.toml|Procfile|nginx[^/]*\.conf|Caddyfile|ansible/|playbook[^/]*\.ya?ml)",
        re.IGNORECASE,
    ),
    "public-api": re.compile(
        r"(^|/)(api|routes?|controllers?|handlers?|endpoints?|resolvers?|graphql|grpc|proto|openapi|swagger|public|sdk|index\.(ts|js|d\.ts))(/|\.|$)|\.proto$|\.graphql$|openapi\.(json|ya?ml)$",
        re.IGNORECASE,
    ),
    "data-deletion": re.compile(r"(delete|destroy|purge|cleanup|clean_up|gc|retention|archive|truncate|drop)", re.IGNORECASE),
    "crypto": re.compile(r"(crypt|cipher|hash|hmac|sign|verify|kms|vault|tls|ssl|cert)", re.IGNORECASE),
    "concurrency": re.compile(r"(worker|queue|job|cron|scheduler|consumer|producer|lock|mutex|semaphore|pool|async|concurrent|parallel|thread|goroutine|actor)", re.IGNORECASE),
}

# Dangerous content inside +/- lines. Each: (category, regex, applies_to_sign)
# sign: '+' added lines, '-' removed lines, '*' both
DANGEROUS_LINES: list[tuple[str, re.Pattern[str], str]] = [
    ("destructive-sql", re.compile(r"\b(DROP\s+(TABLE|COLUMN|INDEX|DATABASE|SCHEMA)|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+\S+\s+(DROP|RENAME)|remove_column|drop_table|rename_column|rename_table|dropColumn|dropTable|renameColumn|DropColumn|DropTable|RenameColumn|removeColumn|removeTable)\b", re.IGNORECASE), "+"),
    ("not-null-added", re.compile(r"\b(NOT\s+NULL|null:\s*false|nullable:\s*false|\.notNull\(\)|AlterField.*null=False)\b", re.IGNORECASE), "+"),
    ("non-concurrent-index", re.compile(r"\bCREATE\s+(UNIQUE\s+)?INDEX\b(?!.*CONCURRENTLY)|add_index(?!.*concurrently)|createIndex(?!.*concurrently)", re.IGNORECASE), "+"),
    ("removed-guard", re.compile(r"\b(authoriz|authenticat|permission|can\?|policy|verify|validate|assert|require[A-Z_]|ensure[A-Z_]|check[A-Z_]|isAdmin|is_admin|is_staff|hasRole|has_role|@login_required|@permission_required|\[Authorize|requireAuth|before_action|@PreAuthorize|@Secured|RolesAllowed)", re.IGNORECASE), "-"),
    ("permission-widening", re.compile(r"\b(allow_all|AllowAny|permitAll|anonymous|public\s*=\s*true|is_superuser\s*=\s*True|role\s*[:=]\s*['\"]?admin|0\.0\.0\.0|\*\s*[,\]]|chmod\s+[0-7]*7[0-7]*7|0o?777|AllowAnonymous|skip_authorization|skip_before_action\s*:authenticate)\b", re.IGNORECASE), "+"),
    ("tls-disabled", re.compile(r"(verify\s*=\s*False|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED|--insecure|--no-verify|ssl_verify\s*=\s*false|CURLOPT_SSL_VERIFYPEER,\s*(false|0)|TrustAllCerts|allowsArbitraryLoads|ServerCertificateValidationCallback)", re.IGNORECASE), "+"),
    ("secret-literal", re.compile(r"(api[_-]?key|secret|passw(or)?d|token|private[_-]?key|client[_-]?secret)\s*[:=]\s*['\"][A-Za-z0-9+/=_\-]{12,}['\"]|AKIA[0-9A-Z]{16}|sk_(live|test)_[0-9a-zA-Z]{10,}|ghp_[0-9A-Za-z]{30,}|xox[baprs]-[0-9A-Za-z-]{10,}|-----BEGIN (RSA|EC|OPENSSH|PGP|DSA) PRIVATE KEY", re.IGNORECASE), "+"),
    ("test-skipped", re.compile(r"(\.only\(|\.skip\(|\bxit\(|\bxdescribe\(|\bfit\(|\bfdescribe\(|@pytest\.mark\.skip|@unittest\.skip|@Ignore\b|@Disabled\b|t\.Skip\(|#\[ignore\]|\bskip:\s*true|pending\(|:skip\s*=>|xtest\()"), "+"),
    ("lint-disabled", re.compile(r"(eslint-disable|@ts-ignore|@ts-expect-error|# noqa|# type: ignore|//\s*nolint|rubocop:disable|phpcs:ignore|@SuppressWarnings|#pragma warning disable|#\[allow\(|// @ts-nocheck|# pylint: disable|@Suppress\()"), "+"),
    ("debug-leftover", re.compile(r"^\s*(console\.(log|debug|dir|trace)|print\(|println!\(|fmt\.Print(ln|f)?\(|System\.out\.print|puts |var_dump|dd\(|dump\(|debugger\b|binding\.pry|byebug|breakpoint\(\)|pdb\.set_trace|dbg!\(|NSLog\(|debugPrint\(|Console\.WriteLine)"), "+"),
    ("todo-marker", re.compile(r"\b(TODO|FIXME|XXX|HACK|WIP|DO NOT MERGE|REMOVE ME|TEMP)\b"), "+"),
    ("catch-all", re.compile(r"(except\s*:|except\s+(Exception|BaseException)\b|catch\s*\(\s*(Exception|Throwable|\.\.\.|e|err|error|_)?\s*\)|rescue\s*(=>\s*\w+)?\s*$|rescue\s+Exception|catch\s*\{|catch\s*\(\s*\\?(Throwable|Exception)\s+\$)"), "+"),
    ("shell-exec", re.compile(r"\b(exec\(|execSync\(|spawn\(|spawnSync\(|subprocess\.(run|call|Popen|check_output)|os\.system\(|shell\s*=\s*True|Runtime\.getRuntime\(\)\.exec|ProcessBuilder\(|system\(|popen\(|`[^`]*\$\{|Process\.Start\(|os/exec|exec\.Command\()"), "+"),
    ("dangerous-eval", re.compile(r"\b(eval\(|new Function\(|exec\(|pickle\.loads?\(|yaml\.load\((?!.*Loader)|unserialize\(|Marshal\.load|ObjectInputStream|innerHTML\s*=|dangerouslySetInnerHTML|\.html\(|v-html|\|\s*safe\b|\{!!)"), "+"),
    ("network-call", re.compile(r"\b(fetch\(|axios\.|http\.(get|post|request)|https?\.request|requests\.(get|post|put|delete|request)|httpx\.|urllib\.request|HttpClient|RestTemplate|WebClient|Net::HTTP|curl_exec|URLSession|reqwest::)"), "+"),
    ("default-changed", re.compile(r"\b(default\s*[:=]|DEFAULT\s+|defaultValue|default_value|getOrDefault|unwrap_or\(|\?\?\s*['\"\d]|\|\|\s*['\"\d]|\.get\([^,]+,\s*[^)]+\))", re.IGNORECASE), "*"),
    ("force-flag", re.compile(r"(--force\b|force:\s*true|force=True|-f\s+rm|rm\s+-rf|git\s+push\s+.*-f\b|\bforce_push|--hard\b)"), "+"),
    ("sleep", re.compile(r"\b(time\.sleep\(|Thread\.sleep\(|sleep\(|setTimeout\([^,]+,\s*\d{4,}|std::thread::sleep|usleep\(|Task\.Delay\(\d{4,})"), "+"),
    ("sql-string-build", re.compile(r"(f['\"](SELECT|INSERT|UPDATE|DELETE)|['\"](SELECT|INSERT|UPDATE|DELETE)[^'\"]*['\"]\s*\+|`[^`]*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^`]*\$\{|\$\{[^}]+\}[^`]*\b(FROM|WHERE|VALUES)\b|format\(.*(SELECT|INSERT|UPDATE|DELETE)|%\s*\(.*\)\s*$.*(SELECT|WHERE)|\.raw\(|whereRaw\(|FromSqlRaw\(|execute\(f|cursor\.execute\(.*%|\bsprintf\(.*(SELECT|WHERE)|\"(SELECT|INSERT|UPDATE|DELETE)[^\"]*\"\s*\+\s*\w|\+\s*\"\s*(WHERE|AND|OR)\b)", re.IGNORECASE), "+"),
    ("ci-dangerous", re.compile(r"(pull_request_target|uses:\s*\S+@(main|master|latest|v?\d+)\s*$|permissions:\s*write-all|secrets\.GITHUB_TOKEN.*curl|\$\{\{\s*github\.event\.(issue|pull_request|comment)\.(title|body)|workflow_dispatch:.*inputs|continue-on-error:\s*true)"), "+"),
]

LARGE_FILE_LINES = 500
HUGE_HUNK_LINES = 150


@dataclass
class Hunk:
    path: str
    header: str
    added: int = 0
    removed: int = 0
    start_new: int = 0

    @property
    def size(self) -> int:
        return self.added + self.removed


@dataclass
class FileStat:
    path: str
    old_path: str | None = None
    added: int = 0
    removed: int = 0
    is_binary: bool = False
    is_new: bool = False
    is_deleted: bool = False
    is_rename: bool = False
    is_test: bool = False
    is_generated: bool = False
    risks: list[str] = field(default_factory=list)
    hunks: list[Hunk] = field(default_factory=list)

    @property
    def churn(self) -> int:
        return self.added + self.removed


@dataclass
class LineHit:
    category: str
    path: str
    line_no: int | None
    sign: str
    text: str


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------

DIFF_GIT = re.compile(r"^diff --git (?:a/)?(\S+) (?:b/)?(\S+)$")
HUNK_HDR = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$")


def parse_diff(text: str, scan_lines: bool = True) -> tuple[list[FileStat], list[LineHit]]:
    files: list[FileStat] = []
    hits: list[LineHit] = []
    cur: FileStat | None = None
    hunk: Hunk | None = None
    new_line_no = 0
    old_line_no = 0

    for raw in text.splitlines():
        m = DIFF_GIT.match(raw)
        if m:
            cur = FileStat(path=m.group(2), old_path=m.group(1) if m.group(1) != m.group(2) else None)
            cur.is_rename = cur.old_path is not None
            files.append(cur)
            hunk = None
            continue
        if raw.startswith("diff --git") or raw.startswith("diff -"):
            cur = FileStat(path="(unparsed header)")
            files.append(cur)
            hunk = None
            continue
        if cur is None or cur.path == "(unparsed header)":
            # Support plain unified diffs without the git header, and headers with spaces
            if raw.startswith("+++ ") and not raw.startswith("+++ /dev/null"):
                p = raw[4:].strip()
                p = p[2:] if p.startswith("b/") else p
                p = p.split("\t")[0]
                if cur is not None and cur.path == "(unparsed header)":
                    cur.path = p
                else:
                    cur = FileStat(path=p)
                    files.append(cur)
            continue
        if raw.startswith("Binary files") or raw.startswith("GIT binary patch"):
            cur.is_binary = True
            continue
        if raw.startswith("new file mode"):
            cur.is_new = True
            continue
        if raw.startswith("deleted file mode"):
            cur.is_deleted = True
            continue
        if raw.startswith("rename from") or raw.startswith("rename to") or raw.startswith("similarity index"):
            cur.is_rename = True
            continue
        if raw.startswith("+++ ") or raw.startswith("--- ") or raw.startswith("index ") or raw.startswith("old mode") or raw.startswith("new mode"):
            continue
        hm = HUNK_HDR.match(raw)
        if hm:
            old_line_no = int(hm.group(1))
            new_line_no = int(hm.group(3))
            hunk = Hunk(path=cur.path, header=hm.group(5).strip(), start_new=new_line_no)
            cur.hunks.append(hunk)
            continue
        if hunk is None:
            continue
        if raw.startswith("+"):
            cur.added += 1
            hunk.added += 1
            if scan_lines:
                _scan_line(raw[1:], "+", cur.path, new_line_no, hits)
            new_line_no += 1
        elif raw.startswith("-"):
            cur.removed += 1
            hunk.removed += 1
            if scan_lines:
                _scan_line(raw[1:], "-", cur.path, old_line_no, hits)
            old_line_no += 1
        elif raw.startswith("\\"):
            pass  # "\ No newline at end of file"
        else:
            new_line_no += 1
            old_line_no += 1

    for f in files:
        f.is_test = bool(TEST_PATH.search(f.path))
        f.is_generated = bool(GENERATED_PATH.search(f.path)) or f.is_binary
        for name, pat in RISK_PATH.items():
            if pat.search(f.path):
                f.risks.append(name)
        if f.is_deleted:
            f.risks.append("file-deleted")
        if f.churn >= LARGE_FILE_LINES and not f.is_generated:
            f.risks.append("large-file-change")
    return files, hits


def _scan_line(text: str, sign: str, path: str, line_no: int, hits: list[LineHit]) -> None:
    stripped = text.strip()
    if not stripped:
        return
    # Skip obvious comment-only lines for noisy categories to reduce false positives
    is_comment = stripped.startswith(("//", "#", "*", "/*", "--", "<!--")) and "TODO" not in stripped and "FIXME" not in stripped
    for cat, pat, applies in DANGEROUS_LINES:
        if applies != "*" and applies != sign:
            continue
        if is_comment and cat not in ("todo-marker", "lint-disabled"):
            continue
        if pat.search(text):
            hits.append(LineHit(cat, path, line_no, sign, stripped[:160]))


# --------------------------------------------------------------------------
# Analysis
# --------------------------------------------------------------------------

def summarize(files: list[FileStat], hits: list[LineHit], top: int) -> dict:
    code = [f for f in files if not f.is_test and not f.is_generated]
    tests = [f for f in files if f.is_test and not f.is_generated]
    gen = [f for f in files if f.is_generated]

    code_lines = sum(f.churn for f in code)
    test_lines = sum(f.churn for f in tests)
    gen_lines = sum(f.churn for f in gen)
    ratio = (test_lines / code_lines) if code_lines else (float("inf") if test_lines else 0.0)

    by_dir: dict[str, list[FileStat]] = defaultdict(list)
    for f in files:
        parts = f.path.split("/")
        key = parts[0] if len(parts) > 1 else "(root)"
        if len(parts) > 2:
            key = "/".join(parts[:2])
        by_dir[key].append(f)

    risk_files: dict[str, list[str]] = defaultdict(list)
    for f in files:
        for r in f.risks:
            risk_files[r].append(f.path)

    hits_by_cat: dict[str, list[LineHit]] = defaultdict(list)
    for h in hits:
        # Suppress noisy categories inside test files and generated files
        if h.category in ("network-call", "sleep", "catch-all", "debug-leftover", "default-changed", "shell-exec") and (TEST_PATH.search(h.path) or GENERATED_PATH.search(h.path)):
            continue
        if GENERATED_PATH.search(h.path):
            continue
        hits_by_cat[h.category].append(h)

    all_hunks = [h for f in files if not f.is_generated for h in f.hunks]
    largest = sorted(all_hunks, key=lambda h: h.size, reverse=True)[:top]

    high_risk_cats = {"migration", "auth", "payments", "secrets", "ci", "infra", "data-deletion", "crypto"}
    high_hits = {"destructive-sql", "removed-guard", "permission-widening", "tls-disabled", "secret-literal", "dangerous-eval", "sql-string-build", "non-concurrent-index", "not-null-added", "force-flag", "ci-dangerous"}
    has_high_path = any(r in high_risk_cats for r in risk_files)
    has_high_hit = any(c in high_hits for c in hits_by_cat)

    if code_lines == 0 and (test_lines or gen_lines):
        depth = "low"
    elif has_high_path or has_high_hit:
        depth = "high"
    elif code_lines > 400 or len(code) > 15:
        depth = "high (size)"
    elif code_lines > 50:
        depth = "medium"
    else:
        depth = "low"

    notes: list[str] = []
    if code_lines > 400:
        notes.append(f"{code_lines} hand-written lines: past the ~400-line threshold where review quality drops; consider asking for a split.")
    if code_lines > 0 and ratio < 0.2 and not all("public-api" not in f.risks and "config" in f.risks for f in code):
        notes.append(f"test-to-code ratio {ratio:.2f}: behavior code with few or no test changes; read for the missing tests.")
    if ratio == float("inf"):
        notes.append("tests-only change.")
    if gen_lines > code_lines * 3 and gen_lines > 200:
        notes.append(f"{gen_lines} generated/lockfile lines dominate the diff; review the generator inputs and the manifest, not the output.")
    if "lockfile" in risk_files and "dependencies" not in risk_files:
        notes.append("lockfile changed without a manifest change; check why.")
    if "dependencies" in risk_files and "lockfile" not in risk_files:
        notes.append("manifest changed without a lockfile change; check the lockfile is committed and in sync.")
    if "migration" in risk_files:
        notes.append("migration present: check deploy order vs code, reversibility, and locking on large tables (api-and-compat-review.md section 8; database skill).")
    if "auth" in risk_files or "removed-guard" in hits_by_cat or "permission-widening" in hits_by_cat:
        notes.append("auth-adjacent change: run the authz checks in security/references/code-audit-playbook.md.")
    if any(f.is_deleted for f in code):
        notes.append(f"{sum(1 for f in code if f.is_deleted)} code file(s) deleted: grep for remaining references and consumers.")
    if "ci" in risk_files or "infra" in risk_files:
        notes.append("CI/infra files changed: check pinned versions, permissions, and secret exposure (security/references/dependencies-supply-chain.md).")

    return {
        "totals": {
            "files": len(files),
            "code_files": len(code),
            "test_files": len(tests),
            "generated_files": len(gen),
            "added": sum(f.added for f in files),
            "removed": sum(f.removed for f in files),
            "code_lines": code_lines,
            "test_lines": test_lines,
            "generated_lines": gen_lines,
            "test_to_code_ratio": None if ratio == float("inf") else round(ratio, 2),
            "suggested_depth": depth,
        },
        "by_directory": {
            d: [{"path": f.path, "added": f.added, "removed": f.removed, "test": f.is_test, "generated": f.is_generated, "risks": f.risks}
                for f in sorted(fs, key=lambda x: x.churn, reverse=True)]
            for d, fs in sorted(by_dir.items(), key=lambda kv: -sum(f.churn for f in kv[1]))
        },
        "risk_flags": {k: sorted(v) for k, v in sorted(risk_files.items())},
        "dangerous_lines": {k: [asdict(h) for h in v] for k, v in sorted(hits_by_cat.items())},
        "largest_hunks": [{"path": h.path, "start_line": h.start_new, "added": h.added, "removed": h.removed, "context": h.header} for h in largest],
        "notes": notes,
    }


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------

def print_text(s: dict, top: int) -> None:
    t = s["totals"]
    print("== Totals ==")
    print(f"files: {t['files']}  (code {t['code_files']}, test {t['test_files']}, generated/binary/lock {t['generated_files']})")
    print(f"lines: +{t['added']} -{t['removed']}  (code {t['code_lines']}, test {t['test_lines']}, generated {t['generated_lines']})")
    r = t["test_to_code_ratio"]
    print(f"test-to-code ratio: {'n/a (tests only)' if r is None else r}")
    print(f"suggested review depth: {t['suggested_depth']}")
    print()

    print("== Files by directory (largest first) ==")
    for d, fs in s["by_directory"].items():
        total = sum(f["added"] + f["removed"] for f in fs)
        print(f"{d}/  ({len(fs)} files, {total} lines)")
        for f in fs[:top]:
            tags = []
            if f["test"]:
                tags.append("test")
            if f["generated"]:
                tags.append("generated")
            tags += f["risks"]
            tag = f"  [{', '.join(tags)}]" if tags else ""
            print(f"    +{f['added']:<5} -{f['removed']:<5} {f['path']}{tag}")
        if len(fs) > top:
            print(f"    ... and {len(fs) - top} more")
    print()

    if s["risk_flags"]:
        print("== Risk flags by path ==")
        for k, v in s["risk_flags"].items():
            print(f"{k}: {len(v)} file(s)")
            for p in v[:top]:
                print(f"    {p}")
            if len(v) > top:
                print(f"    ... and {len(v) - top} more")
        print()

    if s["dangerous_lines"]:
        print("== Dangerous-line hits (added/removed lines; verify each) ==")
        for k, v in s["dangerous_lines"].items():
            print(f"{k}: {len(v)}")
            for h in v[:top]:
                ln = f":{h['line_no']}" if h["line_no"] else ""
                print(f"    {h['sign']} {h['path']}{ln}: {h['text']}")
            if len(v) > top:
                print(f"    ... and {len(v) - top} more")
        print()

    if s["largest_hunks"]:
        print(f"== Largest hunks (top {top}) ==")
        for h in s["largest_hunks"]:
            flag = "  <-- large" if h["added"] + h["removed"] >= HUGE_HUNK_LINES else ""
            ctx = f"  {h['context']}" if h["context"] else ""
            print(f"    +{h['added']:<4} -{h['removed']:<4} {h['path']}:{h['start_line']}{ctx}{flag}")
        print()

    if s["notes"]:
        print("== Notes ==")
        for n in s["notes"]:
            print(f"  - {n}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-lines", action="store_true")
    args = ap.parse_args()

    text = sys.stdin.read()
    if not text.strip():
        print("diff_stats: no input on stdin (pipe a unified diff)", file=sys.stderr)
        return 2
    files, hits = parse_diff(text, scan_lines=not args.no_lines)
    if not files:
        print("diff_stats: input does not look like a unified diff", file=sys.stderr)
        return 2
    s = summarize(files, hits, args.top)
    if args.json:
        json.dump(s, sys.stdout, indent=2)
        print()
    else:
        print_text(s, args.top)
    return 0


if __name__ == "__main__":
    sys.exit(main())
