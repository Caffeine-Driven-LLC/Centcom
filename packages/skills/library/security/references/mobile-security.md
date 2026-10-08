# Mobile app security basics

Mobile apps run on devices the attacker owns. Anything in the binary can be
read, anything on disk can be dumped, network traffic can be intercepted
on a device the user controls, and deep links arrive from any other app.
This file covers secure storage (Keychain/Keystore), certificate pinning
and its trade-offs, deep link and intent validation, secrets in binaries,
WebView hardening, biometric gating, and the backend assumptions that
mobile apps break. Native iOS/Android plus React Native and Flutter notes.

## Contents

1. The mobile threat model in six lines
2. Secure storage: what goes where
3. Secrets in the binary: there is no such thing
4. Network: TLS, pinning, and the trade-offs
5. Deep links, universal links, app links, intents
6. WebView hardening
7. Authentication on mobile: tokens, refresh, biometrics
8. Platform-specific hardening checklists
9. React Native and Flutter notes
10. Logging, screenshots, clipboard, backups
11. Backend assumptions mobile apps break
12. Testing and detection

## 1. The threat model

- The attacker can be the user (jailbroken/rooted device, debugger,
  Frida). Client-side checks slow them down; they do not stop them.
- Other apps on the device are semi-trusted: they can send intents/URLs,
  read the clipboard (with limits), and on older/rooted devices read
  world-readable files.
- The network is hostile: public Wi-Fi, malicious proxies, and the user's
  own interception tools.
- Lost or stolen devices: data at rest must survive physical access to a
  locked device and should be bounded on an unlocked one.
- Backups and cloud sync copy app data to places with different access
  controls.
- The binary is public. Anyone can download it from the store and
  decompile it.

Consequently: the server is the authority for everything that matters;
the client minimizes what it stores, stores it in the platform's hardware-
backed store, verifies TLS properly, and treats inbound URLs as untrusted
input.

## 2. Secure storage: what goes where

| Data | iOS | Android | Not here |
|---|---|---|---|
| Tokens, refresh tokens, keys | Keychain (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` or `...AfterFirstUnlockThisDeviceOnly` for background refresh; `kSecAttrAccessControl` with biometry for high-value) | Android Keystore for keys; `EncryptedSharedPreferences`/`EncryptedFile` (Jetpack Security, keys in Keystore) for small secrets; `StrongBox` where available | `UserDefaults`/`SharedPreferences` plaintext, SQLite plaintext, files in Documents, hard-coded in code |
| Cached user data (PII) | Files in `Application Support` with `NSFileProtectionComplete`; Core Data/SQLite with SQLCipher if sensitive | Internal storage (`filesDir`, private by default) with `EncryptedFile` or SQLCipher; never external storage | External/shared storage, world-readable files, logs |
| Non-sensitive preferences | `UserDefaults` | `SharedPreferences` | |
| Passwords | Do not store; use tokens | Same | Anywhere |

```swift
// iOS: Keychain write with device-only, unlocked-only access
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.example.app.auth",
    kSecAttrAccount as String: "refreshToken",
    kSecValueData as String: token.data(using: .utf8)!,
    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
]
SecItemDelete(query as CFDictionary)
let status = SecItemAdd(query as CFDictionary, nil)
```

```kotlin
// Android: EncryptedSharedPreferences with a Keystore-backed master key
val masterKey = MasterKey.Builder(context)
    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
    .setRequestStrongBoxBacked(true)
    .build()
