# Styling architecture

Choosing (or, far more often, matching) a styling approach as an
engineering decision: CSS modules, Tailwind, CSS-in-JS, vanilla CSS with
layers and custom properties, zero-runtime libraries. Custom properties as
the token layer, cascade layers for specificity control, Tailwind at scale
(`cn`, variants, no arbitrary values), CSS-in-JS versus server components,
scoping, and dark mode implementation. What the tokens *are* (which colors,
which type scale) is the `design` skill's decision; this file is how to
wire them.

## Contents

1. Detect and match
2. Choosing an approach when you have the choice
3. Custom properties as the token layer
4. Cascade layers and specificity management
5. Vanilla CSS and CSS Modules
6. Tailwind at scale
7. CSS-in-JS and zero-runtime alternatives
8. Component variants: `cva` and friends
9. Dark mode and theming
10. Responsive and container queries
11. Modern CSS worth using
12. Anti-patterns with fixes

## 1. Detect and match

```bash
grep -E '"(tailwindcss|styled-components|@emotion/[a-z]+|@vanilla-extract/css|@stitches/react|@pandacss/dev|sass|less|postcss|@linaria/core|stylex|unocss|class-variance-authority|tailwind-merge|clsx|classnames)"' package.json
ls tailwind.config.* postcss.config.* src/**/*.module.css src/styles 2>/dev/null | head
grep -rn "@layer\|@theme\|--color-" src/styles src/app/globals.css 2>/dev/null | head
```

Match what you find. Introducing a second approach costs more than any
benefit the second approach brings: two mental models, two sources of
specificity, duplicated tokens, and a half-migrated codebase forever. If
the existing approach is genuinely blocking (CSS-in-JS runtime in an RSC
app), propose a migration as a separate piece of work.

Learn the local dialect before writing: are utilities ordered by
`prettier-plugin-tailwindcss`? Is there a `cn()` helper? Where do tokens
live (`tailwind.config.ts` `theme.extend`, a `tokens.css`, a `theme.ts`)?
Is there a `components/ui` layer (shadcn-style) you should use rather than
styling raw elements? How is dark mode toggled (class, data attribute,
media query)?

## 2. Choosing an approach when you have the choice

| Approach | Strengths | Costs | Fits |
|---|---|---|---|
| Vanilla CSS + custom properties + layers (optionally Sass for nesting/mixins, less needed now) | Zero runtime, platform-native, cacheable, works everywhere incl. RSC and web components | Naming discipline (BEM or similar) and scoping are on you | Content sites, design systems, teams fluent in CSS, anything shipped as a library |
| CSS Modules | Local scoping by default, zero runtime, plain CSS, every bundler supports it | Dynamic styles via class toggling or inline custom properties; no colocated variants API | Apps in any framework that want "just CSS" with scoping; Next/Vite default support |
| Tailwind | Consistent token scale enforced by the class set, no naming, colocated with markup, tiny CSS output, fast iteration | Long class strings, needs `cn` + variant helpers at scale, team must agree on conventions, arbitrary values are an escape hatch that erodes the system | Product UI built fast by teams who accept utility-first; most new React/Vue/Svelte apps today |
| Zero-runtime CSS-in-JS (vanilla-extract, Panda, StyleX, Linaria) | Typed styles and tokens, static extraction, no runtime cost, RSC-compatible | Build integration, smaller ecosystems | Design systems wanting type-safe tokens; large apps that want CSS-in-JS ergonomics without runtime |
| Runtime CSS-in-JS (styled-components, Emotion) | Dynamic styles from props, colocated, large legacy ecosystem (MUI, Chakra) | Runtime cost (style injection on render), does not work in server components without workarounds, SSR requires registry setup, bundle size | Existing codebases; component libraries built on it; avoid for new RSC apps |
| Framework-scoped styles (Vue `<style scoped>`, Svelte `<style>`, Angular `styleUrls` with emulated encapsulation) | Built in, scoped, zero config | Deep selectors (`:deep()`, `:global`) for child overrides; same naming discipline inside a component | Vue/Svelte/Angular apps by default; combine with tokens in a global sheet |

