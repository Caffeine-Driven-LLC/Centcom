# Login

Signing in is only needed for hosted sessions through the relay. Working alone, or on the same network (LAN), never needs an account.

```sh
centcom login        # shows a code and an address; open it in any browser
centcom whoami
centcom logout
```

Your sign-in is stored in the operating system's keychain, never in a file. `centcom devices` lists the computers signed in to your account and can remove one.
