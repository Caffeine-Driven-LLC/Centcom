<!-- Generated. Do not edit. -->
## What the relay can see

- Frame header fields, sizes, timing and the key id (kid)
- Queue and approval metadata (the clear parts of the session events)
- path_hmac, a keyed hash that cannot be linked across sessions
- Member public keys (the relay hands them out)

## What it never sees

- Message text, code, diffs, file paths, branch names and commands
- Session keys and device private keys
- Plaintext paths
- Anything inside the encrypted part of a frame (ct)

Traffic analysis (who talks when, and how much) is not hidden in v1.
