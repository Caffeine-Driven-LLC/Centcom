# Mobile

iOS Human Interface Guidelines and Material 3 essentials, the platform
conventions users expect, navigation patterns, safe areas, gesture
affordances, touch targets, and when to follow the platform versus the
brand. Applies to native (SwiftUI/UIKit, Compose/Views), cross-platform
(Flutter, React Native) and responsive web on phones.

## Contents

1. The platform contract
2. Platform versus brand: where each wins
3. iOS essentials
4. Android / Material 3 essentials
5. Navigation patterns
6. Safe areas, insets and system UI
7. Touch targets and thumb zones
8. Gestures and their affordances
9. Lists, cells and the mobile table
10. Forms and input on mobile
11. Sheets, dialogs and overlays
12. Type and density on phones
13. Tablets and foldables
14. Flutter and React Native: platform adaptivity
15. Responsive web on phones
16. Mobile anti-patterns

## 1. The platform contract

A phone user has hundreds of apps and has learned how its platform works:
where back is, how to dismiss, what a tab bar does, how a sheet behaves,
what a long-press means. Every app that follows the contract benefits from
that learning for free; every app that breaks it pays in confusion.

The contract covers *behavior and structure*: navigation, controls,
gestures, system UI integration. It does not cover *expression*: type,
color, imagery, tone, motion character. A brand lives comfortably in the
second; it should rarely touch the first.

## 2. Platform versus brand: where each wins

| Axis | Follow platform | Brand can own |
|---|---|---|
| Navigation structure (tabs, stacks, back) | Yes | — |
| System gestures (edge swipe back, swipe down to dismiss, pull to refresh) | Yes | — |
| System controls (pickers, switches, share sheet, keyboard) | Yes, in most contexts | Custom only when the platform control cannot do the job |
| Status bar, safe areas, home indicator | Yes | — |
| Alerts and permission prompts | Yes | Pre-prompt explanation screen |
| Typography | Default scale structure (Dynamic Type / M3 scale) | Family, weight, personality within the scale |
| Color | Semantic structure (dark mode, system backgrounds) | Palette, accent, neutral tint |
| Iconography | Recognizable glyphs for system actions (share, back, close) | Style of custom icons; use SF Symbols / Material Symbols as the base when possible |
| Motion | System transitions for navigation and sheets | Micro-interactions, signature moments, illustration motion |
| Layout | Platform spacing idioms (iOS 16/20px margins; M3 16dp) | Density within reason, grid, imagery |
| Component shape | Roughly platform (iOS 10-14pt radii; M3 shape scale) | Within the platform's range; a brand with 0 radius on iOS feels foreign |
| Empty states, onboarding, content | — | Fully |
| Sound and haptics | System haptic vocabulary | Sparing additions |

Cross-platform apps (Flutter, RN) tempt a single look everywhere. The
right answer is usually: one brand expression, two sets of structural
conventions. A tab bar on both, but iOS gets the SF-style bar at the bottom
with the back swipe and Android gets M3 navigation bar behavior and the
system back; sheets dismiss the platform's way; pickers are native.

Brands that successfully override structure (some games, some creative
apps) do so completely and consistently, with a large budget for teaching.
A product app should not.

## 3. iOS essentials

**Type**: SF Pro (system). Text styles with default sizes: Large Title 34,
Title 1 28, Title 2 22, Title 3 20, Headline 17 semibold, Body 17,
Callout 16, Subhead 15, Footnote 13, Caption 1 12, Caption 2 11. Support
Dynamic Type (sizes scale with user setting up to accessibility sizes);
layouts must accommodate 200%+ (stack horizontally arranged elements
vertically at larger sizes). Custom fonts via `.custom(_, size:,
relativeTo:)`.

**Layout**: 16pt margins on phones (20 on larger phones in some
contexts), 8pt base grid. Grouped lists (inset grouped style) with 10pt
radius cells on a secondary background are the settings idiom. Content
scrolls under translucent bars.

**Navigation**: navigation stack with a large title that collapses on
scroll; back button top-left with the previous title; edge swipe back.
Tab bar (2-5 tabs, 49pt + safe area) at the bottom with SF Symbols and
labels. Modals as sheets (page sheet with grab handle, half/medium detents
available) that swipe down to dismiss. Toolbars at the bottom for
context actions in editors.

**Controls**: buttons are text-first (plain, tinted, filled, bordered) with
the accent color; switches (green by default, brandable); segmented
controls; steppers; sliders; date and time pickers (wheel or compact);
menus from buttons (pull-down) and from long-press (context menu with
preview). Native pickers for dates and selections unless the data model
needs otherwise.

