# UX and flows

User flows, information architecture, progressive disclosure, form design
(labels, validation timing, error copy), onboarding, the five states of every
view, confirmation versus undo, destructive actions, perceived performance,
mobile ergonomics and notifications. This is the judgment layer: what should
happen, in what order, and what the user should see at each step.

## Contents

1. Start from the task, not the screen
2. Mapping a flow
3. Information architecture
4. Progressive disclosure
5. The five states of every view
6. Forms
7. Validation timing and error copy
8. Confirmation versus undo; destructive actions
9. Onboarding and first run
10. Feedback and system status
11. Perceived performance
12. Mobile ergonomics
13. Notifications
14. Search and filtering
15. Settings
16. UI copy: the rules
17. Common UX failures and fixes

## 1. Start from the task, not the screen

Users do not want screens; they want outcomes. Before laying anything out,
write the task in one sentence from the user's side: "Pay this invoice
before Friday." "Find out why the deploy failed." "Add my partner to the
account." Then ask what the fewest steps to that outcome are, what
information the user needs at each step, and what they need to feel
(confident, safe, informed) to proceed.

The screen is then a container for one step of the task. A screen that
tries to serve three tasks at once serves none; a flow that puts a decision
before the information needed to make it stalls.

Hierarchy of user needs on any screen, in order: Where am I? What can I do
here? What is the state of things? What should I do next? The layout should
answer these in that order as the eye moves.

## 2. Mapping a flow

Write the flow as a numbered list of steps with, for each: what the user
sees, what they do, what the system does, and what can go wrong.

```
Flow: Invite a teammate
1. Team page. Sees member list and "Invite member" (primary). Clicks.
2. Invite dialog. Sees email field (focused), role select (default: Member),
   optional message. Types email. Error paths: invalid email, already a
   member, seat limit reached (show before they type, not after).
3. Clicks "Send invite". Button shows loading; on success dialog closes,
   list shows the pending member with "Invited" badge, toast "Invite sent
   to ana@acme.com" with "Resend" action. On failure: inline error in the
   dialog, field keeps the value, focus returns to the field.
4. (Later) The invitee accepts; the row updates in place.
```

Design rules that fall out of mapping:

- **Put the information before the decision.** If seats are limited, show
  "2 of 5 seats used" at step 1, not an error at step 3.
- **Keep the user's work.** Never clear a form on error. Never lose typed
  text on navigation without asking.
- **Make the next step obvious** with exactly one primary action per step.
- **Give a way back** at every step, and make it safe (Cancel does not
  destroy; Back preserves input).
- **Close the loop.** After the action, show the result where the user
  is looking (the list updates) and confirm without blocking (toast).
- **Branch for the common error paths** and design them; the unmapped
  branch is the one that ships with a raw exception message.

Count the steps and the decisions. A flow with more than 5-7 steps for a
common task, or a decision the user cannot answer, needs restructuring.
Consider: defaults that make a decision optional, splitting rare options
into a later "advanced" step, or deferring input until it is needed (ask
for the credit card when they upgrade, not when they sign up).

## 3. Information architecture

IA is the structure of the product: what the top-level sections are, what
belongs under each, and what things are called.

- **Organize by user mental model, not by database table.** Users think
  "my projects, my team, billing," not "entities, relationships,
  transactions."
- **Five to seven top-level destinations** at most. More means the model
  is unclear or the product is several products.
- **One home for each thing.** If an invoice can be found under Billing
  and under Projects, make one the canonical location and the other a
  cross-link; do not duplicate the full UI.
- **Name things with the user's words.** Run a quick test: would a new
  user know what "Workspaces," "Spaces," "Projects" and "Boards" each mean?
  Pick the fewest nouns. Keep each noun's meaning constant everywhere.
- **Depth versus breadth**: shallow (2-3 levels) and broad beats deep and
  narrow. Each level of depth is a place to get lost.
