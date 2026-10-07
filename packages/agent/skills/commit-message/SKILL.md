---
name: commit-message
description: Write a short, clear git commit message from the staged changes.
---

# Commit message

Use this when asked to commit or to write a commit message.

1. Look at what is staged (`git diff --staged`). If nothing is staged, say so and stop.
2. First line: what changed and why it matters, in the imperative ("Fix the retry limit"), at most 72 characters, no full stop.
3. If the reason is not obvious, add a blank line and two or three plain sentences about why. Do not repeat the diff.
4. Mention a breaking change on its own line starting with `BREAKING:`.
5. Never include secrets, file contents or long logs in the message.
