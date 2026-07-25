# Phase 7 — Sidebar surfaces

**Status:** ✅ built, 2026-07-25 · **Estimate:** 1.5 weeks · **Depends on:** Phase 5

> Outcome, deviations and what is still blocked: `plan/PROGRESS.md` → "Phase 7 — Sidebar
> surfaces". Three things below were **not** built as written — the `pg_trgm` directory search
> (a user-enumeration API), an editable currency picker (v1 is INR-only by CHECK constraint),
> and the tip purchase itself (needs developer accounts). Read that entry before treating any
> of this file as the plan of record.

## Goal

Everything behind the profile icon: Sidebar, Settings, Add friend, Tip jar, Help, About. All
six are designed; none of their rows navigate anywhere in the prototype.

## Screens

### Sidebar — `Hisaab Sidebar.dc.html`

Slides in from the left over a dimmed Home. Profile summary, then Tip jar ("Support us!"),
Settings, Invite friends, Help and feedback, About, then Sign out in a quieter treatment.

The prototype's open/close state and **swipe-to-close** (45px threshold) are real — port them.
Every destination row shares one `onRow` handler that toasts; all of them need wiring.

*Naming:* the Sidebar says "Invite friends", the People tab says "Add someone new". Same
screen — pick one label. Recommend "Invite friends" in both, since with the share-sheet
approach that's what it actually does.

### Add friend / Invite — `Hisaab Add Friend.dc.html`, **needs rework**

The designed screen is built entirely around **phone numbers and the address book**, which no
longer applies: v1 drops phone auth, and reading contacts is a review-sensitive permission on
both stores requiring a privacy manifest and a Play data-safety declaration.

Replace with:
- A prominent **"Invite a friend"** action opening the OS share sheet (`Share.share()` — the
  native iOS/Android sheet, so WhatsApp, Messages, Telegram, and everything else come free)
  with a deep link carrying a `profile_claims` token, plus **Copy link**.
- Search for people already on Hisaab by name, backed by `pg_trgm`.
- Keep the "invited friends can view a shared expense before installing" note **only if** we
  build that — web share links are **out of v1**, so this copy comes out.

This deletes the entire Contacts permission surface. Good trade.

> ⚠️ Deep links need a domain for iOS Universal Links / Android App Links. A raw custom scheme
> works when the app is installed but degrades badly when it isn't — which is exactly the
> invite case. Open question #3.

### Settings — `Hisaab Settings.dc.html`

Account (name, photo, UPI ID), Notifications (three toggles, already real in the prototype),
Preferences (default currency), then a de-emphasised Delete account.

Every chevron row toasts "Edit — demo only" — each needs a real edit screen or inline sheet.
Add **Connected accounts** here for `supabase.auth.linkIdentity()` (see
[phase-04](phase-04-auth-onboarding.md) — Apple's Hide My Email means auto-linking won't fire).

**Delete account** promises a confirmation dialog that doesn't exist. It must be built, and it
must **anonymize rather than hard-delete**: `display_name := 'Deleted user'`, null the avatar,
UPI VPA and contact points, set `deleted_at`, revoke share links, delete device tokens and
receipts, then delete the `auth.users` row. Hard-deleting the profile would break every
counterparty's balance. Say so in the confirmation copy. Apple requires in-app account
deletion to work.

### Tip jar — `Hisaab Tip Jar.dc.html`

"Made free, on purpose." Presets ₹99/₹199/₹499 plus custom, one primary Send, and a visually
secondary Share Hisaab for people who can't tip but can spread the word. Preset/custom
selection logic is already real.

> ⚠️ **The design doc says non-consumable. That's wrong.** A non-consumable can be purchased
> once per Apple ID, so anyone who tips ₹99 could never tip again. These must be
> **consumables** — three products per store.

RevenueCat (`react-native-purchases`) covers App Store and Play behind one API. Receipts are
verified **server-side** by the `iap-verify` Edge Function against the App Store Server API and
Google Play Developer API — the client's word is never taken. Rows land in `tip_jar_purchases`.

Both stores take 15–30%, so ₹99 nets roughly ₹70–84.

The copy must never read as a plea — that's explicit in the design doc's voice guidance, and
it's the whole point of "Made free, on purpose".

### Help — `Hisaab Help.dc.html`

FAQ accordion (already real, single-open with animated height) plus a feedback textarea that
goes **straight to the developers, not a support queue** — writes to the `feedback` table.
Send validation already exists.

> ⚠️ FAQ #2 says "one currency per group", which contradicts the feature spec's per-expense
> override. Open question #2 — resolve, then fix whichever is wrong.

### About — `Hisaab About.dc.html`

Seal, name, philosophy, version (read from `expo-constants`, not hardcoded), links to Terms,
Privacy, Rate Hisaab, Tip jar. Terms and Privacy point at the GitHub Pages URLs from
`legal/`. Rate uses `expo-store-review`.

## Acceptance criteria

- Every sidebar row navigates
- Invite opens the real OS share sheet; the link opens the app and claims the placeholder
- ~~**No Contacts permission is requested anywhere in the app**~~ — **superseded 2026-07-26.**
  The contact PICKER was added: the OS draws the list, the app receives only the one contact
  the user selects, and `getAll()` is never called. The criterion that replaces it is narrower
  and still worth enforcing: **the address book is never enumerated, and contacts are never
  uploaded or checked against the server.** See `features/people/pickContact.ts`, and note
  that `legal/privacy.md` and `invite.tsx`'s on-screen copy moved in the same commit — those
  three have to stay in step or the app contradicts its own privacy policy.
- A sandbox tip completes on both stores and is verified server-side
- Delete account anonymizes and leaves counterparty balances intact
- Feedback lands in the `feedback` table

## Verification

Sandbox IAP on both stores. For deletion, create two accounts with shared expenses, delete
one, and confirm the other's balances are unchanged and the name reads "Deleted user".
