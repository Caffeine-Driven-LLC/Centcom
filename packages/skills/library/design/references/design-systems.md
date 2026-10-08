# Design systems

Token architecture and naming, theming, component API design from a design
standpoint, documentation, versioning, how to audit an existing codebase for
its implicit design system and extend it rather than fight it, and how to
introduce tokens into a tokenless codebase incrementally. Framework-specific
mechanics (CSS variables, Tailwind theme, Flutter ThemeData, SwiftUI
environment, Compose MaterialTheme) are covered where they change the
design decision.

## Contents

1. What a design system is for
2. Token architecture: the three tiers
3. Naming
4. Which tokens to define (and which not to)
5. Theming: light, dark, brand, density
6. Component API from a design standpoint
7. Auditing an existing codebase for its implicit system
8. Extending versus fighting an existing system
9. Introducing tokens into a tokenless codebase
10. Working with component libraries (shadcn, MUI, Chakra, Mantine, Material, Cupertino)
11. Documentation that gets used
12. Versioning and change
13. Platform mechanics
14. Anti-patterns

## 1. What a design system is for

A design system is the set of decisions that make twenty screens by three
people look like one product. Its parts, in order of leverage:

1. **Tokens**: the named values (color, type, space, radius, shadow,
   motion, z-index, breakpoints).
2. **Primitives**: layout components (Stack, Grid, Container) and base
   styles (reset, typography defaults).
3. **Components**: buttons, inputs, and the rest, built on tokens.
4. **Patterns**: how components combine for recurring jobs (a settings
   row, a list page with filters, a confirm dialog).
5. **Guidelines**: the direction spec, writing rules, do/don't examples.

Most products need only the first three, formalized lightly. A design
system is not a Storybook with 80 components; it is tokens that are
actually used and a handful of components that are actually consistent.
Start small and real.

## 2. Token architecture: the three tiers

**Primitive (global, option) tokens** hold raw values and are named by what
they are: `--blue-500`, `--space-4`, `--font-size-lg`, `--radius-md`,
`--shadow-2`. They do not know about usage. A product has one set.

**Semantic (alias, decision) tokens** hold roles and point at primitives:
`--color-bg-surface: var(--gray-50)`, `--color-text-muted: var(--gray-600)`,
`--color-accent: var(--blue-500)`, `--space-inset-md: var(--space-4)`.
Components use only these. Themes swap these. This tier is where the
design lives.

**Component tokens** are optional and scoped: `--button-height-md`,
`--input-border`, `--card-padding`. They point at semantic tokens and exist
so a component can be themed independently or so its internals are
legible. Use them when a component has 3+ internal values that should move
together, or when a sub-brand must restyle one component. Do not create
them for every component by reflex; it triples the token count for no gain.

Flow: primitive -> semantic -> component -> CSS property. A component's CSS
should never reference a primitive directly; if it does, that value cannot
be themed.

The practical minimum for a small product: primitives for color ramps and
the spacing/type scales, semantics for color only, and components reading
spacing and type primitives directly. Grow the semantic layer when a
second theme or a density mode appears.

## 3. Naming

Good names are predictable: a developer who has seen three tokens can guess
the fourth. The pattern is `category-property-role-variant-state`, dropping
parts that are not needed.

| Category | Pattern | Examples |
|---|---|---|
| Color | `color-{property}-{role}-{variant?}-{state?}` | `color-bg-surface`, `color-text-muted`, `color-border-strong`, `color-accent-hover`, `color-danger-bg` |
| Space | `space-{step}` and optionally `space-{purpose}-{size}` | `space-4`, `space-inset-md`, `space-stack-lg` |
| Type | `font-family-{role}`, `font-size-{step}`, `line-height-{role}`, `font-weight-{role}`, `tracking-{role}` | `font-family-display`, `font-size-lg`, `line-height-tight`, `font-weight-semibold` |
| Radius | `radius-{size}` | `radius-sm` (4), `radius-md` (8), `radius-lg` (12), `radius-full` |
| Shadow | `shadow-{level}` | `shadow-1` through `shadow-4`, or `shadow-sm/md/lg` |
| Motion | `duration-{speed}`, `ease-{type}` | `duration-fast`, `ease-out` |
| Size | `size-control-{size}`, `size-icon-{size}` | `size-control-md` (40px), `size-icon-sm` (16) |
| Z-index | `z-{layer}` | `z-dropdown` (100), `z-sticky` (200), `z-overlay` (300), `z-modal` (400), `z-toast` (500) |
| Breakpoint | `bp-{name}` | `bp-sm` (40rem), `bp-md` (48rem), `bp-lg` (64rem) |

