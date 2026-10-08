# Mobile frontend engineering

React Native and Expo, Flutter, and PWAs at the engineering level:
navigation libraries, list performance, state and data on a flaky network,
platform APIs and permissions, offline, images, native modules, testing,
and the PWA installability and service worker basics. Platform *design*
conventions (HIG, Material, safe areas as a design matter, gesture
affordances) are in `design/references/mobile.md`; the SKILL.md principles
(state taxonomy, effects, data layer) apply unchanged here.

## Contents

1. Detect
2. React Native and Expo
3. Lists: the number one performance problem
4. Navigation (RN)
5. State, data and offline (RN)
6. Platform APIs, permissions, and native modules (RN)
7. Flutter
8. PWA: installability, service workers, offline
9. Testing on mobile
10. Anti-patterns with fixes

## 1. Detect

```bash
grep -E '"(react-native|expo|expo-router|@react-navigation/[a-z-]+|react-native-reanimated|@shopify/flash-list|react-native-mmkv|@tanstack/react-query|zustand|nativewind|tamagui|@gluestack-ui)"' package.json
cat app.json app.config.* eas.json 2>/dev/null | head -40
cat pubspec.yaml 2>/dev/null | head -60                 # Flutter: deps (riverpod, bloc, go_router, dio)
ls public/manifest.webmanifest public/manifest.json src/sw.* 2>/dev/null; grep -n "vite-plugin-pwa\|next-pwa\|workbox" package.json
```

- `expo` present: Expo managed/CNG workflow; prefer Expo SDK modules
  (`expo-image`, `expo-router`, `expo-secure-store`) over bare RN
  equivalents; `npx expo install` to get compatible versions.
- `react-native` without `expo`: bare workflow; native code in `ios/` and
  `android/`; CocoaPods and Gradle matter.
- `expo-router` vs `@react-navigation/native` directly: file-based vs
  config-based navigation; match.
- New Architecture (`newArchEnabled: true`, default from RN 0.76): Fabric
  renderer and TurboModules; some older libraries break. Check before
  adding a dependency.
- Flutter: state library in `pubspec.yaml` (riverpod, bloc, provider,
  get_it) and router (go_router, auto_route); match.

## 2. React Native and Expo

RN is React with a different renderer: hooks, effects, state and data
rules from `react.md` apply exactly. What differs:

- Primitives: `View`, `Text`, `Pressable`, `ScrollView`, `TextInput`,
  `Image`. No DOM, no CSS cascade; styles are objects (or NativeWind/
  Tamagui/Unistyles if the repo uses them). All text must be inside
  `<Text>`.
- `Pressable` over `TouchableOpacity`; it supports `hitSlop`, pressed
  state styling, and accessibility props. Give it `accessibilityRole=
  "button"` and `accessibilityLabel` for icon buttons.
- Layout is flexbox with `flexDirection: 'column'` default. `gap` works.
  Use `useWindowDimensions()` (reactive) not `Dimensions.get` (static).
- Safe areas: `react-native-safe-area-context` `SafeAreaView`/
  `useSafeAreaInsets()`; apply insets as padding, not a wrapper per
  screen, when a header/tab bar already handles them.
- Keyboard: `KeyboardAvoidingView` (behavior `padding` iOS / `height`
  Android) or `react-native-keyboard-controller` for reliable behavior;
  `keyboardShouldPersistTaps="handled"` on scroll views with inputs.
- Animations: `react-native-reanimated` (runs on the UI thread) for
  anything beyond a fade; `Animated` from core for simple cases; `react-
  native-gesture-handler` for gestures. Avoid JS-thread animations driven
  by `setState` per frame.
- Images: `expo-image` (caching, placeholders, blurhash, `contentFit`) or
  `react-native-fast-image`; always set dimensions; downscale on the
  server or CDN (`?w=400`), never ship 4000 px images to a 400 px slot.
- Fonts: `expo-font`/`useFonts` with a splash screen held until loaded
  (`SplashScreen.preventAutoHideAsync`).
- Platform forks: `Platform.select`, `.ios.tsx`/`.android.tsx` files for
  real divergences only.
- Web target (`react-native-web`, Expo web): test it if the repo ships
  it; `Pressable`/`accessibilityRole` map to DOM semantics.

Styling convention: whatever the repo does (StyleSheet.create with a theme
object, NativeWind classes, Tamagui tokens). Tokens as a theme object are
the custom-property equivalent; read via a `useTheme()` hook.

## 3. Lists: the number one performance problem

A `ScrollView` with `.map()` renders every item; a hundred complex rows
means seconds of blank screen and a hot phone.

