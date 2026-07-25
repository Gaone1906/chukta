# Phase 6 — Settle up & the UPI handoff

**Status:** ✅ built, 2026-07-25 · device verification outstanding · **Estimate:** 1 week · **Depends on:** Phase 5

**Done:** the UPI URI builder in `packages/core/src/upi.ts` (property-tested), the Settle up
screen at `(app)/settle.tsx`, the QR fallback, iOS per-scheme detection, the Android system
chooser, and `record_settlement` wired from both Person and Group detail. Verified on the
emulator: ₹1,350 marked settled flips the pair to All square.

**6C also done:** `modules/upi/` (Kotlin + Swift) and `plugins/withUpiQueries.js`. Verified on
the emulator that the `<queries>` block reaches the built manifest, the module registers
(`hasNativeUpi === true`) and `listUpiApps()` runs and returns zero — correct there, since the
emulator has no UPI apps.

**Left — needs a physical Android device with GPay/PhonePe installed:**
- the picker lists them with their real labels and icons
- launching lands on a payment screen with amount, VPA and note prefilled
- the QR scans from a second phone

Nothing in this phase can close those; the emulator cannot install a UPI app and the iOS
Simulator cannot answer `canOpenURL` for apps it does not have.

## Goal

Hand a payment off to the user's UPI app with the amount and payee prefilled, and record the
settlement. Settlement is **self-reported, never verified** — no PSP, no webhooks, no payment
confirmation. The copy says so honestly, and that's a product decision, not a limitation to
apologise for.

Reference: `design-reference/screens/Hisaab Settle Up.dc.html`.

## The honest state of UPI deep links

Works well on Android. Unreliable on iOS. Both need a fallback.

**The URI** (NPCI UPI Intent spec) is identical everywhere:

```
upi://pay?pa=<payee VPA>&pn=<payee name>&am=<1420.00>&cu=INR&tn=<note>&tr=<ref>
```

`pa` is the **counterparty's** `upi_vpa` — which is why profile setup collects it. If they
haven't set one, the screen says "Priya hasn't added a UPI ID yet" and offers Mark as settled.
`am` must be a plain decimal string ("1420.00"). Keep `tn` short — several apps truncate
around 50 characters.

### Android — fully supported

`upi://pay` is a real system-level intent that every UPI app registers for.

**Android 11+ requires a `<queries>` block** declaring the `upi` scheme in the manifest, or
package visibility silently returns nothing and every app looks uninstalled. This is the #1
reason UPI integrations break on modern Android.

Two modes:
- *System chooser* — `Linking.openURL('upi://pay?…')` gives Android's own UPI picker. Zero
  native code; ship this first if time is tight.
- *Our own picker* (what the design draws) — needs per-package targeting, which `Linking`
  can't do.

### iOS — the hard truth

NPCI's UPI Intent spec is **Android-only**. iOS has no `upi://` system handler. Each app
registers its own scheme (`gpay://`, `phonepe://`, `paytmmp://`, `bhim://`) and their support
for prefilled payment parameters is undocumented and historically flaky.

What we do: declare each scheme in `LSApplicationQueriesSchemes` (already in `app.config.ts` —
iOS caps this list at 50 entries), use `canOpenURL` to show only installed apps, attempt the
deep link, and **always** offer the fallback.

### The fallback that always works

Render the same `upi://pay?…` string as a **QR code**, plus "Copy UPI ID" and "Copy amount".
Any UPI app scans it from the screen or from a saved image. This is what most iOS apps in this
category actually do, and it also rescues the Android case where a bank app ignores the intent.

## Work

### `apps/mobile/modules/upi/` — a local Expo native module

```ts
listUpiApps(): Promise<{ id: string; label: string; iconBase64?: string }[]>
payViaUpi(appId: string, uri: string): Promise<void>
```

- **Android** (~150 lines Kotlin): `queryIntentActivities` on an `ACTION_VIEW` intent for
  `upi://pay`, returning each app's real label and icon, then
  `startActivity` with the resolved package.
- **iOS** (~60 lines Swift): the `canOpenURL` subset of known schemes, then `openURL`.

Written rather than pulled from npm because every available package is stale and predates
Android 11 package visibility.

Using each app's **own queried icon** also avoids bundling GPay/PhonePe/Paytm trademarks —
which is what the design's three empty `<image-slot>` placeholders would otherwise require.

### Config plugin

An Expo config plugin adding the Android `<queries>` block. The iOS
`LSApplicationQueriesSchemes` entries are already declared in `app.config.ts`.

### Screen

Amount (editable, defaults to the outstanding balance), direction (you owe / you're owed),
context line ("Across 3 shared groups · Weekend trip, Flat 302, Sunday football"), the Pay via
row, then a quieter "Mark as settled instead" for payments made outside the app.

Recording calls `app.record_settlement`. Settling from Group detail sets `group_id`; settling
from Person detail leaves it null and reduces the overall pair balance.

Optionally notify the counterparty to confirm ("Priya says she paid you ₹1,420 — confirm?"),
which is the honest version of self-reporting. `settlements.confirmed_by_profile_id` supports
it.

### Non-Indian users

Venmo: `venmo://paycharge?txn=pay&recipients=<user>&amount=<n>&note=<s>`
PayPal: `https://paypal.me/<user>/<amount>`

Same pattern, same fallback. No App Store issue — person-to-person real-money transfer is
explicitly outside the IAP rules.

## Acceptance criteria

- Physical Android device with GPay and PhonePe installed: picker lists both with real icons;
  launching lands on a payment screen with amount, VPA and note prefilled
- Android 11+ package visibility verified (the `<queries>` block actually present in the built
  manifest, not just the config)
- iOS: installed-app detection works; QR fallback scans correctly from a second phone
- Counterparty with no UPI ID degrades to Mark as settled with honest copy
- Recorded settlement moves the balance and appears in history

## Verification

Must be tested on **physical devices** — the Android emulator has no UPI apps, and the iOS
Simulator can't test `canOpenURL` against apps it doesn't have.