Conventions:

- T-shirt sizes (`sm/md/lg`) for things with a natural middle (radius,
  shadow, control size); numeric steps for scales (`space-4`,
  `gray-500`); role words for semantics (`muted`, `surface`).
- Light/dark does not appear in semantic token names. `--color-bg-surface`
  is the surface in whatever theme is active. Naming a token `--dark-bg`
  defeats theming.
- Avoid names that encode the current value (`--blue-primary`); when the
  brand changes to green, the name lies.
- Match the repo's existing convention even if it is imperfect; a mixed
  convention is worse than a mediocre consistent one. shadcn's
  `--background/--foreground/--muted/--primary` is a common baseline;
  Material's `primary/onPrimary/surface/onSurface` is another.
- Keep one casing per platform: kebab for CSS, camel for JS/Dart/Swift/Kotlin,
  and generate one from the other if both exist.

## 4. Which tokens to define (and which not to)

Define tokens for anything that (a) repeats, (b) should change together,
or (c) might be themed. In practice:

**Always**: color (ramps + semantics), space scale, type scale (sizes,
families, weights, line-heights), radius, shadow/elevation, motion
(durations, easings), z-index layers, control sizes, breakpoints, focus
ring.

**Usually**: container max-widths, icon sizes, border widths (if more than
one), opacity steps for disabled/overlay.

**Rarely**: per-component sizes beyond height, letter-spacing per size
(fold into type presets), gradients (if the direction uses one, token it
once).

**Never**: one-off values that appear once, or tokens so numerous that
nobody can remember them (a 60-color semantic set). If you cannot name a
token's role in two words, it is probably a primitive leaking upward or a
one-off.

Type presets (composite tokens) are worth having: `--text-body` bundling
size, line-height, weight and family, applied as a utility class or mixin.
They prevent the drift of a heading set to the right size and the wrong
line-height.

## 5. Theming: light, dark, brand, density

A theme is a set of semantic token values. Theming works when components
use semantics only and themes are applied at a scope boundary.

**Light and dark**: two value sets for the color semantics (see color.md
for building the dark palette properly). Apply via `prefers-color-scheme`
with an override attribute (`data-theme`), and `color-scheme` for UA
controls. Images and illustrations need dark variants or filters; logos
need a light-on-dark asset.

**Brand themes** (white-label, sub-brands): swap accent and possibly
neutral tint; keep everything else. Scope them to a root attribute
(`data-brand="acme"`) and generate the ramp from one or two seed colors so
adding a brand is a two-line change.

**Density**: a multiplier applied to space and control size tokens (see
layout-and-spacing.md). Scope-able to a region (a dense table inside a
comfortable page).

**High contrast**: `prefers-contrast: more` raises border and text
contrast; `forced-colors: active` replaces colors with system colors, so
ensure borders exist (not just backgrounds) and focus uses `outline`.

**Scoped themes**: a dark sidebar in a light app, a marketing hero with
inverted colors. Redefine the semantic tokens on that element:

```css
.sidebar { --color-bg-surface: var(--gray-950); --color-text-primary: var(--gray-50); /* ... */ }
```

Everything inside inherits. This is why components must use semantics:
the button in the sidebar restyles itself for free.

## 6. Component API from a design standpoint

The props a component exposes encode the design decisions it allows.
Design the API to make the right thing easy and the wrong thing hard.

- **Variants, not booleans.** `variant="primary | secondary | ghost |
  destructive"` rather than `primary` and `destructive` booleans that can
  both be true. `size="sm | md | lg"`. Variants are the design decisions;
  enumerate them.
- **No raw style props for design decisions.** A `color` prop that
  accepts any CSS color invites off-system values. Accept a token name or
  a semantic (`tone="danger"`) instead. Allow `className`/`style`
  passthrough for layout (margins, grid placement) but not for repainting
  the component.
- **Composition over configuration** for complex components. `<Dialog>`
  with `<Dialog.Header>`, `<Dialog.Body>`, `<Dialog.Footer>` lets
  layouts vary within the system; a `footerButtons` array prop cannot.
- **Slots for icons**, sized by the component. `<Button icon={<Plus />}>`
  where the button sizes the icon, not `<Button><Plus size={16} />Add</Button>`.
- **States as props or data attributes**: `loading`, `disabled`,
  `selected`, `invalid`. Expose them as `data-state`/`aria-*` on the DOM so
  styling can target them consistently.
