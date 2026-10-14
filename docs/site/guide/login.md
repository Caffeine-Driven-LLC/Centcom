# Login

Signing in is only needed for hosted sessions through the relay. Working alone, or on the same network (LAN), never needs an account.

```sh
centcom login        # shows a code and an address; open it in any browser
centcom whoami
centcom logout
```

Your sign-in and your device keys are stored in the operating system's keychain, never in a file. `centcom devices` lists the computers signed in to your account and can remove one (`centcom devices revoke <dev_id>`). `centcom logout --revoke-device` also removes this computer from the account.

On a computer with no keychain (a server or a container), `centcom login` signs in for that run only. `centcom doctor` checks the keychain.

Plans and limits are in [Accounts and plans](./billing.md).
