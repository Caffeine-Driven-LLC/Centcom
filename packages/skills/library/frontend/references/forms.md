# Forms

Controlled versus uncontrolled, schema validation with zod/yup/valibot, the
server as the source of truth, accessible error wiring, submission states,
multi-step forms, file uploads, autosave, and the form libraries per
framework. Forms are where most UI bugs and most accessibility failures
live, and where an agent most often produces fifteen `useState`s and a
disabled submit button.

## Contents

1. Decide the shape first
2. Controlled vs uncontrolled
3. Schema validation: zod, valibot, yup
4. Server validation is the source of truth
5. Error display and accessibility
6. Submission states and double-submit
7. Form libraries by framework
8. Multi-step forms
9. File uploads
10. Autosave and drafts
11. Dynamic fields and arrays
12. Anti-patterns with fixes

## 1. Decide the shape first

Before writing a field, answer:

- What does the server accept? That schema is the contract; the client
  schema is a copy or a derivation of it, never a stricter or looser
  invention.
- Which fields depend on others (country → state list, "other" → free
  text)? Those are the only ones that need to be watched.
- When do errors show: on blur, on submit, live while typing? Default:
  validate on blur after first interaction, re-validate on change once a
  field has errored, and validate everything on submit. Live validation
  while typing an email is hostile ("invalid" after the first character).
- What happens on success: navigate, reset, show inline confirmation?
- Does it need to work without JS? In meta-frameworks with actions
  (Next, SvelteKit, Remix), yes by default; design for it.
- Is this form the repo's tenth? Then it uses the repo's form library and
  field components. Grep for `useForm`, `Field`, `FormField`, `v-model`
  wrappers, `formControlName` before writing anything.

## 2. Controlled vs uncontrolled

**Uncontrolled**: the DOM owns the value; read it on submit via `FormData`
or a ref. Zero re-renders while typing, works without JS, simplest for
"collect and send" forms.

```tsx
function ContactForm({ action }: { action: (fd: FormData) => Promise<void> }) {
  return (
    <form action={action}>                            {/* React 19 / Next: progressive enhancement built in */}
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" required autoComplete="email" />
      <label htmlFor="message">Message</label>
      <textarea id="message" name="message" required minLength={10} />
      <button type="submit">Send</button>
    </form>
  )
}
// Without actions: onSubmit={e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)) }}
```

**Controlled**: component state owns the value, each keystroke re-renders.
Needed when the UI depends on the value as it changes (character counter,
live formatting of a card number, dependent fields, instant search).

Form libraries blur the line: react-hook-form registers uncontrolled
inputs by default and subscribes to specific fields with `watch`/
`useWatch`; TanStack Form and Formik are controlled with isolation per
field. In Vue, `v-model` is controlled by nature but cheap; in Svelte,
`bind:value` likewise; in Angular, reactive forms are a controlled model
outside the template.

Rule: uncontrolled (or library-managed) by default; controlled for the
specific fields that drive other UI. Fifteen `useState`s for fifteen fields
is never right.

