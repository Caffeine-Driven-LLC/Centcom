# Reviewing AI-generated code

Code written by a language model (including code you wrote yourself) fails
in characteristic ways that differ from how humans fail. It is usually
syntactically clean, confidently commented, and plausible at a glance,
which is exactly what makes the defects hard to spot. This file lists the
patterns, the verification steps that catch them, and how to phrase
feedback when the author is an AI versus a human who used one.

## Contents

1. Why AI code needs a different read
2. The pattern catalogue
3. Verification steps
4. Reviewing your own generated code
5. Feedback to an AI author vs a human author
6. Reviewing an AI's review

## 1. Why AI code needs a different read

Human bugs cluster where the human was tired, rushed or confused: the
end of a long function, the error path, the boundary. Reviewers learn to
look there. Model bugs cluster where the training distribution is thin or
where the model filled a gap with something that sounded right: a library
method that does not exist, a flag that exists in a different version, a
pattern copied from a different framework, a test that mirrors the
implementation because that is what "a test for this" usually looks like.

The code also tends to be uniformly polished, which defeats the usual
heuristic of "messy code is where the bugs are". Everything looks equally
fine. So the read has to be systematic rather than heuristic: verify
symbols exist, run the code, trace the requirement, and check every test
can fail.

## 2. The pattern catalogue

### Fabricated or misremembered APIs

A method, option, flag, import or CLI argument that does not exist, or
exists in a different library or version.

```python
# pandas has no such method; the model blended read_csv options
df = pd.read_csv(path, infer_types=True)
```

```ts
// zod: .nonempty() exists on arrays and strings; .required() does not exist on strings
const schema = z.object({ name: z.string().required() });
```

```go
// strings.Contains does not take a slice; the model wanted slices.Contains
if strings.Contains(allowed, role) { ... }
```

Detection: compile and type-check; for dynamic languages, run it; for
every unfamiliar call, open the library's source or docs at the version
in the lockfile. Grep the installed package: `grep -rn "def infer_types"
$(python -c 'import pandas,os;print(os.path.dirname(pandas.__file__))')`.

### Plausible-but-wrong logic

The code reads correctly and does something subtly different:
inclusive vs exclusive bounds, timezone-naive datetime compared to aware,
`sort` on strings that should be numeric, `==` on floats, a regex that
matches the common case and not the spec, early return that skips cleanup.

```js
// Looks like "last 7 days"; actually 7 * 24h back from now, ignoring DST and calendar days
const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
```

Detection: write the edge cases down before reading the code; check each.
Run the function on them.

### Over-abstraction and unnecessary wrappers

A `BaseService`, an `AbstractRepository<T>`, a factory for one product,
a `utils/helpers.ts` with a `safeGet` that wraps optional chaining, a
`Result` type in a codebase that uses exceptions, a class with one method.
Models produce "enterprise-shaped" code because it is common in training
data.

```ts
// A wrapper around a wrapper around fetch, in a codebase that already has an api client
class HttpClientWrapper {
  constructor(private readonly client: ApiClient) {}
  async get<T>(url: string): Promise<T> { return this.client.get<T>(url); }
}
```

Detection: for each new class or interface, count the implementations and
the callers. One and one means inline it. Check whether the codebase
already has the thing (`grep -rn "class .*Client"`).

### Defensive try/except everywhere

Every function wrapped in a catch-all that logs and returns `None`,
`null`, `[]`, or `false`. Errors vanish; callers get a default they did
not ask for; the real failure surfaces three layers away as a confusing
`NoneType has no attribute`.

```python
def load_config(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load config: {e}")
        return {}   # now the app runs with no config and fails later, elsewhere
```

Detection: grep the diff for `except Exception`, `catch (e)`, `catch
{}`, `rescue => e`, `catch (Exception`, `_ => `. Each one needs a reason
and a non-default recovery. `error-handling-review.md` has the full
treatment.

### Re-implementing the standard library or existing utilities

A hand-written `chunk`, `groupBy`, `debounce`, `deepClone`, `isEmpty`,
date formatting, URL parsing, retry loop, or UUID generator, when the
language, the standard library, or an existing dependency already
provides it. Often with a bug the library version fixed years ago.

```js
// lodash is in package.json and already imported in this file
function groupBy(arr, key) { return arr.reduce((acc, x) => { (acc[x[key]] ||= []).push(x); return acc; }, {}); }
```

Detection: for every new utility function, search the repo and the
dependency manifest for an existing one. Check the standard library
(`itertools`, `collections`, `slices`, `maps`, `java.util.stream`, Kotlin
stdlib, `Array.prototype.*`, `Object.groupBy`).

