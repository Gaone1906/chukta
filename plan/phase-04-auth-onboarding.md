# Phase 4 — Auth & onboarding

**Status:** ⬜ not started · **Estimate:** 1 week · **Depends on:** Phases 1, 3

## Goal

Sign in, create a profile, land on Home. Five designed screens, all high fidelity, two of them
carrying real logic worth porting rather than rewriting.

> ⚠️ **Blocked on Apple Developer Program enrolment** for Sign in with Apple. Google sign-in
> and the whole rest of the flow work without it — build Google first, add Apple when the
> account is live.

## Screens

| Screen | Reference | Notes |
|---|---|---|
| Entry | `Hisaab Login.dc.html` | Seal at 212px, three auth buttons. The one screen allowed to be more decorated. Three tagline variants exist as a prop — pick one. |
| Phone | `Hisaab Phone.dc.html` | **Built but flag-gated off** — see below |
| OTP | `Hisaab OTP.dc.html` | **Built but flag-gated off** |
| Profile setup | `Hisaab Profile.dc.html` | Name, optional photo, UPI ID |
| Done | `Hisaab Done.dc.html` | Loading → settled seal, then "You're all set" |

## Work

### Auth

Native ID-token flows, **not** web OAuth redirects — they skip the browser round trip and
behave correctly in a dev client. Both require an `expo-dev-client` build; neither works in
Expo Go.

- `expo-apple-authentication` → `supabase.auth.signInWithIdToken({ provider: 'apple', token })`
- `@react-native-google-signin/google-signin` → same with `provider: 'google'`

> ⚠️ **Apple returns the user's real name only on the very first authorization.** Capture
> `fullName` on that first call and persist it immediately or it is gone forever and every
> later sign-in yields a nameless account. This is the single most common Sign-in-with-Apple
> bug. Write it down in the code.

App Store guideline 4.8 requires Sign in with Apple wherever another social login is offered —
we offer it, so we're compliant.

### Phone/OTP behind a flag

Both screens are fully designed and carry genuinely good logic — the OTP screen has
auto-advance, backspace-to-previous, arrow-key nav, six-digit paste distribution,
`autoComplete="one-time-code"`, and a live resend countdown. Port all of it. Then hide the
"Continue with phone number" button behind a build-time flag.

Turning it on later needs: TRAI DLT registration of sender ID and templates (weeks of
paperwork), an SMS provider (MSG91 handles Indian DLT; Twilio doesn't as cleanly), and
Supabase phone auth configured. None of that blocks v1.

The OTP screen has **no invalid-code error state** designed. Needs one — see Phase 10.

### Profile setup

Name (required, gates the CTA at >1 char — already implemented in the prototype), optional
photo, and UPI ID. The design doc calls UPI ID required ("so friends can pay you back
directly"); the prototype marks it *Optional*. **Optional is right** — a hard gate on the last
onboarding step for a field many users won't know offhand is a real drop-off risk, and Settle
up already handles a missing VPA gracefully. Prompt for it later, at first settle-up.

Photo picker is a toast stub in the prototype — needs `expo-image-picker` plus upload to the
`avatars` bucket.

### Placeholder claiming

After the Supabase session exists, call `app.claim_placeholder(token)` if the app was opened
from an invite deep link. Otherwise the `auth.users` insert trigger has already matched on
verified contact points and claimed any placeholder in place (see
[phase-03-backend.md](phase-03-backend.md) §1).

Test the case that matters: A invites B by link → B signs up → B's Home immediately shows the
expenses A already logged against them, with correct balances.

### Session & routing

`expo-router` route groups: `(auth)` and `(app)`, with a root layout that redirects on session
state. Session persisted via Supabase's storage adapter over MMKV, `autoRefreshToken` on, and
refresh paused when the app is backgrounded.

## Acceptance criteria

- Google sign-in → profile setup → Home, on a real device, both platforms
- Apple sign-in captures and persists `fullName` on first authorization
- Killing and relaunching the app restores the session without a sign-in prompt
- An invited placeholder's history appears intact after signup
- Phone button is absent when the flag is off; the screens still build and typecheck

## Verification

Maestro flow `signin-google → profile → home`. Manually verify Apple first-authorization name
capture by deleting the app's Apple ID authorization in Settings and re-running (that's the
only way to get a genuine "first" authorization again).
