# Trying accounts and sharing on your own computer

Everything here runs against the backend repo's local stack (`../Centcom-backend`). Nothing leaves your machine: sign-in mail goes to Mailpit.

## 1. Start the backend

```
cd ../Centcom-backend
pnpm dev:up        # Postgres, Redis, MinIO, Mailpit (once)
pnpm dev:api       # API on http://localhost:3000        (terminal 1)
pnpm dev:relay     # relay on ws://localhost:8088/v1/ws  (terminal 2)
```

New accounts get the Team plan in development only (`DEV_DEFAULT_PLAN`), so they can use the relay.

## 2. Point the client at it

```
export CENTCOM_API_URL=http://localhost:3000
export CENTCOM_RELAY_URL=ws://localhost:8088/v1/ws
```

## 3. The real terminal paths, scripted

```
pip install pyte
python3 tools/dev/pty-collab.py
```

Two accounts, each with a throwaway home, run the real `centcom` in pseudo-terminals: both `centcom login` (the device page is approved with `tools/dev/approve-device.ts`, reading the mailed link from Mailpit), Alice runs `/share` and `/share invite <bob's e-mail>`, Bob runs `centcom join <link>` and asks for something, Alice runs `/share run 1`, and Bob sees the agent's answer. The agent is the scripted mock Codex (`tools/codex`), so no model login is needed. Exit code 0 means every step passed.

### The development keychain

A machine without a Secret Service (a CI box, a container) has nowhere to keep a sign-in between two `centcom` runs, so `centcom login` signed in for that one process only. For development and checks, `CENTCOM_KEYCHAIN=file:<folder>` keeps the sign-in and the device keys in that folder instead (one 0600 file per entry). It is never the default: the product keeps private keys in the OS keychain, and `CENTCOM_KEYCHAIN=memory` keeps everything in the process.

## 4. By hand

1. `centcom login`, open the printed page, sign in with any address (the mail is at http://127.0.0.1:8025) and allow the device.
2. In a project: `centcom`, then `/share`, then `/share invite someone@example.test` (or `/share link` for a watch-only link).
3. In another terminal (another account, or the same one): `centcom join <link>`.
4. Alice approves what Bob asks with `/share run <n>` (or `/share auto`).
