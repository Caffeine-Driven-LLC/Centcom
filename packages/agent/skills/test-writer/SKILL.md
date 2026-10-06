---
name: test-writer
description: Write focused tests for a function or a change, covering the normal case, the edges and the failures.
---

# Test writer

Use this when asked to add or improve tests.

1. Find how the project already writes tests (framework, folder, naming) and follow it exactly.
2. For the code under test, write one test each for: the normal case, an empty or minimal input, a boundary, and every error it can raise.
3. Keep each test small with one reason to fail, and a name that says what it checks.
4. Do not call the network or depend on the clock or random numbers; pass them in.
5. Run the tests. If one fails, say whether the test or the code is wrong before changing either.