- **Global versus contextual actions**: create, search and notifications
  are global (header); edit, share and delete are contextual (on the
  object).
- **Settings are a graveyard**; anything the user needs regularly should
  not live there.

Validate IA with a card sort in your head: list 20 features and ask where
a user would look for each. If more than three are ambiguous, restructure.

## 4. Progressive disclosure

Show what most users need most of the time; make the rest available in one
step. This is the main tool against both clutter and oversimplification.

Levels, from most to least visible:

1. **Always visible**: the primary task's controls and information.
2. **One click away, in place**: "Show advanced", an expandable section,
   a "..." menu, a hover-revealed row action. The user stays in context.
3. **One click away, new context**: a dialog, a drawer, a sub-page.
4. **Discoverable**: settings, keyboard shortcuts, a help panel.

Rules:

- Defaults do the disclosure: a form with good defaults can hide 70% of
  its fields behind "Advanced options."
- Disclosure should be reversible and remembered where it is a preference
  (a user who expanded "advanced" twice probably wants it open).
- Do not hide things users need every session (that is not disclosure, it
  is burial). Do not hide the only escape route.
- Hover-revealed actions need a focus-visible equivalent and a touch
  equivalent (always visible or in a menu on touch).
- "Show more" on text: clamp to 3 lines and expand in place; never link
  away to read the rest of a description.
- Wizards (multi-step forms) are progressive disclosure over time. Use them
  when steps are genuinely sequential or when the whole form would be
  overwhelming; show a step indicator; let users go back; save progress.
  Do not use a wizard for 4 fields.

## 5. The five states of every view

Every data-bearing view has five states. Design all of them before
building; the undesigned ones ship as blank areas or raw errors.

| State | When | What to show |
|---|---|---|
| **Empty** | No data yet, or no results | What this is for, and the first action (see components.md, Empty states) |
| **Loading** | Waiting for data | Skeleton of the eventual layout if over ~300ms; nothing if faster; a progress indicator for long known waits |
| **Partial** | Some data, some missing or still loading; a list of 2 items in a layout designed for 20; a chart with one point | Layout holds with fewer items (no giant gaps); inline placeholders for missing fields ("Not set", not blank); streaming content appears progressively |
| **Error** | Load failed, permission denied, offline, stale | What went wrong in plain words, what to do (Retry, Go back, Contact), and what is still usable; keep the chrome and any cached data |
| **Ideal** | Everything loaded, representative amount of data | The one everybody designs; verify it also handles long names, many items, extreme values |

Partial is the most neglected. Design for the real distribution of content:
a dashboard with 1 project, a table with 3 rows, a profile with no avatar
and no bio, a title of 120 characters, a currency amount of
1,234,567,890.00, an org name in Japanese, a username with no spaces that
is 40 characters long.

Error states specifically:

- **Full-page error** only when nothing on the page can work. Keep
  navigation; offer Retry and a way back; include a reference ID users can
  quote to support if the error is unexpected.
- **Section error** when one panel fails: the rest of the page stays
  usable; the panel shows a compact error with Retry.
- **Inline error** for field-level or action-level failures, at the point
  of failure.
- **Offline**: a persistent banner; disable actions that need the network
  and say why; queue when possible.