A reasonable default for a new app with no constraints: Tailwind for
layout and one-off composition, with tokens defined as CSS custom
properties (Tailwind 4 does this natively via `@theme`), a small
`components/ui` layer with `cva` variants, and vanilla CSS for anything
Tailwind expresses badly (complex animations, print styles, third-party
widget overrides). For a design system package consumed by many apps:
vanilla CSS with custom properties and layers, or vanilla-extract.

## 3. Custom properties as the token layer

Whatever the approach, make CSS custom properties the single source of
design tokens. Every tool (Tailwind, CSS-in-JS, plain CSS, web components,
even a canvas chart reading `getComputedStyle`) can consume them, and
theming becomes "redefine the variables."

Two tiers: primitives (the palette) and semantic tokens (what things mean).
Components use only semantic tokens.

```css
/* tokens.css */
@layer tokens {
  :root {
    /* primitives: the design skill decides these values */
    --blue-50: oklch(97% 0.02 250);  --blue-600: oklch(55% 0.18 250);  --blue-700: oklch(48% 0.18 250);
    --gray-0: oklch(100% 0 0);  --gray-50: oklch(98% 0 0);  --gray-900: oklch(20% 0 0);  --gray-950: oklch(12% 0 0);
    --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem; --space-6: 1.5rem; --space-8: 2rem;
    --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
    --font-sans: 'Inter', 'Inter Fallback', system-ui, sans-serif;
    --text-sm: 0.875rem; --text-base: 1rem; --text-lg: 1.125rem;
    --duration-fast: 120ms; --ease-out: cubic-bezier(0.2, 0, 0, 1);

    /* semantic: components reference only these */
    --color-bg: var(--gray-0);
    --color-bg-subtle: var(--gray-50);
    --color-fg: var(--gray-900);
    --color-fg-muted: var(--gray-600);
    --color-border: var(--gray-200);
    --color-accent: var(--blue-600);
    --color-accent-hover: var(--blue-700);
    --color-accent-fg: var(--gray-0);
    --focus-ring: 2px solid var(--color-accent);
  }
}
```

Tailwind 3: `theme.extend.colors.accent = 'var(--color-accent)'` (or
`'rgb(var(--accent-rgb) / <alpha-value>)'` if you need opacity modifiers).
Tailwind 4: define tokens in `@theme { --color-accent: ...; }` and
utilities (`bg-accent`) are generated from them; the variables are the
config.

Component-level custom properties for the handful of knobs a component
exposes (`--button-height`, `--card-padding`), set on the component's root
and consumed inside. Consumers override by setting the property on the
element, no `!important` or deep selectors.

## 4. Cascade layers and specificity management

`@layer` makes order of layers, not selector specificity or source order,
decide the winner. Declare the layer order once, at the top of the entry
stylesheet, and every rule falls into a predictable slot:

```css
@layer reset, tokens, base, components, utilities, overrides;

@import url('reset.css') layer(reset);
@import url('tokens.css') layer(tokens);

@layer base { body { font-family: var(--font-sans); color: var(--color-fg); background: var(--color-bg); } a { color: var(--color-accent); } }
@layer components { .card { padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); } }
@layer utilities { .mt-4 { margin-top: var(--space-4); } .sr-only { /* ... */ } }
```

A rule in `utilities` beats a rule in `components` regardless of how
specific the component selector is; unlayered styles beat all layers
(useful for third-party overrides or dangerous if accidental). Tailwind 3
emits `@tailwind base/components/utilities` in this order; Tailwind 4 uses
real cascade layers (`theme, base, components, utilities`) so your own
`@layer components` rules slot in naturally.

Specificity rules of thumb without layers: keep selectors flat (single
class), no IDs in CSS, no `!important` except in utilities that must win
(`.sr-only`, `.hidden`) and in `prefers-reduced-motion` overrides. `:where()`
has zero specificity and is the tool for resets and library defaults that
consumers must be able to override with a single class:

```css
:where(button) { all: unset; }     /* any .btn class wins without fighting */
```