- **Sensible defaults**: `variant="secondary"` by default so a page with
  five buttons does not have five primaries. `size="md"`.
- **Consistency across components**: the same prop names mean the same
  thing everywhere (`size`, `variant`, `tone`, `disabled`). Inconsistency
  is a design defect because it leads to inconsistent use.
- **Escape hatches are visible**: `unstyled` or `asChild` for rare needs,
  documented as rare.

Check an API by asking: can a developer produce a visually wrong button
with this API without obviously fighting it? If `color="#ff00ff"` is
accepted, yes.

## 7. Auditing an existing codebase for its implicit system

Every codebase has a design system; most are implicit and inconsistent.
Find it before changing anything.

**Step 1: Inventory values.** Grep for colors, font sizes, spacing values,
radii, shadows:

```bash
# Hex colors in CSS/JS/TSX
rg -o --no-filename '#[0-9a-fA-F]{3,8}\b' src | sort | uniq -c | sort -rn | head -40
# rgb/hsl/oklch
rg -o --no-filename '(rgba?|hsla?|oklch)\([^)]*\)' src | sort | uniq -c | sort -rn | head
# Font sizes
rg -o --no-filename 'font-size:\s*[^;]+' src | sort | uniq -c | sort -rn
# Tailwind arbitrary values (a sign of off-system design)
rg -o --no-filename '\b[a-z-]+-\[[^\]]+\]' src | sort | uniq -c | sort -rn | head -30
# Tailwind color usage
rg -o --no-filename '\b(bg|text|border)-(gray|slate|zinc|neutral|blue|indigo|violet|purple)-[0-9]{2,3}' src | sort | uniq -c | sort -rn | head -30
# Spacing / radius / shadow classes
rg -o --no-filename '\b(p|px|py|m|mx|my|gap|space-[xy])-[0-9.]+' src | sort | uniq -c | sort -rn | head
rg -o --no-filename '\brounded(-[a-z0-9]+)?\b' src | sort | uniq -c | sort -rn
rg -o --no-filename '\bshadow(-[a-z0-9]+)?\b' src | sort | uniq -c | sort -rn
```

For Flutter: `rg 'Color\(0x' lib`, `rg 'fontSize:' lib`, `rg
'EdgeInsets' lib`. For SwiftUI: `rg 'Color\(' Sources`, `rg '\.font\('`,
`rg '\.padding\('`. For Compose: `rg 'Color\(0x'`, `rg '\.dp\b'`,
`rg 'fontSize ='`.

**Step 2: Find the intended system.** The most frequent values are the de
facto tokens. If `#1F2937` appears 140 times and `#1E293B` appears 6
times, the second is drift. If `rounded-lg` appears 200 times and
`rounded-2xl` 30 times, `lg` is the system and `2xl` is either a
deliberate large-surface radius or drift; check where it appears.

**Step 3: Find the best screen.** Run the app. Identify the screen that
looks most considered (often the most recently redesigned, or the one the
team demos). It is the reference; its values are the ones to formalize.

**Step 4: Find existing structure.** `tailwind.config` theme extensions,
`:root` variables, a `theme.ts`, `ThemeData`, a `Colors` enum, a
`DesignSystem` folder, Storybook. Even a half-finished one is the starting
point; its naming wins.

**Step 5: Write down what you found** in 15 lines: palette in use, type in
use, spacing in use, radius and shadow in use, component library and how
it is themed, the inconsistencies. Share this with the user if the task is
significant; it is usually news to them.

## 8. Extending versus fighting an existing system

Default to extending. A new screen that matches an imperfect existing
system is better than a new screen that is better in isolation and makes
the product look like two products.

Extend when: the existing system is consistent enough that users have
learned it; the task is a feature, not a redesign; the inconsistencies are
small (a few drifted values).

Propose a change when: the existing system is actively harmful (fails
contrast, unusable on mobile); the user asked for a redesign; you find a
drifted value used in 40% of places (then the "system" is really two
systems and someone must pick).

Mechanics of extending:

- Use their tokens and their names, even if you would have named them
  differently.
- Use their component library's components, styled through its theming
  mechanism, rather than building parallel components.
- Where you need a value that does not exist (a new semantic color, a
  larger radius for a new surface type), add it to the token file in their
  convention, not inline in your component.
- Where a drifted value is in your way (two slightly different greys),
  pick the more frequent one and note the other for cleanup; do not add a
  third.
- Match their density, spacing rhythm and type sizes on the new screen,
  then screenshot it beside an existing screen to check.

Mechanics of a proposed change:

- Do it as tokens first. Changing `--color-accent` once and seeing the
  whole product shift is a cheap way to evaluate; changing 40 components
  is not.
- Show before/after screenshots of two or three screens.
- Keep the change behind a flag or a theme attribute if the product is
  live, so it can be reviewed in context.
- Change the fewest axes that fix the problem. A new accent and radius is
  a refresh; a new type family, palette, spacing and components is a
  rebrand and needs explicit consent.

## 9. Introducing tokens into a tokenless codebase

Inline values everywhere, no variables. Do not stop the world; tokenize
incrementally.

1. **Create the token file** with primitives derived from the audit (the
   most-used values, rounded to a scale) and a semantic layer for color.
   Make the semantics equal the current look exactly, so adopting them
   changes nothing visually.
2. **Wire it in** at the root (`:root`, `tailwind.config` theme extension,
   `ThemeData`, an `AppTheme` struct) alongside the old values. Nothing
   breaks.
3. **Adopt on touch.** Every file you edit for any reason, convert its
   inline values to tokens. New code uses tokens only.
4. **Convert hot paths deliberately**: the shared components (button,
   input, card) first, because they appear everywhere; then layout
   wrappers; then pages.
5. **Enforce going forward**: a lint rule against raw hex in components
   (`stylelint-declaration-strict-value`, an ESLint rule for Tailwind
   arbitrary values, a custom lint in Dart), and a codeowners note.
6. **Clean up drift in batches**: once the semantic layer is used in most
   places, collapse near-duplicate primitives (the two greys) by changing
   the token value, not 40 files.
7. **Add the second theme** (dark mode) only after the semantic layer is
   broadly adopted; it is the payoff and the test.

Expect this to take several passes. The early win is that new work is
consistent; the full conversion follows.

Tailwind-specific: move from `bg-gray-100 text-gray-900` (primitives in
markup) toward `bg-surface text-primary` (semantics in markup) by defining
semantic colors in the theme as CSS variables. shadcn/ui's setup is a good
model. Do not ban primitives from markup overnight; let the semantic
classes win by being easier.

## 10. Working with component libraries

**shadcn/ui (Radix + Tailwind)**: the components are copied into the repo,
so they are yours to edit. Theme via the CSS variables in `globals.css`
(`--background`, `--primary`, `--radius`, etc.). Extend by adding
variables (`--surface-raised`, `--accent-subtle`) and new `cva` variants.
Keep Radix primitives for behavior; restyle freely. The default look is
recognizably shadcn (neutral, 0.5rem radius, Inter); change the radius,
type and accent to make it yours.

**MUI**: theme with `createTheme` (palette, typography, shape, spacing,
components overrides via `styleOverrides` and `variants`). The default
Material look is strong; to escape it, override `MuiButton` text transform
(none), elevation (flat), `shape.borderRadius`, and the typography family.
Use `sx` for layout only.

**Chakra / Mantine**: theme objects with semantic tokens (Chakra
`semanticTokens`, Mantine `theme.colors` + `primaryColor` + component
`defaultProps`/`styles`). Both are easier to make un-generic than MUI;
replace the default font and radius.

**Ant Design**: design tokens via `ConfigProvider theme={{ token: {...},
components: {...} }}`. Ant's look is distinctive (enterprise, 6px radius,
blue); change `colorPrimary`, `borderRadius`, `fontFamily` at minimum.

**Headless (Radix, Headless UI, React Aria, Ark)**: no styles; your tokens
and your CSS. Best when the direction is specific.

**Flutter Material**: `ThemeData` with `ColorScheme.fromSeed`,
`TextTheme`, and per-component themes (`ElevatedButtonThemeData`,
`InputDecorationTheme`, `CardTheme`). Set `useMaterial3: true`. To
de-Material: `visualDensity`, `splashFactory: NoSplash.splashFactory` if
ripples do not fit, shape overrides on buttons and cards, and a custom
`TextTheme`.

**Flutter Cupertino / SwiftUI**: system components carry platform
conventions; theme the accent (`CupertinoThemeData.primaryColor`,
`.tint()`), type where allowed, and otherwise accept the platform look
(see mobile.md).

**Compose Material 3**: `MaterialTheme(colorScheme, typography, shapes)`.
Shapes are a first-class theme axis (extraSmall through extraLarge);
set them to the direction's radii.

In every case: theme at the root once, never per-instance. If you find
yourself passing the same color prop to every button, the theme is wrong.

## 11. Documentation that gets used

Long design-system docs go unread. What works:

- **The direction spec** (ten lines) at the top of the tokens file or in
  `DESIGN.md`.
- **Token tables** with the value, the role, and one example use, generated
  from the source so they do not rot.
- **Do / Don't pairs** with screenshots or code for the five most common
  mistakes in this codebase (found in the audit).
- **One example page** that uses everything correctly (a kitchen-sink
  route or Storybook story), kept green.
- **Component docs** that show variants, sizes and states in one view,
  with the copy guidance for that component (what the button label should
  say).
- **A decision log**: dated one-liners for changes ("2026-03: accent moved
  from blue to teal to separate from info; see PR #412").

Put docs next to code; a wiki page nobody opens is not documentation.

## 12. Versioning and change

Tokens are an API. Changing a semantic token's value changes every screen;
renaming or removing one breaks builds or silently falls through to
inherited values.

- **Add, then migrate, then remove.** Introduce the new token alongside
  the old, move usages, delete the old with a deprecation period. In CSS,
  alias the old name to the new during the transition
  (`--color-primary: var(--color-accent)`).
- **Value changes to semantics** are design changes; review them with
  screenshots.
- **Primitive additions** are safe; primitive removals need a usage check.
- **Component changes**: a new variant is additive; changing a default
  variant or size is breaking in design terms even if the code compiles.
- **Changelog** the design changes in plain language ("Buttons are 2px
  shorter; secondary buttons lost their shadow") so other contributors can
  recognize what moved.
- **Visual regression tests** (Playwright screenshots, Chromatic,
  Storybook test-runner, Flutter goldens) catch unintended changes from
  token edits. Even a handful of key screens is worth it.

## 13. Platform mechanics

Short notes on where tokens live per platform, so the agent puts them in
the conventional place.

- **CSS**: `:root` custom properties, in a `tokens.css` imported first.
  Scoped overrides on `[data-theme]`, `[data-density]`, or component roots.
- **Tailwind v3**: `theme.extend` in `tailwind.config`; semantic colors
  reference CSS variables (`'surface': 'var(--color-bg-surface)'`), with
  `<alpha-value>` support for opacity modifiers: `'rgb(var(--surface-rgb)
  / <alpha-value>)'`. v4: `@theme { --color-surface: ...; }` in CSS.
- **CSS-in-JS / vanilla-extract / Panda / Stitches**: a theme contract
  object; `createTheme` for variants; the same three tiers.
- **Style Dictionary / Tokens Studio**: a JSON source of truth generating
  CSS, Dart, Swift and Kotlin. Worth it when tokens must ship to more than
  one platform.
- **Flutter**: `ThemeData` plus a `ThemeExtension<T>` for custom semantic
  tokens (e.g. `AppColors` with `surfaceRaised`, `textMuted`) accessed via
  `Theme.of(context).extension<AppColors>()`. Spacing as a `const` class.
- **SwiftUI**: `Color` and `Font` extensions reading from asset catalog
  colors (which support light/dark variants natively) and `@Environment`
  for theme; a `DesignTokens` enum for spacing and radii.
- **Compose**: `MaterialTheme` plus a custom `LocalAppColors`
  `CompositionLocal` for semantics Material does not cover; `Dp`
  constants object for spacing.
- **React Native**: a theme object via context; `StyleSheet` reading from
  it; libraries like Tamagui or Unistyles if the project uses one.

## 14. Anti-patterns

| Anti-pattern | Why it hurts | Instead |
|---|---|---|
| Components reference primitives (`var(--blue-500)`) | Cannot theme; dark mode impossible | Semantic tokens only in components |
| Token named by value (`--blue-primary`) | Lies when the value changes | Role names |
| 200 semantic color tokens | Nobody remembers them; drift returns | 20-30 well-chosen roles |
| Component tokens for everything | Triple the surface; no benefit | Only where independent theming is needed |
| Parallel components beside the library | Two buttons that drift apart | Theme the library; wrap if needed |
| Raw style props accepting any value | Off-system values leak in | Enumerated variants and tones |
| Dark mode via `filter: invert()` or a second stylesheet of overrides | Shadows, images and accents break; unmaintainable | Semantic token swap |
| Tokens defined but inline values still written | System exists on paper only | Lint; adopt on touch; shared components first |
| Renaming tokens without aliases | Silent fallthrough to wrong values | Add, alias, migrate, remove |
| Documentation as a separate site nobody opens | Rots | Docs beside code; generated tables; one example page |
| "We'll add tokens later" on a greenfield project | The hardest moment to add them is after 40 screens | Tokens on day one, even a small set |
