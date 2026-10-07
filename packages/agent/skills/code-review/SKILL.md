---
name: code-review
description: Review a change for bugs, missing tests and unclear code, and report findings by importance.
---

# Code review

Use this when asked to review a change, a branch or a pull request.

1. Read the whole change first, then the code around it that it touches.
2. Report in this order: things that are wrong or unsafe, things that will break later, missing tests, then small suggestions.
3. For each finding give the file and line, what is wrong, and what you would do instead. Say how sure you are.
4. Do not rewrite code that is fine, and do not comment on style the project's tools already enforce.
5. End with one sentence: whether you would merge it as it is.