## 5. Vanilla CSS and CSS Modules

CSS Modules: `Button.module.css` → `import styles from './Button.module.css'`
→ `className={styles.primary}`. Class names are hashed per file; composition
via `composes:` or multiple classes. Global escape: `:global(.theme-dark)`.
Dynamic values: toggle classes for discrete states (`styles[variant]`),
inline `style={{ '--progress': `${pct}%` }}` for continuous values, read
inside the module with `var(--progress)`.

Naming inside a module can be short (`.root`, `.icon`, `.primary`) because
scoping is handled. In global vanilla CSS use a convention consistently
(BEM `block__element--modifier`, or data attributes for state:
`.card[data-state="open"]`). Prefer data attributes and ARIA states for
styling state over modifier classes; the DOM then carries the truth once:

```css
.disclosure-trigger[aria-expanded="true"] .chevron { rotate: 180deg; }
.menu-item[data-highlighted] { background: var(--color-bg-subtle); }
```

Nesting is native in modern CSS (`.card { &:hover {} .title {} }`); check
`browserslist` before relying on it without a PostCSS plugin.

Framework scoped styles (Vue `scoped`, Svelte, Angular) are CSS Modules
with different plumbing. Child component overrides: pass a `class` prop
through (`class={className}` / `$attrs.class` / `:class`), not `:deep()`
reaching into another component's internals.

## 6. Tailwind at scale

Tailwind works when the class set *is* the design system. It fails when
teams bypass it.

The `cn` helper merges conditional classes and resolves conflicts
(`tailwind-merge` knows `p-2` and `p-4` conflict and keeps the last):

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
```

Component with a `className` escape hatch merged last, so consumers can
adjust spacing without forking:

```tsx
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-lg border border-border bg-card p-6 shadow-sm', className)} {...props} />
}
```

Conventions that keep it maintainable:

- **No arbitrary values** (`w-[347px]`, `text-[13px]`, `mt-[7px]`) in
  product code. If the design needs a value not on the scale, add it to the
  theme with a name, or question the design. Arbitrary values are how the
  token system dies one class at a time. Exceptions: truly one-off
  dimensions tied to an external constraint (an embed's fixed height),
  commented.
- **No `@apply` for components** beyond a tiny base layer. `@apply` turns
  Tailwind into a worse Sass and hides what a component looks like from
  its markup. Build components as components with `cva` variants instead.
- **Semantic color names in the theme** (`bg-background`, `text-muted-
  foreground`, `border-border`, shadcn convention) mapped to CSS variables,
  not raw palette classes (`bg-gray-50`) scattered through components.
  Dark mode then needs no `dark:` variants on components.
- **Class ordering** by `prettier-plugin-tailwindcss`; do not hand-order.
- **Extract components, not class strings.** Repeating 14 classes in five
  places means a `<Badge>` component, not a `const badgeClasses`.
- **Group responsive and state variants predictably**: base, then
  `sm: md: lg:`, then `hover: focus-visible: disabled:`, then `dark:` if
  used; the plugin does this.
- **`group`/`peer`** for parent/sibling state styling; `data-[state=open]:`
  variants for Radix-style data attributes; `aria-[expanded=true]:` for
  ARIA states.
- **Container queries** (`@container`, `@md:`) for component-driven
  responsiveness (Tailwind 3.4+/4).
- `tailwind.config` `content` globs must include every file with classes
  (including `.ts` files that build class strings and any UI package in a
  monorepo), or classes are purged in production while working in dev.
  Dynamic class names (`bg-${color}-500`) are never detected; use a map of
  full class names.

Tailwind 4: CSS-first config via `@import "tailwindcss"` and `@theme`,
automatic content detection, native cascade layers, `@utility` for custom
utilities, `@variant` for custom variants. Check which major is installed;
config files and some class names differ (`shadow-sm` → `shadow-xs`, etc.).

## 7. CSS-in-JS and zero-runtime alternatives

Runtime CSS-in-JS (styled-components, Emotion) computes styles in the
browser during render. Costs: JS bundle (12-20 KB), style injection on
every render of dynamic styles, and incompatibility with React Server
Components (they run on the server with no way to collect styles into the
stream without a client registry). Next.js documents a workaround via
`useServerInsertedHTML` for the Pages → App migration; it makes every
styled component a client component.

If the repo is on runtime CSS-in-JS and not using RSC: keep using it. Use
the `css` prop or `styled` consistently as the codebase does; theme via
`ThemeProvider` and read tokens from it; avoid creating styled components
inside render (new class every render) and avoid passing every prop as a
style input (filter with `shouldForwardProp` or transient `$props` so DOM
attributes stay clean).

If the repo is moving to RSC or starting fresh: zero-runtime options give
typed styles without the costs.

```ts
// vanilla-extract: styles.css.ts, compiled to static CSS at build
import { style, styleVariants, createVar } from '@vanilla-extract/css'
import { vars } from './theme.css'              // typed theme contract -> CSS variables