val prefs = EncryptedSharedPreferences.create(
    context, "auth_prefs", masterKey,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
prefs.edit().putString("refresh_token", token).apply()
```

`ThisDeviceOnly` keeps Keychain items out of iCloud Keychain and
unencrypted backups. On Android, exclude secrets from backups
(`android:allowBackup="false"` or `dataExtractionRules` excluding the prefs
file) because `EncryptedSharedPreferences` restored to a new device cannot
be decrypted anyway, and plaintext prefs would travel.

Minimize what you store at all: a short-lived access token in memory, a
refresh token in secure storage, nothing else. Cached API responses with
PII have a TTL and are purged on logout.

## 3. Secrets in the binary

Anything compiled into the app (API keys, "client secrets", encryption
keys, HMAC keys for request signing) is extractable with `strings`,
`jadx`, Hopper, or a debugger in minutes. Obfuscation raises the cost from
minutes to an hour. Therefore:

- **Do not ship server-side secrets** (Stripe secret key, database URL,
  cloud credentials, third-party admin keys). Call your own backend, which
  holds them.
- **Keys that must be in the app are identifiers**, and the service must
  restrict them: Google Maps/Firebase keys restricted to your bundle id /
  package name + SHA-1; Stripe publishable key (designed to be public);
  analytics write keys (accept that they are public; rate-limit server-
  side).
- **OAuth on mobile**: public client with PKCE, no client secret
  (RFC 8252). A "client secret" in a mobile app is decoration.
- **Request signing** with an embedded key proves the request came from
  *some copy of* the app, not from *your* app. App attestation
  (App Attest on iOS, Play Integrity on Android) is the real mechanism
  for "is this a genuine app on a genuine device", and it is still a
  signal, not a guarantee.
- `.env` files bundled via `react-native-config`/`flutter_dotenv` end up in
  the binary as plaintext. Treat them as public configuration.

Check before release: `strings app.ipa-payload/App | rg -i "sk_live|AKIA|secret|password|BEGIN PRIVATE"`; `apktool d app.apk && rg -r . ...`; MobSF does both.

## 4. Network: TLS, pinning, and the trade-offs

Baseline: HTTPS only; App Transport Security on iOS (do not add
`NSAllowsArbitraryLoads`; per-domain exceptions only with a reason);
Android `cleartextTrafficPermitted="false"` (default since API 28) and a
Network Security Config.

```xml
<!-- Android res/xml/network_security_config.xml -->
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors><certificates src="system"/></trust-anchors>   <!-- no user-added CAs in release -->
  </base-config>
  <domain-config>
    <domain includeSubdomains="true">api.example.com</domain>
    <pin-set expiration="2027-06-01">
      <pin digest="SHA-256">base64-of-current-intermediate-or-leaf-SPKI</pin>
      <pin digest="SHA-256">base64-of-backup-key-SPKI</pin>
    </pin-set>
  </domain-config>
  <debug-overrides>
    <trust-anchors><certificates src="user"/></trust-anchors>     <!-- debug builds only -->
  </debug-overrides>
</network-security-config>
```

**Certificate pinning**: the app accepts only certificates whose public
key (SPKI hash) matches a bundled list. It defeats interception by a CA
the device trusts (corporate proxies, a user-installed CA, a compromised
CA). Trade-offs, honestly:

- Pros: blocks MITM via rogue/installed CAs; raises the bar for traffic
  analysis of your API.
- Cons: a certificate rotation without updating the pins (or without a
  backup pin) bricks every installed version until users update; pinning
  does not stop a determined attacker on their own rooted device (Frida
  hooks the pin check; Objection does it in one command); it complicates
  debugging; it is often implemented wrong (pinning the leaf with no
  backup, or disabling validation on failure).
- Verdict: pin **only if** you have a threat model that needs it (banking,
  health, anti-fraud) and operational maturity for key rotation. Pin the
  intermediate CA or your own SPKI with at least one backup key, set an
  expiration so the app falls back to normal validation rather than
  breaking, and have a remote kill switch. For most apps, strict ATS/
  Network Security Config plus no user CAs in release is the right level.

Never: `NSURLSessionDelegate` that accepts any server trust; OkHttp
`HostnameVerifier { _, _ -> true }`; `TrustManager` that returns without
checking; `badCertificateCallback = (cert, host, port) => true` (Flutter);
`rejectUnauthorized: false`. Each turns TLS off.

## 5. Deep links, universal links, app links, intents

A deep link is an input from another app. Custom URL schemes
(`myapp://`) can be registered by any app, so another app can both
*receive* links meant for you and *send* you crafted ones. Universal
Links (iOS, `apple-app-site-association`) and App Links (Android,
`assetlinks.json`, `android:autoVerify="true"`) bind the `https://`
domain to your app and cannot be hijacked by other apps.

Rules:

- Use Universal/App Links for anything security-relevant (auth callbacks,
  password reset, invites). Custom schemes only as a fallback and never for
  carrying tokens.
- **Validate every parameter**: a link `myapp://open?url=https://evil`
  that loads `url` in a WebView is an open redirect into an authenticated
  context; `myapp://pay?to=attacker&amount=100` that pre-fills and auto-
  submits is theft. Allowlist paths/hosts, type-check parameters, never
  auto-perform a state change from a link without the user confirming in
  the UI.
- Auth callbacks (OAuth, magic links): verify `state`, use PKCE, and
  consume the code server-side; a code arriving by deep link must be
  bound to a flow this app instance started.
- Android: exported activities/services/receivers/providers are the
  attack surface. `android:exported="false"` unless needed; for exported
  components, validate the intent's action and extras; do not trust the
  caller; protect with a signature-level permission for intra-suite
  communication. Pending intents must be immutable (`FLAG_IMMUTABLE`) and
  explicit. Content providers need `android:grantUriPermissions` thought
  through and path-permission allowlists; never `file://` URIs across apps
  (use `FileProvider`).
- iOS: `application(_:open:options:)` and `onOpenURL` receive untrusted
  URLs; parse with `URLComponents`, check scheme/host/path against an
  allowlist, and ignore unknown parameters.

```kotlin
// Android: validating a deep link before acting
fun handle(uri: Uri) {
    if (uri.scheme != "https" || uri.host != "app.example.com") return
    when (uri.pathSegments.firstOrNull()) {
        "invite" -> uri.getQueryParameter("code")?.takeIf { it.matches(Regex("^[A-Za-z0-9_-]{16,64}$")) }?.let { showInviteConfirmation(it) }
        "doc"    -> uri.pathSegments.getOrNull(1)?.let { id -> if (isUuid(id)) openDocument(id) }   // authz happens on the server
        else     -> openHome()
    }
}
```

## 6. WebView hardening

A WebView is a browser inside your app with potentially more privileges
(JS bridges to native code, cookies for your domain). Hardening:

- Load only your own content or an allowlist of hosts; intercept
  navigation (`WKNavigationDelegate.decidePolicyFor`,
  `shouldOverrideUrlLoading`) and open everything else in the system
  browser or `SFSafariViewController`/Custom Tabs.
- JavaScript off unless needed (`javaScriptEnabled = false`). If on, no
  `addJavascriptInterface` exposing broad native methods; on Android
  target API ≥ 17 so only `@JavascriptInterface` methods are reachable;
  design the bridge as a narrow, validated message API, and check the
  page origin before honoring messages (`WKScriptMessageHandler` with
  `message.frameInfo.securityOrigin`).
- Android: `allowFileAccess = false`, `allowContentAccess = false`,
  `allowFileAccessFromFileURLs = false`,
  `allowUniversalAccessFromFileURLs = false`, `setGeolocationEnabled(false)`,
  `setSafeBrowsingEnabled(true)`, no `loadDataWithBaseURL` with a privileged
  base and untrusted HTML.
- iOS: `WKWebView` (not `UIWebView`, removed), `limitsNavigationsToAppBoundDomains`
  with `WKAppBoundDomains` in Info.plist for apps that need JS bridges.
- Never put session tokens in the WebView's URL; set cookies via the
  cookie store if the web content needs auth, scoped to your domain, or
  use a short-lived one-time code exchanged by the page.
- Clear WebView data on logout (`WKWebsiteDataStore`,
  `CookieManager.removeAllCookies`, `WebStorage.deleteAllData`).
- Rendering user-generated HTML in a WebView is XSS in an app context;
  sanitize per `xss-and-output-encoding.md` and keep the bridge off for
  that WebView.

## 7. Authentication on mobile

- OAuth 2.0 authorization code with PKCE through the system browser
  (`ASWebAuthenticationSession` / `AppAuth` / Custom Tabs), redirect via
  Universal/App Link or a claimed `https` scheme; never an embedded
  WebView login for third-party IdPs (phishable, and providers block it).
- Access tokens short-lived in memory; refresh tokens in secure storage
  with rotation and reuse detection server-side; refresh on 401, not on a
  timer; on refresh failure, log out.
- Biometrics gate *access to the stored secret* (Keychain item with
  `.biometryCurrentSet`; Android `BiometricPrompt` with a `CryptoObject`
  bound to a Keystore key requiring user authentication), not a boolean in
  app state that a debugger flips. A "biometric lock" that just hides the
  UI while the token is readable is theater.
- Device binding: generate a key pair in the secure enclave/Keystore at
  install, register the public key, and sign a nonce on sensitive
  operations. Stolen refresh tokens then do not work from another device.
- Logout clears Keychain/Keystore items, caches, WebView data, and tells
  the server to revoke.
- Session timeout on background: re-authenticate (biometric) after N
  minutes in background for sensitive apps.

## 8. Platform-specific hardening checklists

**iOS**

- ATS on; no `NSAllowsArbitraryLoads`; exceptions documented.
- Keychain with `ThisDeviceOnly` accessibility; file protection
  `NSFileProtectionComplete` for sensitive files.
- No sensitive data in `UserDefaults`, `NSLog`/`print` in release
  (`os_log` with `.private` for values), or in the pasteboard without
  `UIPasteboard.general.setItems(..., options: [.expirationDate, .localOnly])`.
- App switcher snapshot: blur or cover sensitive screens in
  `applicationDidEnterBackground`/`sceneWillResignActive`.
- Disable third-party keyboards for sensitive fields if the threat model
  warrants (`shouldAllowExtensionPointIdentifier`); `isSecureTextEntry` on
  password fields; `textContentType` so autofill works (less typing, fewer
  shoulder-surfing chances).
- Jailbreak detection: a signal, trivially bypassed; use it to adjust
  risk server-side (step-up auth), not as a gate.
- Universal Links with `apple-app-site-association` served over HTTPS
  with correct content type; `applinks` entitlement.
- Strip debug symbols and disable `get-task-allow` in release; enable
  bitcode-independent hardening flags (PIE, stack canaries are default).

**Android**

- `minSdkVersion` as high as the user base allows (security fixes stop at
  old levels); `targetSdkVersion` current.
- `android:debuggable="false"` (default in release), `allowBackup="false"`
  or `dataExtractionRules` excluding secrets, `usesCleartextTraffic="false"`.
- Network Security Config with system trust anchors only in release.
- Exported components minimized and validated; `FLAG_IMMUTABLE` on
  `PendingIntent`s; no implicit intents for sensitive data (another app
  can register for them); `FileProvider` for sharing files.
- No sensitive data in logs (`Log.d` stripped by R8/ProGuard rules in
  release), in `SharedPreferences` plaintext, on external storage, or in
  the clipboard (`ClipDescription.EXTRA_IS_SENSITIVE` on API 33+).
- `FLAG_SECURE` on sensitive windows to block screenshots/recording and
  the recents thumbnail.
- R8/ProGuard enabled (shrinks and lightly obfuscates); Play App Signing;
  Play Integrity for high-risk actions.
- Root detection: same caveat as jailbreak detection.
- WebView per §6; `BiometricPrompt` with `CryptoObject` per §7.
- Tapjacking: `filterTouchesWhenObscured="true"` on sensitive buttons.

## 9. React Native and Flutter notes

- JavaScript bundles and Dart snapshots are readable (Hermes bytecode and
  AOT Dart are harder than plain JS but not secret). Everything in §3
  applies with extra force to `react-native-config`, `expo-constants`
  extras, and `flutter_dotenv`.
- Secure storage: `react-native-keychain` or `expo-secure-store`
  (Keychain/Keystore under the hood); `flutter_secure_storage`. Not
  `AsyncStorage`/`shared_preferences` for tokens.
- Debug menus, remote debugging, and dev servers must be off in release;
  `__DEV__` checks; Flutter `kReleaseMode`.
- Over-the-air JS updates (Expo Updates, CodePush) are a supply-chain
  channel: signed updates (Expo code signing), restricted publish rights,
  review the pipeline like a deploy.
- Deep linking libraries (`expo-linking`, `go_router`) deliver the same
  untrusted URLs; validate per §5.
- Native modules from the community are dependencies with native code;
  audit them like any dependency (`dependencies-supply-chain.md`).
- WebView packages (`react-native-webview`, `webview_flutter`) expose the
  same knobs as §6; `originWhitelist` / `NavigationDelegate` to restrict
  navigation.
- Flutter `badCertificateCallback` returning true and React Native
  `NSAllowsArbitraryLoads` for `localhost` left in release are the two most
  common TLS regressions; gate them on debug mode.

## 10. Logging, screenshots, clipboard, backups

- Release builds log nothing sensitive; crash reporters (Crashlytics,
  Sentry) get scrubbed breadcrumbs and no PII in custom keys; disable
  screenshot attachment on crash for sensitive apps.
- Sensitive screens set `FLAG_SECURE` (Android) and cover themselves on
  resign-active (iOS) so the app switcher and screen recording show
  nothing.
- Clipboard: avoid putting secrets on it; if you must (one-time codes),
  mark sensitive and expire; clear on background.
- Backups: Android `dataExtractionRules`/`allowBackup`; iOS `ThisDeviceOnly`
  Keychain and `isExcludedFromBackup` for sensitive files.
- Analytics SDKs capture screens and events; configure them not to
  capture text input or PII (`logging-privacy.md` §10 applies).

## 11. Backend assumptions mobile apps break

The server team often assumes a browser. Mobile clients change:

- **CSRF**: token-in-header auth from a native app is not CSRF-prone, but
  the same API used by the web app with cookies is. Do not disable CSRF
  globally "because mobile"; separate by auth mechanism
  (`csrf-cors-headers.md` §3).
- **Rate limiting**: mobile IPs are shared (carrier NAT); limit by account
  and device id in addition to IP.
- **API versioning and kill switches**: old app versions live for years;
  the server must be able to refuse versions with known vulnerabilities
  (minimum version check with a forced-update screen).
- **Authorization is still server-side**: hiding a button in the app is
  not a control; every endpoint the app calls gets the matrix test.
- **Token lifetimes**: refresh tokens on mobile are long-lived by nature;
  rotation with reuse detection and device binding compensate.
- **Push notifications**: payloads pass through Apple/Google; keep them
  non-sensitive or encrypt; the device token is a semi-secret (anyone with
  it and your server key can push).
- **Certificate rotation**: coordinate with pinned clients (§4).
- **Attestation**: verify App Attest / Play Integrity tokens server-side
  with the platform's API; treat as a risk signal.

## 12. Testing and detection

```bash
# Static: MobSF handles both platforms (run locally in Docker; upload the APK/IPA)
docker run -it --rm -p 8000:8000 opensecurity/mobile-security-framework-mobsf:latest
# Android quick checks
apktool d app-release.apk -o out/ && rg -n "android:exported=\"true\"|allowBackup=\"true\"|debuggable=\"true\"|usesCleartextTraffic=\"true\"" out/AndroidManifest.xml
rg -rn "sk_live|AKIA|BEGIN (RSA|EC|OPENSSH) PRIVATE|password\s*=|secret\s*=" out/ | head
rg -n "setJavaScriptEnabled\(true\)|addJavascriptInterface|setAllowFileAccess\(true\)|setAllowUniversalAccessFromFileURLs\(true\)|HostnameVerifier|TrustManager|FLAG_MUTABLE" app/src/
rg -n "SharedPreferences|getSharedPreferences" app/src/ | rg -i "token|password|secret|key"
# iOS quick checks
plutil -p Payload/App.app/Info.plist | rg -i "NSAllowsArbitraryLoads|NSExceptionDomains|CFBundleURLSchemes|get-task-allow"
strings Payload/App.app/App | rg -i "sk_live|AKIA|secret|BEGIN PRIVATE|password" | head
rg -n "UserDefaults.*(token|password|secret)|NSLog\(|print\(" Sources/ | rg -i "token|password|secret"
rg -n "kSecAttrAccessibleAlways|kSecAttrAccessibleWhenUnlocked\b" Sources/      # prefer ThisDeviceOnly variants
rg -n "allowsArbitraryLoads|serverTrust|SecTrustSetAnchor|evaluate.*trust" Sources/
# React Native / Flutter
rg -n "AsyncStorage\.(setItem|multiSet)" src/ | rg -i "token|password|secret"
rg -n "badCertificateCallback|rejectUnauthorized" lib/ src/
```

Dynamic checks on a device you own: proxy traffic through Burp/mitmproxy
with your CA installed on a debug build (should work) and a release build
(should fail, proving system-trust-only and/or pinning); dump app storage
(`adb shell run-as <pkg> ls -R` on a debug build; iOS Files via Xcode
devices window) and confirm no plaintext tokens; send crafted deep links
(`adb shell am start -d "https://app.example.com/pay?to=x"`,
`xcrun simctl openurl booted "myapp://..."`) and confirm nothing happens
without user confirmation; background the app on a sensitive screen and
check the switcher thumbnail.

Cross-references: OAuth/PKCE and token threats in
`authn-authz-threats.md`; TLS baselines and pinning primitives in
`cryptography.md`; secrets handling in `secrets.md`; WebView XSS in
`xss-and-output-encoding.md`; server-side authorization in
`authn-authz-threats.md` §10-15.