**Color**: system semantic colors (`label`, `secondaryLabel`,
`systemBackground`, `secondarySystemGroupedBackground`, `separator`) adapt
to dark mode and increased contrast; the `accentColor` carries the brand.
Dark mode uses elevated backgrounds for sheets.

**Shape**: continuous corner radius (`.continuous`), 10-14pt for cards and
cells, 8-12 for buttons, pill for prominent CTAs; the system uses
concentric corners (inner radius = outer radius minus inset).

**Motion**: spring-based; interactive dismissal; `matchedGeometryEffect`
for shared elements; respects Reduce Motion (crossfades replace slides).

**Haptics**: light impact for selection changes, medium for actions,
notification haptics for success/warning/error; never on every tap.

**Iconography**: SF Symbols, which scale with Dynamic Type and come in
weights matching text; use the filled variant for selected tabs.

**Platform tells to avoid**: Material-style FAB, ripple effects, hamburger
menus as primary nav, Android back arrow glyph, top-aligned tabs for
primary navigation, custom alert styling.

## 4. Android / Material 3 essentials

**Type**: Roboto by default; M3 type scale: Display L/M/S (57/45/36),
Headline L/M/S (32/28/24), Title L/M/S (22/16/14), Body L/M/S (16/14/12),
Label L/M/S (14/12/11). Sizes in `sp` to respect user scaling. Custom
families plug into `Typography()` once.

**Layout**: 16dp margins on phones, 24dp on larger; 8dp base grid, 4dp for
fine positioning. Canonical layouts for large screens (list-detail,
supporting pane, feed).

**Navigation**: navigation bar at the bottom (3-5 destinations, 80dp,
icon with label, active indicator pill); navigation rail on tablets;
navigation drawer for 5+ destinations or secondary ones. Top app bar
(small, medium, large, center-aligned) with the title and actions; the
system back (gesture or button) is handled by the OS and must behave
predictably (predictive back animations in recent versions). No in-app
back arrow is needed in most cases; one is shown in the top app bar on
secondary screens.

**Controls**: filled, tonal, outlined, elevated and text buttons; FAB
(one per screen, for the primary creation action; extended FAB with
label); switches with an icon in the thumb; checkboxes; radio buttons;
chips (assist, filter, input, suggestion); sliders; date pickers (modal
calendar or input); menus; search bar that expands into a search view.

**Color**: M3 color roles generated from a seed: primary, onPrimary,
primaryContainer, onPrimaryContainer, secondary..., tertiary..., surface,
surfaceVariant, surfaceContainer (low/high/highest for elevation in dark
mode), outline, outlineVariant, error. Dynamic color from wallpaper is
optional; brand apps often disable it. Elevation is expressed by surface
tint (lighter containers) plus small shadows.

**Shape**: shape scale extraSmall 4dp, small 8, medium 12, large 16,
extraLarge 28; FAB 16; full for pills. Set the scale to the brand's radii;
M3 tolerates a wider range than iOS.

**Motion**: emphasized easing (see motion.md), container transform for
list-to-detail, shared axis for sibling screens, fade-through for
unrelated screens; predictive back.

**State layers**: hover/focus/press shown as a semi-transparent layer of
the content color (8%/12%/12%) over the component; ripple on press.

**Iconography**: Material Symbols (outlined, rounded, sharp) with weight
and fill axes; filled variant for active nav items.

**Platform tells to avoid**: iOS-style back chevron with text, iOS
switches, bottom sheets that cannot be dismissed by system back, custom
non-Material dialogs, ignoring the system back gesture.

## 5. Navigation patterns

| Pattern | Use when | Notes |
|---|---|---|
| Bottom tabs / nav bar | 3-5 top-level destinations of equal importance | Labels always; icons from the platform set; keep state per tab |
| Stack (push/pop) | Hierarchical drilling within a tab | Back in the top bar (iOS) or system (Android); titles tell the user where they are |
| Modal sheet | A task that interrupts (compose, filter, settings for the current item) | Dismiss by swipe and by a Close/Cancel button; confirm discard if dirty |
| Full-screen modal | Multi-step flows (checkout, onboarding) | Close top-left/right; progress indicator; never trap |
| Drawer | 5+ destinations, or secondary destinations; account switching | Secondary to tabs; avoid as the only nav |
| Top tabs / segmented | Views of the same content within a screen | Swipeable on Android; segmented control on iOS |
| Search as navigation | Content-heavy apps | A search tab or an always-visible bar |