```tsx
import { FlashList } from '@shopify/flash-list'

<FlashList
  data={orders}
  renderItem={({ item }) => <OrderRow order={item} onPress={onPress} />}
  keyExtractor={(o) => o.id}
  estimatedItemSize={72}                        // FlashList needs this; measure once, keep accurate
  getItemType={(o) => o.kind}                   // separate recycling pools per layout type
  onEndReached={fetchNextPage}
  onEndReachedThreshold={0.5}
  ListEmptyComponent={<EmptyOrders />}
  ListFooterComponent={isFetchingNextPage ? <Spinner /> : null}
  refreshing={isRefetching}
  onRefresh={refetch}
  contentContainerStyle={{ paddingBottom: insets.bottom }}
/>
```

Rules: `FlashList` (recycling) or `FlatList` (windowing) always; never
`ScrollView` + `map` beyond ~20 items. `renderItem` stable (defined
outside render or `useCallback`) and the row component `memo`ized when
rows are heavy (this is one of the places memo is routinely justified:
lists re-render on every scroll event otherwise). Avoid inline object
styles in rows (`style={{...}}` allocates per render; `StyleSheet.create`
or hoist). `keyExtractor` by id. For `FlatList`: `windowSize`,
`maxToRenderPerBatch`, `initialNumToRender`, `removeClippedSubviews`
(Android) tune, `getItemLayout` for fixed heights (enables `scrollToIndex`
without measurement). Nested vertical lists in a scroll view are a bug
(virtualization disabled); use `ListHeaderComponent`. Images in rows
through `expo-image` with fixed sizes. Section lists: `SectionList` or
FlashList with `getItemType` headers.

Measure with the RN DevTools / React Profiler, `--perf` monitor (JS FPS
and UI FPS), and Flipper/Hermes profiler. JS FPS dropping on scroll means
work on the JS thread per frame: rows too heavy, or a `setState` on scroll
(use `useAnimatedScrollHandler` from Reanimated for scroll-driven UI).

## 4. Navigation (RN)

Two entry points to the same engine (React Navigation):

- **Expo Router** (file-based): `app/_layout.tsx`, `app/(tabs)/index.tsx`,
  `app/orders/[id].tsx`; typed routes via `experiments.typedRoutes`; deep
  links map to files automatically; `useRouter()`, `Link`, `useParams()`,
  `Stack.Screen options`.
- **React Navigation** (config-based): `createNativeStackNavigator`,
  `createBottomTabNavigator`, typed with a `RootStackParamList` and
  `NativeStackScreenProps<RootStackParamList, 'Order'>`; `linking` config
  for deep links.

Rules that hold in both: native stack (`@react-navigation/native-stack`)
over JS stack for performance and platform feel; params carry ids, not
objects (`{ orderId }`, then fetch via the cache; objects break deep links
and go stale); nested navigators sparingly (tabs > stacks is the common
shape); `useFocusEffect` for work tied to screen visibility (refetch on
focus is also TanStack Query's `refetchOnWindowFocus` with
`focusManager.setEventListener` wired to `AppState`); header configuration
in the navigator, not inside the screen's render; modals via
`presentation: 'modal'` or `'formSheet'`; auth flow as conditional
rendering of navigator groups, not navigation to a login screen with
`replace`. Handle hardware back on Android (default is correct for stacks;
`BackHandler` only for custom confirmation). Deep link testing:
`npx uri-scheme open "myapp://orders/42" --ios`.

## 5. State, data and offline (RN)

Same taxonomy as `state-management.md`: TanStack Query for server state
(the RN docs recommend it), Zustand/Jotai/Redux for client state, URL
(route params) for screen state. Mobile adds:

- **Network is flaky by default.** `@react-native-community/netinfo` wired
  to TanStack `onlineManager`; show an offline banner; queue mutations
  (`persistQueryClient` + `networkMode: 'offlineFirst'`, or a dedicated
  outbox) and replay on reconnect; design mutations to be idempotent.
- **Persistence**: `react-native-mmkv` (fast, sync) for small key-value
  and persisted stores (Zustand `persist` with an MMKV storage adapter);
  `AsyncStorage` is slow and async; `expo-sqlite`/WatermelonDB/op-sqlite
  for relational local data and real offline-first; `expo-secure-store`/
  Keychain for tokens, never AsyncStorage.
- **App lifecycle**: `AppState` for background/foreground (pause polling,
  refetch on resume); handle cold start from a deep link or push
  notification by reading the initial URL/notification before rendering
  navigators.
- **Hydrate from cache on launch** so the app shows last-known data
  instantly, then refreshes.
- Payload size matters more than on desktop: paginate, select fields,
  compress; a 1 MB JSON on 3G is seconds.

## 6. Platform APIs, permissions, and native modules (RN)

- Prefer Expo modules (`expo-camera`, `expo-location`, `expo-notifications`,
  `expo-haptics`, `expo-file-system`, `expo-image-picker`, `expo-sharing`,
  `expo-local-authentication`) in Expo projects; they handle both
  platforms and config plugins write the native permission strings.
