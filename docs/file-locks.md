# File locks

When several agents work at once, Centcom keeps **advisory** locks on the files they are editing, so you (and your teammates' agents) can see who is touching what. A lock never stops anything by itself and never touches your files.

## What a lock is

- A small file `.centcom/locks/<hash>.json` in the agent's working folder, created so that only one process can create it. It holds the process id, the agent id and when it ends. The name is a hash of the file's path, and the path is not in the file.
- A lock lasts 2 minutes by default (10 at most) and is renewed at half time while the agent runs. If the agent stops, the lock lapses (and `expire` is announced once). When an agent exits or crashes, all of its locks are released.
- A lock left by a process that is gone, or one that has run out, is taken over. A damaged lock file counts as left over.
- No operating-system file lock is taken, so nothing can block another tool. If the folder cannot be written, locks live in memory only, with one warning.

## Paths

Files are identified by their path inside the working folder: `/` separators, normalised, lower case where the file system ignores case (macOS and Windows). `..`, absolute paths and links that lead outside the folder are refused. Two names for the same file through an inside link give one lock.

## Modes (`lock.mode`)

- `warn` (default): `acquire` always succeeds and tells you who else holds the file (`heldBy`).
- `block`: `acquire` fails at once with `held` (or `timeout` if the disk is slow; nothing waits more than 5 seconds). The permission engine can use `lockGate` to deny an edit with the reason `file_locked`.

## Sharing with teammates

With a transport, each acquire, release and expiry is published as a `file.lock` event. What the relay sees is a **keyed hash** of the path (made with the session's path key), the agent id and the lifetime; the real path travels only inside the encrypted part. Incoming events from people who are in the session fill a table by hash; an entry ends when the sender says so or when its lifetime runs out on **your** clock (the sender's clock is never used). Events from non-members, from your own agents, and unknown actions are ignored.

If a teammate's agent takes a file that one of yours holds (or the other way round) you get one `lock:conflict` event and one `conflict.detected` payload (both agent ids and the hash). Without a path key nothing can be compared, so nothing is reported.

If the connection is down, locks keep working locally and up to 200 events wait to be sent (the oldest are dropped first).

## Not done here

The key and the keyed hash (injected as `pathMac`), sending frames, and arbitration on the server belong to other lanes. After a key rotation, hashes are made with the new key, and receivers compare per key id.