Rules: the primary navigation is visible on every top-level screen; the
current location is obvious (active tab, title); back always works and
goes where the user expects (up the stack, not to a random tab);
deep links land on the right screen with a valid back stack.

A hamburger menu hiding 3-5 primary destinations is a desktop-web habit;
on phones it halves engagement with those destinations. Use tabs.

## 6. Safe areas, insets and system UI

- **Safe area**: content (text, controls) stays inside; backgrounds and
  scrollable content extend under the status bar, notch/Dynamic Island,
  home indicator and rounded corners. SwiftUI handles this by default;
  `.ignoresSafeArea()` for backgrounds only. Compose: `WindowInsets` and
  `Modifier.safeDrawingPadding()` / `edge-to-edge`. Flutter: `SafeArea`
  and `MediaQuery.paddingOf`. Web: `env(safe-area-inset-*)` with
  `viewport-fit=cover`.
- **Bottom controls** (tab bars, sticky buttons) sit above the home
  indicator with its inset added; a button flush with the screen bottom
  is a tell.
- **Keyboard**: the layout adjusts (resize or scroll) so the focused field
  and the submit remain visible; a sticky bottom bar rises with the
  keyboard. Dismiss on scroll or with a Done button for number pads that
  lack a return key.
- **Status bar style**: light or dark icons to match the screen's top
  background; set per screen when the top color changes.
- **Landscape**: support it or lock it deliberately; if supported, use
  the width (two columns) rather than stretching a phone layout.
- **Display cutouts and foldables**: avoid placing critical controls in
  the top corners where cutouts and hinges intrude.
- **System bars translucency**: content scrolling under translucent bars
  is the platform norm on both OSes; the bar gains a background on scroll.

## 7. Touch targets and thumb zones

- Minimum targets: 44x44pt (iOS), 48x48dp (Android), with 8pt between
  adjacent targets. A 24pt icon sits in a 44pt touch area.
- Thumb zone (one-handed, right hand): the bottom 60% of the screen is
  comfortable; the top-left corner is hardest. Place primary actions and
  frequent controls low; place destructive or rare controls high.
- Edge zones: 16-20pt from the left edge is the iOS back-swipe region and
  the Android back gesture region on both edges; horizontal swipe
  controls (carousels, sliders) near the edges conflict with system
  gestures. Inset them or accept the conflict consciously.
- Row heights: 44pt minimum (iOS standard cell 44), 48-56dp (M3 list
  items one-line 56, two-line 72, three-line 88).
- Buttons: 44-50pt tall for primary CTAs; full width in forms with 16pt
  margins; pill or 10-12pt radius.
- Fat-finger protection: destructive actions are not adjacent to frequent
  ones; swipe-to-delete requires a full swipe or a confirm tap.

## 8. Gestures and their affordances

Gestures are invisible. Each needs either a platform convention users
already know, a visible hint, or a visible alternative.

| Gesture | Convention | Affordance / alternative |
|---|---|---|
| Edge swipe back (iOS) / back gesture (Android) | System | Back button also present (iOS top bar) |
| Swipe down to dismiss sheet | System | Grab handle; Close button |
| Pull to refresh | Widely learned | Spinner appears as you pull; also auto-refresh on return |
| Swipe row for actions | Learned on iOS mail/lists | Partial reveal on first use or an overflow menu as alternative |
| Long press | Context menu (iOS), selection/menu (Android) | Visible "..." for the same actions |
| Pinch to zoom | Images, maps | Zoom buttons on maps |
| Horizontal swipe between pages | Tabs (Android), carousels | Visible tabs or page indicators |
| Drag to reorder | Lists in edit mode | A visible handle; an "Edit" mode |
| Double tap | Like (social), zoom (images) | A visible like button |
| Shake | Undo (iOS, rare) | Undo button/toast |

Rules: never make a gesture the only way to do something important; make
the gesture's result reversible; provide feedback during the gesture
(content follows the finger; thresholds are visible); respect system
gesture regions.

## 9. Lists, cells and the mobile table

The list is the primary mobile layout. Cell anatomy: optional leading
visual (avatar 40, icon 24 in a 40 container, thumbnail 56-64), primary
text (16-17, 1 line, truncate), secondary text (14-15 `text-secondary`,
1-2 lines), trailing element (chevron for navigation, value text, switch,
checkbox, timestamp 12-13), 16pt horizontal padding, 12-16pt vertical,
separator inset to align with the text (iOS) or full width (M3).

- Chevron only when the row navigates; no chevron on rows that toggle or
  do nothing.