- Permissions: request at the moment of need with a pre-prompt explaining
  why (design decides copy); handle `denied` and `blocked` states with a
  path to Settings (`Linking.openSettings()`); iOS requires
  `NSCameraUsageDescription` etc. in `app.json` `ios.infoPlist`, Android
  permissions in `android.permissions`.
- Push: `expo-notifications` or Firebase; token registration after
  permission; handle foreground, background and killed-state taps
  separately; deep link from the payload.
- Native modules: Expo Modules API (Swift/Kotlin) or TurboModules when a
  JS library does not exist; check New Architecture compatibility of any
  library (`reactnative.directory` lists it); config plugins instead of
  editing `ios/`/`android/` by hand in managed projects (`npx expo
  prebuild` regenerates them).
- Updates: EAS Update (OTA for JS/assets) with runtime version policy;
  native changes need a store build. Know which your change is.
- Security basics: no secrets in the bundle (it is extractable); certificate
  pinning only if `security` asks; tokens in secure storage; `security`
  owns the depth.

## 7. Flutter

Widgets, not components; everything is a widget tree rebuilt from state.
Engineering rules:

- **State**: match the repo (Riverpod, Bloc, Provider, GetX). Riverpod
  (`@riverpod` codegen, `AsyncNotifier`, `ref.watch`) is the modern
  default and maps to the taxonomy well: `FutureProvider`/`AsyncNotifier`
  for server state with `AsyncValue` (`loading/data/error` as a sealed
  union; use `.when`), `StateProvider`/`Notifier` for client state,
  `ref.invalidate` for refetch. Bloc for teams wanting explicit
  events→states. `setState` is fine inside a single leaf widget.
- **Rebuild discipline**: `const` constructors everywhere possible (the
  framework skips rebuilding `const` subtrees); split large `build`
  methods into small widgets (not helper methods returning widgets, which
  do not get their own element and rebuild with the parent); `ref.watch`
  on the narrowest provider or `select`; `ListView.builder`/`SliverList`
  (lazy) never `ListView(children: list.map(...))` for long lists;
  `RepaintBoundary` around expensive animated or static regions; `Image`
  with `cacheWidth/cacheHeight`.
- **Navigation**: `go_router` (declarative, deep links, redirects for
  auth, typed routes via `go_router_builder`) or Navigator 2.0 wrappers
  the repo already uses; `context.go` replaces the stack, `context.push`
  adds.
- **Data**: `dio` or `http` with interceptors; models via
  `freezed` + `json_serializable` (immutable, unions, `copyWith`); parse at
  the boundary; `Isolate.run` for heavy JSON parsing (the UI thread is
  the Dart thread).
- **Async**: `FutureBuilder`/`StreamBuilder` are fine for leaf widgets;
  for app data use the state library's async primitives to get caching
  and invalidation.
- **Platform**: `Platform.isIOS` forks sparingly; adaptive widgets
  (`Switch.adaptive`); `MethodChannel`/Pigeon for native code;
  `permission_handler` for permissions.
- **Performance tooling**: DevTools performance overlay, `flutter run
  --profile`, raster vs UI thread jank; `flutter build --analyze-size`.
- **Testing**: widget tests (`testWidgets`, `find.byType`, `tester.tap`,
  `pumpAndSettle`), golden tests for visual regression (`matchesGoldenFile`),
  `integration_test` package for e2e on device, `mocktail` for mocks,
  `ProviderScope(overrides: [...])` for Riverpod.
- **Accessibility**: `Semantics` widget for custom controls, `excludeSemantics`
  for decorative, `MergeSemantics`, `tooltip` on `IconButton`,
  `MediaQuery.textScalerOf` respected (do not hardcode heights that clip
  large text), test with TalkBack/VoiceOver.

## 8. PWA: installability, service workers, offline

A PWA is a web app with a manifest, HTTPS, and a service worker. Use the
framework's plugin (`vite-plugin-pwa`, `@serwist/next`, Nuxt `@vite-pwa/nuxt`,
SvelteKit's built-in `$service-worker`) and Workbox strategies rather than
hand-writing a service worker.

Manifest essentials: `name`, `short_name`, `start_url`, `display:
"standalone"`, `theme_color`, `background_color`, icons (192 and 512 PNG,
plus a `maskable` purpose icon), `id`, optional `screenshots` and
`shortcuts`. Link it (`<link rel="manifest">`), add `<meta name="theme-
color">`, and iOS still needs `apple-touch-icon`.

Caching strategies by resource:

| Resource | Strategy |
|---|---|
| App shell (hashed JS/CSS) | Precache at install; `CacheFirst` (immutable) |
| HTML navigations | `NetworkFirst` with offline fallback page, or app-shell model for SPAs |
| API GETs that tolerate staleness | `StaleWhileRevalidate` with max entries and max age |
| API GETs that must be fresh | `NetworkOnly`, show offline state |
| Images | `CacheFirst` with expiration (e.g. 60 entries, 30 days) |
| Mutations | `NetworkOnly` + Background Sync queue (`workbox-background-sync`) for offline replay |