export const padding = createVar()
export const card = style({ padding, border: `1px solid ${vars.color.border}`, borderRadius: vars.radius.md, vars: { [padding]: vars.space[4] } })
export const tone = styleVariants({ neutral: { background: vars.color.bg }, accent: { background: vars.color.accent, color: vars.color.accentFg } })
```

Panda CSS and StyleX take similar positions (atomic output, typed tokens,
static extraction). Pick one only if the team values typed tokens enough to
accept the build integration; Tailwind with CSS variables covers most of
the same ground with a larger community.

## 8. Component variants: `cva` and friends

A variant API turns prop values into class sets with typed props and
defaults, and keeps the component's visual API explicit:

```tsx
import { cva, type VariantProps } from 'class-variance-authority'

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: { primary: 'bg-primary text-primary-foreground hover:bg-primary/90', secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80', ghost: 'hover:bg-accent hover:text-accent-foreground', destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90' },
      size: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4', lg: 'h-12 px-6 text-lg', icon: 'h-10 w-10' },
    },
    compoundVariants: [{ variant: 'ghost', size: 'icon', class: 'rounded-full' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

type ButtonProps = React.ComponentProps<'button'> & VariantProps<typeof button>
export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(button({ variant, size }), className)} {...props} />
}
```

Equivalents: `tailwind-variants` (adds slots), vanilla-extract `recipe`,
Panda `cva`, Stitches `variants`. In Vue/Svelte, the same `cva` works; the
component just binds `:class`/`class`. Variants are unions, not booleans
(`variant="destructive"`, not `isDestructive`), per SKILL.md principle 5.

## 9. Dark mode and theming

Three mechanisms, choose one and wire everything through semantic tokens:

1. **Media query only** (`@media (prefers-color-scheme: dark)`): follows
   the OS, no toggle, zero JS, no flash. Right when the product does not
   need a manual override.
2. **Class or attribute on `<html>`** (`class="dark"` / `data-theme="dark"`)
   set by JS, persisted in localStorage or a cookie, with a `system`
   option that mirrors the media query. Needed when users can choose.
3. **Both**: default to media query, override via attribute. The most
   common production setup.

```css
:root { color-scheme: light; --color-bg: var(--gray-0); --color-fg: var(--gray-900); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { color-scheme: dark; --color-bg: var(--gray-950); --color-fg: var(--gray-50); }
}
:root[data-theme="dark"] { color-scheme: dark; --color-bg: var(--gray-950); --color-fg: var(--gray-50); }
```

`color-scheme` makes native controls, scrollbars and form elements match.
Components never mention dark mode; they use `var(--color-bg)`. In
Tailwind with semantic tokens, `bg-background` just works; `dark:` variants
are only for the rare intentional difference (a shadow that becomes a
border).

Avoiding the flash of wrong theme (FOWT) in SSR apps: the theme must be
known before first paint. Options: store the choice in a cookie and set
`data-theme` on `<html>` on the server; or inline a tiny blocking script in
`<head>` that reads localStorage and sets the attribute before CSS applies
(what `next-themes` does; it needs `suppressHydrationWarning` on `<html>`).
Pure client-side `useEffect` theming flashes on every load.

Theme switching UI: a `<select>` or a radio group with three options
(Light, Dark, System), not a two-state toggle that hides the system
option. Persist and apply in one place (a `ThemeProvider`/store/composable).

Images in dark mode: `<picture>` with `media="(prefers-color-scheme:
dark)"` sources for logos; `filter: brightness(.9)` for photos if the
design wants it; SVG icons with `currentColor`.