Native validation attributes (`required`, `type="email"`, `minlength`,
`pattern`, `min`/`max`) work without JS and give AT-announced errors;
keep them even when you also validate with a schema, but add `noValidate`
on the form if you want to control the error display yourself (the
browser's bubbles cannot be styled and vanish on blur).

## 3. Schema validation: zod, valibot, yup

Define the schema once and derive the TypeScript type from it. Use the
schema library already in the repo.

```ts
import { z } from 'zod'

export const addressSchema = z.object({
  line1: z.string().trim().min(1, 'Street address is required').max(120),
  line2: z.string().trim().max(120).optional().or(z.literal('')),
  city: z.string().trim().min(1, 'City is required'),
  country: z.enum(['US', 'CA', 'GB', 'DE']),
  postalCode: z.string().trim().min(1, 'Postal code is required'),
}).superRefine((v, ctx) => {
  if (v.country === 'US' && !/^\d{5}(-\d{4})?$/.test(v.postalCode))
    ctx.addIssue({ code: 'custom', path: ['postalCode'], message: 'Enter a 5-digit ZIP code' })
})

export const checkoutSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  shipping: addressSchema,
  billingSameAsShipping: z.boolean().default(true),
  billing: addressSchema.optional(),
  terms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) }),
}).refine(v => v.billingSameAsShipping || v.billing, { path: ['billing'], message: 'Billing address is required' })

export type CheckoutInput = z.input<typeof checkoutSchema>     // what the form holds (strings, maybe empty)
export type Checkout = z.output<typeof checkoutSchema>         // what the server receives (trimmed, coerced)
```

Notes: `z.coerce.number()` for numeric inputs (FormData gives strings);
`z.input` vs `z.output` differ when you use transforms/defaults, and the
form state type is the input; error messages are user-facing copy (the
design skill's voice applies: say what to do, not what is wrong);
valibot is the tree-shakeable alternative with the same mental model
(`v.object`, `v.pipe(v.string(), v.email())`), yup is the older
Formik-era choice; share the schema file between client and server (a
`schemas/` module imported by both) so they cannot drift.

## 4. Server validation is the source of truth

Client validation is UX: fast feedback, fewer round trips. It is not
security and it is not correctness; the request can come from anywhere.
The server validates the same schema (plus checks the client cannot do:
uniqueness, permissions, inventory, rate limits) and returns field-level
errors in a predictable shape the client maps back to fields.

```ts
// Shared error shape
type FieldErrors = Record<string, string[] | undefined>
type ActionResult<T> = { ok: true; data: T } | { ok: false; fieldErrors?: FieldErrors; formError?: string }

// Server (Next action / Remix action / SvelteKit action / route handler all the same idea)
export async function submitCheckout(_prev: ActionResult<Order> | null, formData: FormData): Promise<ActionResult<Order>> {
  const parsed = checkoutSchema.safeParse(nested(formData))        // nested(): turn 'shipping.city' keys into objects
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors }
  const session = await auth(); if (!session) return { ok: false, formError: 'Your session expired. Sign in again.' }
  const emailTaken = await db.user.exists({ email: parsed.data.email })
  if (emailTaken) return { ok: false, fieldErrors: { email: ['An account with this email already exists'] } }
  const order = await createOrder(session.user.id, parsed.data)
  return { ok: true, data: order }
}
```

Client: map `fieldErrors` onto the form library (`setError('email', ...)`
in react-hook-form, `form.setErrors` in vee-validate, `setErrors` in
Angular, `form?.errors` from the action in SvelteKit) and focus the first
errored field. Form-level errors (`formError`) render in an `role="alert"`
region above the submit button. Never trust `disabled` on a field to
prevent a value from being submitted; the server ignores fields the user
should not set.

## 5. Error display and accessibility

Every error must be: visible next to its field, programmatically linked
(`aria-describedby`), reflected in state (`aria-invalid`), and announced
(either `role="alert"` on the message when it appears, or focus moved to
the first invalid field on submit). The field component does this once:

```tsx
type FieldProps = { label: string; hint?: string; error?: string; children: (a: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode }
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  return (
    <div className="field" data-invalid={!!error || undefined}>
      <label htmlFor={id}>{label}</label>
      {hint && <p id={hintId} className="hint">{hint}</p>}
      {children({ id, 'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined, 'aria-invalid': error ? true : undefined })}
      {error && <p id={errId} className="error" role="alert">{error}</p>}
    </div>
  )
}
// <Field label="Email" error={errors.email?.message}>{a => <input type="email" {...a} {...register('email')} />}</Field>
```

Rules: errors in words, not just red borders (color alone fails for
colorblind users and screen readers); do not clear the field on error;
keep the submit button enabled so users can trigger validation and hear
what is wrong; on submit with errors, focus the first invalid field
(`setFocus` in RHF; `shouldFocusError` is on by default) or an error
summary for long forms; required fields marked in the label (text or an
asterisk with a legend), not only by color; `autocomplete` tokens on
identity fields. Design-level copy and layout for errors is in
`design/references/ux-and-flows.md` and `design/references/accessibility.md`.

## 6. Submission states and double-submit

- Pending: disable the submit button *after* the click (not before the
  form is valid), show a label change ("Saving…") or spinner with
  `aria-busy="true"` on the form; keep fields editable unless editing
  during submit would be harmful.
- Prevent double submit: `isSubmitting` guard in the handler plus the
  disabled button; for actions, `useFormStatus().pending`. Idempotency
  keys for payment-like submissions (generate once per form instance,
  send as a header) so a retry does not double-charge.
- Success: navigate (`redirect`) for create flows (avoids resubmit on
  refresh), inline confirmation for settings ("Saved" with `role="status"`,
  then fade), reset for repeated entry (`form.reset()` / RHF `reset()`).
- Failure: field errors mapped; network failure shows a retry affordance
  and preserves input. Never lose what the user typed.
- Dirty-state guard: warn on navigation with unsaved changes
  (`beforeunload` for tab close, router `beforeNavigate`/`useBlocker` for
  SPA navigation), only when dirty.

## 7. Form libraries by framework

| Framework | Default | Notes |
|---|---|---|
| React | react-hook-form + `@hookform/resolvers/zod` | Uncontrolled registration, `useWatch` for dependent fields, `useFieldArray`, `setError` for server errors. TanStack Form if the repo has it (framework-agnostic, typed field API). Formik in legacy codebases. React 19 actions + `useActionState` for simple progressive forms without a library |
| Next App Router | Server actions + `useActionState`, optionally RHF on the client with `action` for submission | Validate in the action with the shared schema; `conform` (`@conform-to/react`) bridges RHF-like DX with actions |
| Remix / React Router | `<Form>` + `action` + `useActionData`; `conform` or `remix-hook-form` | Progressive by default |
| Vue | vee-validate + `@vee-validate/zod`, or FormKit | `useForm`, `useField`, `defineField`; `setErrors` for server errors |
| Nuxt | vee-validate; server validation in `server/api` with `readValidatedBody` | |
| Svelte/SvelteKit | Form actions + `use:enhance`; `sveltekit-superforms` for schema-driven client+server | `superForm` handles errors, tainted state, progressive enhancement |
| Angular | Reactive forms (`FormBuilder.nonNullable.group`), typed | Custom validators as functions; `ControlValueAccessor` for custom inputs; `updateOn: 'blur'` |
| Solid | `@modular-forms/solid` or plain `FormData` | |
| Web components / vanilla | `FormData` + schema, `ElementInternals` for custom controls | `setValidity()` for custom constraint messages |

```tsx
// react-hook-form with zod and server errors
const form = useForm<CheckoutInput>({ resolver: zodResolver(checkoutSchema), defaultValues, mode: 'onTouched' })
const same = useWatch({ control: form.control, name: 'billingSameAsShipping' })   // only this subscription re-renders
async function onSubmit(values: CheckoutInput) {
  const result = await submitCheckout(values)
  if (!result.ok) {
    Object.entries(result.fieldErrors ?? {}).forEach(([name, msgs]) => msgs && form.setError(name as any, { message: msgs[0] }))
    if (result.formError) form.setError('root.server', { message: result.formError })
    return
  }
  router.push(`/orders/${result.data.id}`)
}
<form onSubmit={form.handleSubmit(onSubmit)} noValidate aria-busy={form.formState.isSubmitting}>
  ...
  {form.formState.errors.root?.server && <p role="alert">{form.formState.errors.root.server.message}</p>}
  <button type="submit" disabled={form.formState.isSubmitting}>Place order</button>
</form>
```

## 8. Multi-step forms

Model it as one schema with one state, and a `step` that decides which
fields render and which subset validates on "Next".

```ts
const steps = [
  { id: 'account', fields: ['email', 'password'] as const, schema: checkoutSchema.pick({ email: true }) },
  { id: 'shipping', fields: ['shipping'] as const, schema: checkoutSchema.pick({ shipping: true }) },
  { id: 'review', fields: [] as const, schema: checkoutSchema },
]
async function next() {
  const valid = await form.trigger(steps[step].fields)   // validate only this step's fields
  if (!valid) return
  setStep(s => s + 1)
}
```

Rules: step index in the URL (`?step=shipping`) so refresh and back work;
persist the draft (sessionStorage or server) so a reload does not wipe
five minutes of typing; show progress (`<ol>` with `aria-current="step"`);
allow going back without losing data; validate the whole schema on final
submit; move focus to the step heading on step change; one submit at the
end, not one per step (unless each step is independently saved, which is
then a wizard of forms, each with its own action).

## 9. File uploads

- `<input type="file" accept="image/*,.pdf" multiple>` with a visible
  `<label>`; style the label, keep the input focusable (visually hidden,
  not `display:none`). Drag-and-drop is an enhancement over the input,
  never a replacement.
- Validate type and size client-side for feedback (`file.size <= 10 *
  1024 * 1024`, check `file.type` and extension), server-side for truth
  (content sniffing; `security` owns the rest).
- Large files: upload directly to object storage with a presigned URL from
  your server (`backend` provides it), not through your app server.
  `XMLHttpRequest` or `fetch` with a `ReadableStream` body for progress;
  `fetch` has no upload progress in most browsers, so XHR `upload.onprogress`
  is still used.
- Show per-file progress (`<progress>`), allow cancel (`AbortController`
  / `xhr.abort()`), retry on failure, and keep the rest of the form usable.
- Previews: `URL.createObjectURL(file)` and `revokeObjectURL` on cleanup.
  Resize images client-side (canvas or `createImageBitmap`) before upload
  when the server only needs a thumbnail-scale image.
- Submit the resulting file key/URL with the form, not the bytes again.
- Accessibility: announce upload complete/failure via live region; the
  file list has remove buttons with names ("Remove report.pdf").

## 10. Autosave and drafts

- Debounce (800-2000 ms after the last change) and save on blur of the
  form and on `visibilitychange` to hidden. Do not save on every
  keystroke.
- Save the diff or the whole draft to a draft endpoint distinct from the
  real submit; the real submit still validates fully.
- Status text: "Saving…", "Saved 2 min ago", "Couldn't save. Retrying…"
  in a `role="status"` region, polite, not re-announced every second.
- Conflict handling: send a version/updated-at; on 409 show "This was
  changed elsewhere" with a reload option. Collaborative editing is a
  different problem (CRDTs); do not fake it with last-write-wins silently.
- Local fallback: sessionStorage/IndexedDB keyed by form + user so a crash
  or offline moment does not lose text; clear on successful submit.
- Never autosave sensitive fields (passwords, card numbers).

```ts
const debounced = useDebouncedCallback((values: DraftInput) => saveDraft.mutate(values), 1500)
useEffect(() => { const sub = form.watch(v => form.formState.isDirty && debounced(v)); return () => sub.unsubscribe() }, [form, debounced])
```

## 11. Dynamic fields and arrays

Lists of line items, phone numbers, team members: use the library's array
helper (`useFieldArray`, vee-validate `useFieldArray`, Angular
`FormArray`, superforms arrays) keyed by a generated id, not index, so
removing the middle row does not shift values into the wrong inputs.
Each row's inputs get unique ids and labels ("Quantity for item 2" via
`aria-label` or visible column headers in a table with `<th>` scoped).
"Add row" focuses the new row's first field; "Remove" focuses the next
row's control or the "Add" button if none. Validate arrays with
`z.array(itemSchema).min(1, 'Add at least one item')` and show the array-
level error near the add button.

Dependent fields: watch the controller field only (`useWatch({ name:
'country' })`), reset dependents when it changes (`resetField('state')`),
and load options via the cache library keyed by the controller value.

## 12. Anti-patterns with fixes

| Anti-pattern | Fix |
|---|---|
| One `useState` per field | Form library or `FormData` |
| Submit button disabled until the form is valid | Enabled; validate on submit; focus first error |
| Validation only on the client | Shared schema validated on the server too |
| Errors as red borders only | Text error linked via `aria-describedby`, `aria-invalid` |
| Placeholder as label | `<label>` |
| Clearing the form on error | Preserve input; map errors |
| Live validation from the first keystroke | `onTouched`/blur, then on change after error |
| `onChange={e => setValue(e.target.value)}` for 20 fields causing re-render of the whole form | Uncontrolled registration; isolated subscriptions |
| Server errors shown as a toast only | Field-level mapping + form-level alert |
| Multi-step with separate state per step | One schema, one state, step-scoped validation |
| Index keys on field arrays | Generated ids |
| `type="button"` missing on non-submit buttons inside a form | Add it; otherwise Enter submits via the wrong button |
| Uploading through the app server | Presigned direct upload |
| Autosave on every keystroke | Debounce + blur + visibility |
| Numeric inputs parsed with `parseInt` ad hoc | `z.coerce.number()` in the schema |
| Trusting disabled/hidden fields | Server ignores fields the user cannot set |