### Inconsistent with repo idioms

The repo uses `pino`; the new code uses `console.log`. The repo returns
`Result`; the new code throws. The repo uses `pytest` fixtures; the new
tests use `unittest.TestCase` with `setUp`. The repo uses snake_case
JSON; the new endpoint returns camelCase. The repo has a `Money` type;
the new code uses floats.

Detection: open two neighboring files and compare conventions one by one:
logging, errors, naming, imports, test style, module layout, config
access.

### Stale or wrong comments and docstrings

Comments describing what the code did in a previous iteration of the
generation, or describing the generic version of the pattern rather than
this code. Docstrings that list parameters the function does not have.
A comment saying "handles the null case" above code that does not.

Detection: read every comment against the line below it. Diff the
docstring parameter list against the signature.

### Tests that pass trivially

Covered in `reviewing-tests.md` section 10. The AI-specific forms:

- Expected value computed by the same formula as the implementation.
- Mock returns the value the assertion checks (`mock.return_value = 42;
  assert f() == 42`).
- Test asserts the implementation's internal calls.
- Test body is `assert result is not None`.
- Many tests, one path: twelve tests that all exercise the happy path
  with different literals.
- A test that catches the exception the code raises and passes.

Detection: break the implementation (return a constant) and run the
tests. Any that stay green are not tests.

### Silent requirement drift

The task said "soft delete"; the code hard-deletes. The task said
"return 404 for unknown ids"; the code returns 200 with `null`. The task
said "only admins"; the code checks "authenticated". The task said
"paginate with a cursor"; the code uses offset. Often the description
the model writes matches the task, not the code.

Detection: write the requirement as a checklist of observable behaviors
before reading. Tick each against the code, not the description. Run the
behavior.

### Dead code and leftover scaffolding

Unused imports, functions defined and never called, variables assigned
and never read, a `main()` guard in a library module, `if __name__`
blocks in tests, example usage at the bottom of a module, `# TODO:
implement` in shipped code, placeholder returns (`return True  # TODO`).

Detection: lint with unused-detection on (`ruff F401/F841`, `eslint
no-unused-vars`, `go vet`, `cargo` warnings, `knip`, `vulture`). Grep
for `TODO`, `FIXME`, `pass  #`, `NotImplementedError`, `placeholder`,
`example`.

### Hallucinated configuration and environment

Environment variables that nothing sets, config keys that nothing reads,
Docker images with tags that do not exist, GitHub Actions with wrong
input names, CLI flags that were renamed two versions ago, `package.json`
scripts calling binaries not in dependencies.

Detection: for each config key or env var, grep for where it is set and
where it is read; both must exist. For each external reference (image
tag, action version, package version), check it resolves.

### Overly broad changes

Asked to fix one function, the model reformatted the file, renamed three
unrelated variables, reordered imports, and "improved" a neighboring
function. Each is a chance for regression and all of them hide the real
change.

Detection: `git diff --stat`; any file not implied by the task is a
question. `git diff -w` to separate whitespace from substance.

### Security defaults from tutorials

`cors({ origin: "*" })`, `verify=False`, `InsecureSkipVerify: true`,
`eval` on input, SQL built with f-strings, JWT `algorithms=["none"]`
accepted, secrets in code with a comment saying "replace in production",
`chmod 777`, `--no-verify`. Tutorials and READMEs are over-represented in
training data and they take shortcuts.

Detection: `security/references/code-audit-playbook.md` has the grep list
per language; run it on the diff.

### Confident wrong explanations

The PR description or the inline comment explains why the approach is
correct, and the explanation is itself wrong ("UUIDv4 is monotonic so it
sorts by creation time"; "Python dicts are unordered so we sort first";
"this is safe because JavaScript is single-threaded" about a race between
two awaits). Do not let the explanation substitute for verification.

## 3. Verification steps

In order; stop early only for low-risk changes.

1. **Compile, type-check, lint.** `tsc --noEmit`, `mypy`/`pyright`, `go
   build ./... && go vet ./...`, `cargo check && cargo clippy`, `./gradlew
   compileKotlin`, `dotnet build`. This alone catches most fabricated
   APIs in typed languages.
2. **Grep for symbols that do not exist.** For each imported or called
   name you do not recognize, find its definition in the repo or the
   installed dependency. In dynamic languages this is the main defense:

   ```sh
   # Python: does the attribute exist on the installed version?
   python -c "import pandas as pd; print(hasattr(pd, 'read_csv')); import inspect; print(inspect.signature(pd.read_csv))"
   # Node: inspect the installed export
   node -e "const z=require('zod'); console.log(Object.keys(z.string()))"
   # Ruby
   ruby -e 'require "active_support/all"; p "".respond_to?(:squish)'
   ```