Multiple brand themes (white-label) are the same mechanism with more
attribute values (`data-theme="acme"`) redefining the semantic tokens.

## 10. Responsive and container queries

Mobile-first: base styles for the smallest viewport, `min-width` queries
(or `sm: md: lg:` in Tailwind) adding complexity. Breakpoints come from
the design's layout changes, not from device names; the codebase's
existing set wins.

Container queries make components responsive to their *container*, which
is what a card in a sidebar versus a card in a main column actually needs:

```css
.card-grid { container-type: inline-size; container-name: grid; }
@container grid (min-width: 40rem) { .card { grid-template-columns: 160px 1fr; } }
```

Fluid values reduce the need for breakpoints: `clamp(1rem, 0.5rem + 2vw,
1.5rem)` for type and spacing (design decides the range), `min()`/`max()`
for widths, `grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr))`
for wrapping grids with no media queries.

Logical properties (`margin-inline-start`, `padding-block`, `inset-inline`)
instead of physical (`margin-left`) so RTL works for free. Tailwind: `ms-`,
`me-`, `ps-`, `pe-`, `start-`, `end-`.

## 11. Modern CSS worth using

Check `browserslist`; as of 2025-2026 these are safe for evergreen
targets:

- `:has()` for parent/sibling selection (`.field:has(input:invalid)`), replaces much JS state styling.
- `:is()`/`:where()` for grouping and zero-specificity.
- Nesting, `@layer`, `@container`, `@property` (typed, animatable custom properties).
- `color-mix()`, relative color syntax, `oklch()` for perceptually uniform palettes (design decides values).
- `aspect-ratio`, `inset`, `gap` in flexbox, `place-items`.
- Subgrid for aligning nested grids to the parent.
- `text-wrap: balance` for headings, `text-wrap: pretty` for body.
- `scroll-snap`, `scroll-margin`, `overscroll-behavior`.
- `@starting-style` and `transition-behavior: allow-discrete` for animating `display`/`<dialog>`/`popover` open and close.
- `view-transition` API for page and element transitions (progressive; feature-detect).
- `field-sizing: content` for auto-growing textareas.
- `light-dark()` as a shorthand for two-value color tokens.

## 12. Anti-patterns with fixes

| Anti-pattern | Fix |
|---|---|
| Second styling system introduced alongside the existing one | Match; propose migration separately |
| Raw palette classes in components (`bg-gray-100`, `text-blue-600`) | Semantic tokens (`bg-muted`, `text-accent`) |
| Arbitrary Tailwind values (`w-[347px]`) | Scale value, or add a named token |
| `@apply` to build components | Component + `cva` |
| Inline `style={{ color: '#333' }}` | Token via class or custom property |
| `!important` to win a fight | Layers; flatter selectors; `:where()` for defaults |
| IDs in CSS | Classes |
| Dark mode via `dark:` on every element | Semantic tokens that flip |
| Theme applied in `useEffect` (flash) | Cookie/SSR attribute or blocking head script |
| `:deep()`/`::ng-deep`/`:global` to restyle a child component | Pass `class`/variant props; expose component custom properties |
| Hardcoded breakpoints differing from the design system | Shared breakpoint tokens |
| `margin-left` for RTL-sensitive layout | Logical properties |
| Styled component created inside render | Hoist to module scope |
| Runtime CSS-in-JS in server components | Zero-runtime, CSS Modules, or Tailwind; or confine to client leaves |
| Dynamic Tailwind class construction (`bg-${c}-500`) | Map of full class names |
| Hover-only affordances | Also `:focus-visible`; touch has no hover |
| `transition: all` | Name the properties; transform/opacity preferred |