- **Permission**: say what the user cannot do and who can grant it ("You
  need the Admin role to change billing. Ask an admin or request access.").
- **Stale**: show a timestamp ("Updated 4 min ago") and a refresh action
  when data may be out of date.

## 6. Forms

Forms are where products lose users. Principles:

- **Ask for less.** Every field must justify its existence by what the
  product does with it. Defer optional data to later ("Add a profile photo"
  as a later prompt, not a signup field).
- **One column.** Multi-column forms break the eye's path and are
  misordered by screen readers. Put short related fields (city, state, ZIP;
  first and last name) side by side only when they are read as one unit.
- **Labels above fields**, always visible, 13-14px, 500-600 weight.
  Left-aligned labels in a column to the side are acceptable in dense
  desktop settings pages; floating labels and placeholder-as-label are not.
- **Mark the minority.** If most fields are required, mark the optional
  ones with "(optional)"; if most are optional, mark required with an
  asterisk and explain it once at the top.
- **Field width matches content length** (see components.md).
- **Group with headings and space**, not boxes. 8-12px label to field, 16-
  24px between fields, 32-48px between groups.
- **Helper text before the mistake.** Format hints ("8+ characters with a
  number") sit under the field from the start; do not reveal the rules only
  as errors.
- **Smart defaults and inference**: default the country from locale, the
  date to today, the role to the common one; infer the card type from the
  number; autofill with `autocomplete` attributes (`email`, `given-name`,
  `postal-code`, `cc-number`, `one-time-code`).
- **Right input type and keyboard**: `type="email"`, `inputmode="numeric"`
  for codes, `type="tel"`. Date pickers for unknown dates; typed input for
  known dates (birthdays are typed faster than picked).
- **Buttons at the end**, primary first in reading order (left on
  left-to-right web forms is debated; right-aligned primary is the
  convention in dialogs and most apps; be consistent across the product).
  Label with the outcome: "Create account", "Save changes".
- **Preserve input** across errors, navigation (ask before discarding),
  and reloads where feasible (draft persistence).
- **Long forms**: progress indicator, section navigation, save-as-draft,
  and a review step for high-stakes submissions.
- **Disable the submit button only while submitting**, not while the form
  is invalid. A disabled submit with no explanation is a dead end; let the
  user click and show them what to fix.

## 7. Validation timing and error copy

**When to validate:**

| Moment | Use for |
|---|---|
| While typing | Only positive or format-assist feedback (password strength meter, character count, formatting a card number). Never show "invalid" while the user is still typing a value |
| On blur (leaving the field) | Format checks (email shape, required). The field has had its chance to be right |
| On submit | Cross-field rules (dates in order, passwords match), server checks (email taken), everything not caught earlier |
| Reward early, punish late | A field that was invalid and becomes valid should update immediately as the user types the fix |

Place the error directly below the field, in `danger-fg` with an icon, and
mark the field border. On submit with multiple errors, also show a summary
at the top ("3 fields need attention") with links to each, and move focus
to the first invalid field.

**Error copy** says what is wrong and how to fix it, in the user's words,
without blame:

| Bad | Good |
|---|---|
| Invalid input | Enter an email address like name@example.com |
| Required | Enter your company name |
| Password must match pattern | Use at least 8 characters, including a number |
| Error 422 | That username is taken. Try adding a number or a dot |
| Something went wrong | Couldn't save your changes. Check your connection and try again |
| Date is invalid | End date must be after the start date (Mar 3) |

No exclamation marks, no "Oops", no "Please" at the start of every message
(it reads as groveling at scale), no technical codes as the headline (put
them in small text if support needs them).

**Success**: do not thank the user for every field. A single quiet
checkmark for fields that were corrected is enough; the real confirmation
is the submit result.

## 8. Confirmation versus undo; destructive actions

Confirmation dialogs interrupt; users learn to click through them, and the
one time it matters they click through that too. Undo lets the user act
freely and repair mistakes. Prefer undo whenever the action is reversible
within the product.

| Situation | Pattern |
|---|---|
| Delete one item, recoverable (trash, soft delete) | Act immediately; toast "Moved to trash. Undo" for 6-8s |
| Archive, mute, hide, remove from list | Immediate + undo |
| Bulk action on many items | Confirm with the count ("Delete 23 files?") because undo at scale is harder to trust; or immediate + undo if truly reversible |
| Permanent delete (no trash) | Confirm; for high-stakes (repository, workspace, account) require typing the name |
| Leave with unsaved changes | Confirm ("Discard changes?") with "Keep editing" as the safe default |
| Irreversible external effects (send email, charge card, publish) | Confirm, with a preview or summary of what will happen |
| Change that affects other users (remove a member, change permissions) | Confirm with the consequence stated |

Confirmation dialog design: title is the question with the object named
("Remove Ana from the team?"), body is one sentence of consequence
("She'll lose access to 4 projects immediately."), the confirming button
names the action and is styled destructive when destructive ("Remove
Ana"), Cancel is a ghost button, and focus starts on Cancel for destructive
confirms. Never "Are you sure?" with "Yes/No".

Destructive action placement: separate from constructive actions (last in
a menu after a divider; alone in a "Danger zone" section at the bottom of a
settings page with a border in `danger-border`), styled with danger color
only on hover or as a ghost until the user commits, never the primary
styled button of a form.

## 9. Onboarding and first run

The best onboarding is a product that explains itself through its empty
states and defaults. Tours and tooltips are a tax on attention; most users
skip them and then cannot find the information again.

Priorities:

1. **Get to value fast.** What is the smallest action that shows the
   product working? Make it the first thing. Defer account completion,
   team invites and preferences until after that moment.
2. **Pre-populate.** Sample data, a template, an example project the user
   can edit or delete. An empty workspace is harder than a workspace with
   one demo item labeled as such.
3. **Empty states as teaching.** Each empty list explains itself and
   offers its first action (see components.md).
4. **Checklists over tours.** A dismissible "Get started" card with 3-5
   steps and progress gives orientation without hijacking the screen.
   Hide it once complete or dismissed; make it findable again in Help.
5. **Contextual hints, once.** A single callout the first time a user
   meets a non-obvious feature, with a dismiss, stored so it never returns.
6. **Ask only what changes the experience.** "What will you use this
   for?" is fine if the answer actually configures something. Otherwise
   it is a survey and belongs later.
7. **Progressive permissions on mobile**: ask for notifications or
   location at the moment the feature is used, with a pre-prompt
   explaining why, not at launch.

Measure: time to first meaningful action, not tour completion.

## 10. Feedback and system status

Users need to know the system heard them and what it is doing.

- **Immediate acknowledgment** (under 100ms): pressed state, the toggle
  flips, the item appears (optimistically).
- **Progress for anything over 1 second**: spinner (unknown), progress bar
  (known), with text for anything over 5s ("Processing 3 of 12 files").
- **Completion**: the result appears where the user is looking, plus a
  non-blocking confirmation (toast) when the result is elsewhere or
  invisible.
- **Background work**: a persistent, unobtrusive indicator (a dot on the
  tasks icon, a thin progress bar at the top) and a place to see details.
- **Sync and save state**: "Saved" / "Saving..." / "Unsaved changes" text
  near the content, calm and small. Autosave where possible, with explicit
  save for high-stakes documents.
- **Selection state**: what is selected should be obvious at a glance
  (count in the bulk bar, highlighted rows).
- **Current location**: active nav item, page title, breadcrumbs; the user
  should never wonder where they are.

## 11. Perceived performance

Speed is perceived, and perception can be designed:

- **0-100ms**: feels instant. Target for all direct feedback.
- **100-300ms**: slight delay noticed; still feels responsive. Show nothing.
- **300-1000ms**: show a loading indicator, preferably a skeleton that
  matches the coming layout.
- **1-10s**: progress indication with text; let the user do other things.
- **10s+**: background it; notify on completion.

Techniques:

- **Optimistic updates** for actions that almost always succeed (like,
  rename, toggle, reorder). Reconcile silently; revert with a toast on
  failure.
- **Skeletons** over spinners: they set expectations about layout and
  feel faster.
- **Progressive rendering**: show the frame and the fast data first;
  stream the slow panel.
- **Prefetch** on hover or on viewport proximity for likely next
  navigations.
- **Instant navigation with stale data** ("stale-while-revalidate"): show
  the cached page immediately, update in place.
- **Avoid layout shift**: reserve space for images, ads, late content.
- **Delay the indicator**: a spinner that appears for 80ms and vanishes is
  worse than nothing. Wait 200-300ms before showing one.
- **Animate the wait when it is long and unavoidable** (a progress bar
  that visibly moves feels shorter than a static one; progress bars that
  accelerate toward the end feel faster).
- **Say what is happening** for multi-second tasks; named steps feel
  shorter than a bare bar.

## 12. Mobile ergonomics

Phones are held in one hand, in motion, in bad light, with a thumb that
comfortably reaches the bottom half of the screen and strains at the top
corners.

- **Thumb zone**: primary actions and navigation at the bottom (tab bar,
  floating action button, bottom sheet actions). Destructive actions out
  of the easy zone. Top corners for rare actions (back, close, settings)
  that the OS already places there.
- **Touch targets**: 44x44pt (iOS) / 48x48dp (Android) minimum, 8px between
  adjacent targets. Visual size can be smaller if the hit area is extended.
- **Reachability**: content starts near the top but controls live at the
  bottom. Long forms put the submit in a sticky bottom bar.
- **Gestures**: swipe back (iOS edge), swipe to dismiss sheets, pull to
  refresh, swipe actions on list rows (with a visible button alternative).
  Never make a gesture the only way to do something important.
- **Keyboard**: the right keyboard type per field; the view scrolls so the
  focused field is visible above the keyboard; "Next" moves between fields;
  the submit is reachable without dismissing the keyboard.
- **Text size**: 16px minimum for body; respects system text scaling
  (Dynamic Type, `sp`); layouts tolerate 200% text.
- **One-handed and interrupted use**: state persists across app
  backgrounding; forms do not reset; long tasks resume.
- **Context**: outdoors means glare (contrast matters more), motion means
  larger targets; design for the worst reasonable case.
- **Safe areas**: content respects notches, home indicators and rounded
  corners; backgrounds extend under them.

See mobile.md for platform specifics.

## 13. Notifications

Notifications interrupt; each one spends the user's trust. Design the
system, not just the toast:

- **Channels**: in-app (toast, badge, inbox), push, email, SMS. Each has a
  cost; match urgency to channel. A comment on your document: in-app badge
  and a daily email digest. A security alert: push and email immediately.
- **Batching**: group related events ("Ana and 3 others commented") and
  digest low-urgency ones.
- **An in-app inbox** for anything the user might want to find later;
  toasts are not a record.
- **Settings per category** with sensible defaults, in plain language
  ("Comments on my documents: In-app, Email digest"), and a global pause.
- **Actionable**: a notification that cannot be acted on from where it
  appears (Approve, Reply, View) is half a notification.
- **Respect quiet hours and the OS**: the platform's notification
  settings win; never nag users to turn them back on more than once.
- **Badge counts** reflect unread, actionable items only; a badge that
  never reaches zero is ignored.
- **Copy**: who did what to which object, in one line: "Ana approved
  'Q3 budget'". No "You have a new notification."

## 14. Search and filtering

- **Search** for when users know what they want; **filters** for when they
  know properties; **browse** for when they do not know. Most list views
  need two of the three.
- Search box prominent and consistent (header for global, above the list
  for local), with placeholder saying what it searches ("Search projects,
  people, files"), results as-you-type after 2 characters with a 150-300ms
  debounce, matches highlighted, recent searches when empty.
- Filters as chips or a sidebar; applied filters visible as removable chips
  above the results with a "Clear all"; counts next to filter values where
  cheap; result count always shown ("128 results").
- Zero results: say what was searched and filtered, offer to clear or
  broaden, suggest alternatives.
- Sort is separate from filter; default sort is the most useful (recent,
  relevance), not alphabetical.
- Persist filters in the URL so views are shareable and the back button
  works.
- Faceted filters for large catalogs; a single "Filter" button opening a
  panel for mobile.

## 15. Settings

- **Group by user goal**, not by system module: Account, Notifications,
  Appearance, Team, Billing, Security, Integrations, Advanced.
- **Each setting**: label (what it is), control, and a one-line description
  of the effect when non-obvious. Controls right-aligned in a two-column
  list on desktop; stacked on mobile.
- **Immediate effect** settings use switches and save on change with a
  brief "Saved" confirmation; **form-like** sections (profile) use fields
  and a Save button that enables when dirty.
- **Show the current value** in the summary row for navigable settings
  ("Language: English").
- **Danger zone** at the bottom, visually separated, for delete/transfer.
- **Search** settings once there are more than ~30.
- **Defaults** should be right for 80% so most users never open settings.

## 16. UI copy: the rules

Words in the interface are design. Rules that apply everywhere:

- **Sentence case** for everything except proper nouns (Title Case Reads
  Like Marketing And Slows Scanning).
- **Verbs on buttons**, naming the outcome: Save changes, Create project,
  Send invite, Delete file, Try again. Not Submit, OK, Yes, Confirm, Proceed.
- **Nouns for navigation and headings**: Projects, Billing, Team.
- **Consistent vocabulary**: the same thing has the same name on every
  screen; the button and the resulting toast use the same verb (Publish ->
  Published).
- **Active voice, present tense**: "Saves automatically" not "Changes will
  be saved automatically by the system."
- **Front-load the key word**: "Delete project" not "Project deletion".
  Screen readers and scanners hear the first word.
- **No jargon from the implementation**: "Couldn't connect" not "Socket
  timeout"; "Notifications" not "Webhook config".
- **Be specific**: "No invoices yet" not "No data"; "Saved 2 minutes ago"
  not "Saved recently".
- **Short**: labels 1-3 words, helper text one line, errors one or two
  sentences, dialogs under 30 words.
- **No filler**: "Please", "Simply", "Just", "Successfully" (if it
  happened, it succeeded), "Oops", "Uh-oh", exclamation marks.
- **Neutral, direct tone**; warmth comes from clarity and from helping,
  not from jokes. Humor in error messages lands badly when the user is
  frustrated.
- **Placeholders show format, not instructions**: "name@example.com" not
  "Enter your email".
- **Numbers**: use numerals ("3 files" not "three files"); format with
  locale separators; relative time for recent ("2 min ago"), absolute for
  older ("Mar 3, 2026"); show units.
- **Empty states and errors** follow the patterns above: what, why, what
  next.

## 17. Common UX failures and fixes

| Failure | Why it happens | Fix |
|---|---|---|
| Form clears on error | Default form reset | Preserve values; focus first error |
| Disabled submit, no explanation | "Prevent invalid submit" | Enable; validate on submit; show errors |
| "Are you sure?" on everything | Fear of destructive actions | Undo for reversible; specific confirms for the rest |
| Modal for everything | Easy to build | Inline editing, drawers, pages; modal only for focused short tasks |
| Empty table is blank | Only ideal state designed | Empty state with explanation and action |
| Spinner flashes constantly | Loading shown immediately | 200-300ms delay; skeletons; optimistic updates |
| Users can't find the setting | Settings organized by code module | Reorganize by goal; add search; move frequent settings out |
| Wizard for a 4-field form | Over-structuring | Single form with grouping |
| Tour nobody reads | Onboarding as explanation | Empty states, sample data, checklist |
| Notification fatigue | Every event notifies | Batch, digest, per-category settings |
| Lost on mobile | Nav in a hamburger with 12 items | Bottom tabs for 3-5 primary destinations; the rest in a More or profile |
| Generic error "Something went wrong" | No error path designed | Specific message, retry, reference ID |
| Hover-only actions | Desktop-first | Visible on focus; menu or always-visible on touch |
| Destructive button looks primary | Reuse of primary style | Danger style, separated, confirmation or undo |
| User doesn't know it saved | Silent autosave | "Saved" indicator; toast for explicit saves |