- Grouped sections with headers (13pt uppercase `text-secondary` on iOS
  grouped lists; 14sp title on M3) and footers for explanations.
- Swipe actions: 1-2 per side, labeled with icon and text, destructive in
  red on the trailing side; a full swipe triggers the first action.
- Selection mode: checkboxes slide in on the leading side; the top bar
  shows the count and bulk actions.
- Tables on phones become lists of cells with 2-4 key fields; the detail
  shows all fields; sorting and filtering via a bottom sheet.
- Section index (A-Z) for long alphabetical lists on iOS.
- Sticky section headers for long grouped lists.
- Empty lists get a real empty state centered in the content area.

## 10. Forms and input on mobile

- One field per row, full width, 16pt margins; labels above (or inline
  iOS-style label-left value-right for settings-like forms).
- Field height 44-48pt; 16-17pt text (prevents iOS zoom on web); clear
  button on text fields with content.
- The right keyboard: `email`, `number pad`, `phone pad`, `URL`, `decimal`,
  `one-time code` with autofill; return key labeled Next/Done/Go.
- Native pickers for dates, times, and short option lists (iOS wheel or
  compact; M3 date picker; both are better than custom dropdowns).
- Autofill: contact info, passwords, one-time codes, addresses, credit
  cards; set the content type / autofill hints.
- Validation on blur and submit; errors below the field; scroll to the
  first error on submit.
- Sticky submit at the bottom (above the keyboard) for long forms;
  progress for multi-step.
- Avoid: dropdown menus that mimic desktop selects; small checkboxes
  without row-wide targets; horizontal scrolling inputs; disabled submit
  with no feedback; CAPTCHAs without accessible alternatives.
- Sign-in: platform sign-in (Sign in with Apple, Google), passkeys, and
  password manager support; never block paste.

## 11. Sheets, dialogs and overlays

- **Bottom sheet** is the mobile modal. Detents: medium (half) for quick
  actions and pickers, large (near full) for forms and content; a grab
  handle 36x5pt; 16-20pt padding; a title and a Close/Done; scrollable
  content; dismiss by swipe, scrim tap (non-destructive), and button.
  Android: standard and modal bottom sheets; respect system back.
- **Action sheet** (iOS) / list bottom sheet (Android) for choosing among
  3-6 actions on an item; destructive in red, Cancel separated.
- **Alert dialog**: platform-styled, title + one sentence + 2 buttons
  (platform order: iOS cancel left/affirmative right; Android text
  buttons trailing). Use rarely; prefer undo. Do not custom-style alerts;
  users trust the system look for consequential choices.
- **Toast / snackbar**: Android snackbar at the bottom above the nav bar,
  4-10s, one action; iOS has no system toast, so a small top or bottom
  banner matching the brand, 3-5s. Never cover the primary CTA.
- **Popovers** are tablet/desktop; on phones they become sheets.
- **Full-screen overlays** (image viewers, video) with a visible close in
  the top corner and swipe-down to dismiss.
- **Permission prompts**: show a brief in-app explanation first (why you
  need the camera), then trigger the system prompt; the system prompt
  cannot be styled and can be shown only once, so earn the yes.

## 12. Type and density on phones

- Body 16-17pt; secondary 14-15; captions 12-13; nothing under 11.
- Titles: 20-22 for screen titles in a bar, 28-34 for large titles.
- Line length is naturally short; keep paragraphs short too.
- Honor system text scaling. Test at the largest accessibility size:
  horizontal arrangements become vertical, truncation gets a second line,
  icons and text stay aligned.
- Density: phones are Comfortable or Spacious; Compact belongs to tablets
  and desktop. Rows 44-56pt; padding 16; gaps 12-16.
- Numbers in lists: tabular (`.monospacedDigit()`, `FontFeature.
  tabularFigures()`) so prices and times align.
- Headings in lists are small (13-14 uppercase or title-case) because
  screen space is scarce; the content is the point.

## 13. Tablets and foldables

- Use the width: list-detail (master-detail) layouts, two-pane settings,
  sidebars (iPadOS sidebar, M3 navigation rail/drawer), multi-column
  grids.
- Do not stretch phone layouts; a 17pt line of text at 1024pt wide is
  unreadable. Cap content width or go multi-column.
- Support multitasking sizes (Split View, Slide Over, Android freeform):
  the layout must adapt to roughly 320-1024pt widths dynamically, like a
  responsive website. Use size classes (compact/regular) and window size
  classes (compact/medium/expanded), not device checks.