3. **Run the tests, then break the code and run them again.** Comment out
   the new logic or make it return a constant. Tests that stay green are
   reported as not testing anything.
4. **Run the behavior.** Start the service, call the endpoint, run the
   CLI, open the page. Use the edge cases from the requirement
   checklist.
5. **Diff behavior against the requirement**, not the description. One
   line per requirement, each with "verified by: test X / manual run /
   read path Y".
6. **Check for duplicates.** For every new helper, search for an existing
   one in the repo and in the dependencies.
7. **Check scope.** `git diff --stat` against what the task implied.
8. **Run the security grep** from `security/references/
   code-audit-playbook.md` on the diff.
9. **Lint for dead code and unused symbols.**
10. **Read every comment against its code.**

## 4. Reviewing your own generated code

You are the AI author in this case, and you have the same failure modes.
Treat your own output as untrusted until verified:

- Before claiming an API exists, check it in the installed version. If
  you cannot (no network, no checkout), say "I believe X takes a Y
  parameter; verify against version Z".
- Before claiming tests pass, run them. Before claiming they are
  meaningful, break the code and run them again.
- Before claiming the requirement is met, enumerate the requirement's
  observable behaviors and check each one by running, not by reading your
  own code.
- Diff your change against the task scope and revert anything outside it.
- Reread your own comments and description against the final code, not
  against your intent when you started.
- Your description must say what you verified and how, in the same
  format you would demand of a human author. "Tests pass" means you ran
  them and are reporting the output; if you did not, say what you did
  not run.

`self-review.md` is the full author-side checklist.

## 5. Feedback to an AI author vs a human author

### To an AI (including instructing yourself or another agent)

The author has no feelings to protect and no context beyond what you
give it. Optimize for precision and completeness:

- **State the defect, the location, the expected behavior and the
  verification** in one block. "`parseDuration` on line 14 uses
  `strings.Contains(allowed, role)` where `allowed` is `[]string`; this
  does not compile. Use `slices.Contains`. Run `go build ./...` and
  confirm."
- **Give the constraint, not just the fix**, so it generalizes. "Do not
  add catch-all exception handlers that return defaults; let errors
  propagate unless there is a specific recovery, and say what it is."
- **Point to the repo convention** with a file reference. "Match the
  error style in `internal/orders/service.go` (wrapped with `%w`,
  sentinel errors in `errors.go`)."
- **Require evidence.** "Report the test command and its output. Report
  the output of breaking the function and re-running the tests."
- **Scope explicitly.** "Change only `handler.go` and its test. Revert
  formatting changes to other files."
- **Batch everything** into one message; there is no cost to length and
  a high cost to rounds.
- **Do not praise.** It carries no information for an AI author; use the
  space for the next constraint.

### To a human who used an AI

Assume good faith; the human may not have read every line either, and
the point is to get both the code and the practice fixed:

- Review the code as code. The provenance does not change the severity
  rubric.
- Where a pattern is characteristic (fabricated API, trivially passing
  tests), name it plainly without accusation: "This method does not
  exist in pandas 2.2 (`pd.read_csv` has no `infer_types`); worth a
  quick run before pushing, these slip through generated code easily."
- Ask for the verification evidence you would ask of any author: tests
  run, behavior exercised.
- If the whole PR shows signs of not having been read by the human
  (contradictory comments, dead scaffolding, description that does not
  match code), say so once at the top, kindly and directly: "I think
  parts of this were generated and not reviewed before opening; there
  are comments that describe code that is not here (lines 12, 40) and
  tests that pass with the implementation removed. Could you do a pass
  and I will re-review?" Then do not line-comment every symptom.

## 6. Reviewing an AI's review

When another agent (or you, earlier) produced a review, check it before
relaying it:

- Every blocking claim: is it verified? Does the cited line exist and
  say what the review says it says?
- Does the review comment on correctness, or only on style?
- Are the severities proportional?
- Is anything a linter would catch, and therefore noise?
- Did it miss the dangerous-line categories (`review-methodology.md`
  section 6)? Run that hunt yourself.
- Does the summary state what was checked, or does it imply a thoroughness
  it did not deliver?

Downgrade, verify or delete before passing it on. A review's value is
the trust it earns, and an unverified review spends trust it did not
have.