```ts
// vite-plugin-pwa config excerpt
VitePWA({
  registerType: 'prompt',                       // show "Update available" instead of silently swapping mid-session
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    navigateFallback: '/index.html',
    runtimeCaching: [
      { urlPattern: /^https:\/\/api\.example\.com\/products/, handler: 'StaleWhileRevalidate', options: { cacheName: 'api-products', expiration: { maxEntries: 100, maxAgeSeconds: 3600 } } },
      { urlPattern: /\.(png|jpg|webp|avif)$/, handler: 'CacheFirst', options: { cacheName: 'images', expiration: { maxEntries: 60, maxAgeSeconds: 2592000 } } },
    ],
  },
})
```

Update flow: new SW installs, waits; prompt the user ("New version
available. Reload"), then `skipWaiting` + reload. Never `skipWaiting`
automatically while a form is half-filled. Handle `controllerchange` to
reload once.

Offline UX: `navigator.onLine` + `online`/`offline` events (unreliable;
also detect failed fetches), an offline banner, queued actions visible to
the user, and data from IndexedDB (`idb-keyval`, Dexie, or the query
cache persister). Storage limits vary; request `navigator.storage.persist()`
for important data.

Install prompt: capture `beforeinstallprompt`, show your own button at a
sensible moment, call `prompt()`; iOS has no event (show instructions for
"Add to Home Screen" once). Detect installed state with
`display-mode: standalone` media query.

Other PWA capabilities when the product needs them: Web Push (`Push API`
+ `Notification`, iOS 16.4+ for installed PWAs), Badging API, File System
Access, Web Share (`navigator.share`), Share Target in the manifest,
`screen.orientation.lock`, Wake Lock. Feature-detect each.

Debug: Chrome DevTools Application panel (manifest, SW lifecycle, cache
storage, "Update on reload" during dev), Lighthouse PWA checks; test
offline by toggling the Network panel.

## 9. Testing on mobile

- RN unit/component: Jest + `@testing-library/react-native` (`render`,
  `screen.getByRole('button', { name })`, `userEvent` from RNTL);
  `jest-expo` preset; mock native modules with `jest.mock('expo-camera')`;
  MSW works in Jest for RN with the Node setup.
- RN e2e: Maestro (YAML flows, fast to write) or Detox (gray-box, more
  setup). Run on emulator/simulator in CI (EAS Build + Maestro Cloud, or
  GitHub Actions macOS runners).
- Flutter: section 7.
- PWA: Playwright with `serviceWorkers: 'allow'`, `context.setOffline(true)`
  to test offline paths, mobile device emulation projects.
- Real devices: at least one mid-range Android (performance) and one iPhone
  (Safari/WebKit quirks, safe areas) before shipping; emulators lie about
  performance and GPU.
- Accessibility: Accessibility Inspector (Xcode), Accessibility Scanner
  (Android), TalkBack/VoiceOver pass on the main flows.

## 10. Anti-patterns with fixes

| Anti-pattern | Fix |
|---|---|
| `ScrollView` + `.map()` for lists | `FlashList`/`FlatList`/`ListView.builder` |
| Inline `renderItem` with inline styles and unmemoized heavy rows | Hoist, `memo`, `StyleSheet.create` |
| `setState` on every scroll event | Reanimated scroll handler on the UI thread |
| Passing objects as navigation params | Pass ids; fetch from cache |
| Tokens in AsyncStorage / SharedPreferences | Secure store / Keychain |
| Server data in Redux with manual loading flags | TanStack Query (RN) / Riverpod async (Flutter) |
| No offline handling; spinner forever | `onlineManager`, persisted cache, offline banner, retry |
| `Dimensions.get('window')` at module scope | `useWindowDimensions()` |
| `TouchableOpacity` with no accessibility props | `Pressable` + `accessibilityRole`/`Label` |
| Editing `ios/`/`android/` by hand in Expo managed | Config plugins |
| Shipping full-size images | CDN resizing + `expo-image` with dimensions |
| Flutter: helper methods returning widgets | Extract `StatelessWidget`s with `const` |
| Flutter: `ref.watch` of a whole large provider in a big `build` | `select`, split widgets |
| Flutter: JSON parsing on the UI thread for big payloads | `Isolate.run`/`compute` |
| PWA: hand-written service worker with `fetch` handler caching everything | Workbox strategies per resource type |
| PWA: `skipWaiting()` automatically | Prompt and reload deliberately |
| PWA: no offline fallback for navigations | `navigateFallback` / offline page |
| Treating emulator performance as real | Test on a mid-range device |