- Foldables: the hinge may bisect the screen; avoid placing primary
  content across it (Compose `WindowInfoTracker` / `FoldingFeature`);
  tabletop and book postures place controls on one half.
- Pointer and keyboard: tablets have them; hover states and keyboard
  shortcuts matter here.

## 14. Flutter and React Native: platform adaptivity

- **Flutter**: `Theme.of(context).platform` or `defaultTargetPlatform` to
  branch; `.adaptive` constructors (`Switch.adaptive`, `Slider.adaptive`,
  `AlertDialog.adaptive`, `CircularProgressIndicator.adaptive`);
  `CupertinoPageRoute` / `CupertinoPageScaffold` on iOS when the app wants
  a native stack feel; or Material 3 everywhere with iOS-aware tweaks
  (back swipe via `CupertinoPageTransitionsBuilder` in `pageTransitionsTheme`,
  no ripple on iOS via `splashFactory`, iOS-style scroll physics are
  automatic). Set `pageTransitionsTheme` per platform. Use `SafeArea`,
  `MediaQuery.textScalerOf`, and `MediaQuery.disableAnimationsOf`.
- **React Native**: `Platform.select` for structural differences; native
  navigators (`@react-navigation/native-stack`) give the right transitions
  and back behavior per platform; use native pickers and action sheets
  (`ActionSheetIOS`, community date pickers); `SafeAreaView` /
  `react-native-safe-area-context`; `KeyboardAvoidingView`; haptics via
  Expo Haptics.
- **Shared design, per-platform structure**: one token set (colors, type
  family, spacing); per-platform values for radii (iOS slightly larger),
  tab bar height, title style, and control components.
- **Icons**: SF Symbols on iOS, Material Symbols on Android, or a single
  set (Phosphor, Lucide) with platform-recognizable glyphs for back,
  share, close, more.

## 15. Responsive web on phones

The web on a phone is still a phone. Beyond the responsive layout rules
in layout-and-spacing.md:

- `viewport-fit=cover` and `env(safe-area-inset-*)` for fixed bars.
- Bottom-fixed primary actions and tab bars for app-like sites; sticky
  bottom CTA on marketing pages only if it does not cover content.
- `100dvh` not `100vh`; `touch-action: manipulation` on buttons to kill
  the 300ms tap delay on old browsers; `-webkit-tap-highlight-color:
  transparent` plus a designed active state.
- Inputs 16px to prevent iOS zoom; `inputmode` and `autocomplete`.
- `overscroll-behavior: contain` on scroll containers inside fixed
  layouts; `scroll-snap` for carousels.
- Hover states gated with `@media (hover: hover)`; focus styles still
  present for external keyboards.
- Native-feeling sheets via the `<dialog>` element with bottom positioning
  and a drag-to-dismiss enhancement; or keep it simple with a full-screen
  dialog.
- PWA considerations: `theme-color` meta matching the header, a maskable
  icon, `display: standalone` changes safe areas and removes browser back
  (so in-app back must exist).
- Performance: see landing-pages.md budgets; phones on cellular are the
  reference device.

## 16. Mobile anti-patterns

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| Hamburger menu for primary nav | Hides destinations; halves usage | Bottom tabs for 3-5 |
| Desktop dropdown selects | Hard to tap; fights native pickers | Native picker or a bottom sheet list |
| Custom alert styling | Loses trust for consequential choices | Platform alert |
| Buttons flush with the bottom edge | Collide with home indicator / gesture bar | Add the safe inset |
| Horizontal carousels at screen edges | Conflict with back gestures | Inset, or vertical layout |
| Tiny close × in a corner | Hard to hit; conflicts with cutouts | 44pt target; or swipe-down with a handle |
| Phone layout stretched on tablet | Unreadable; wasteful | List-detail; multi-column |
| Ignoring text scaling | Truncated or overlapping text at large sizes | Dynamic Type / sp; test at max |
| Gesture-only features | Undiscoverable; inaccessible | Visible alternative |
| Hover-dependent interactions | No hover on touch | Tap to reveal; always-visible controls |
| Modal on launch (ratings, upsell) | Blocks the task; resented | Contextual prompts after value is delivered |
| Permission prompts at launch | Denied reflexively; cannot re-ask | Ask in context with a pre-prompt |
| Splash screen with animation | Delays the app; feels slow | System launch screen that matches the first screen |
| Light-theme screenshots in dark mode app | Jarring | Theme-aware assets |
| iOS look on Android or vice versa | Users notice; feels like a port | Platform structure, shared brand |
