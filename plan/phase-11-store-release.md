# Phase 11 — Store release

**Status:** ⬜ not started · **Estimate:** 1.5 weeks · **Depends on:** Phase 10

## Goal

Ship to the App Store and Google Play.

## Prerequisites — start these early

| Item | Cost | Lead time |
|---|---|---|
| Apple Developer Program | $99/yr | Days to weeks (individual vs organization verification) |
| Google Play Developer | $25 one-time | ~48h, plus identity verification |
| Domain for Universal Links / App Links | ~$12/yr | Immediate |

Apple enrolment also gates Sign in with Apple in Phase 4, so it isn't really a Phase 11 item.

## 1. App identity

**Settled.** This was open question #1 — and it resolved by renaming the app rather than by
picking a display name around the collision. "Hisaab" was already three near-identical listings
("Hisaab: Split Group Expenses" on Play, "Hisaab: Split Bills & UPI" on the App Store, "The
Hisaab — Free Splitwise Alternative") with the same pitch, and "Barabar" was taken too. A search
turned up nothing for **Chukta**, which is what the seal has said all along: *hisaab chukta*,
settled, paid off.

The display name is still `APP_DISPLAY_NAME` in `app.config.ts` (defaulting to `Chukta`), so a
subtitle can be appended late without a code change. The bundle id `com.chukta.app` is fixed and
**cannot change once a listing exists** — it was changed during the rename precisely because that
window was still open.

Still to do: confirm the name is free in both consoles before creating the listings (D1).

## 2. Icons

`assets/brand/chukta-stamp.png` **cannot** be shipped as the icon as-is:

- It has an alpha channel; **iOS rejects icons with transparency**
- iOS applies its own rounded-square mask, so the source must be square and un-rounded
- The inner dotted ring (`dasharray 1.5 3.5`) disappears below ~120px

Needed: a flat opaque 1024×1024 master composited on `#0A0405`, plus an optically simplified
small-size variant with the dotted ring dropped and strokes thickened. Android additionally
needs adaptive icon foreground/background layers and a monochrome layer for themed icons.

## 3. Store listings

Screenshots at every required size for both stores (Home, Group detail, expense form, Settle
up, Tip jar are the strongest five). Description, keywords, category (Finance), age rating,
support URL, marketing URL.

## 4. Legal & compliance

- `legal/terms.md` and `legal/privacy.md` published via GitHub Pages for stable URLs. **These
  are drafts, not reviewed legal advice — get a lawyer's pass before submission**, especially
  on India's DPDP Act.
- ✅ **iOS privacy manifest** — done. Declared as `ios.privacyManifests` in `app.config.ts`
  rather than as a hand-written `PrivacyInfo.xcprivacy`, because `ios/` is gitignored and one
  `prebuild --clean` from vanishing. Expo's `PrivacyInfo` plugin generates the real file.
  Ten collected data types, all `Linked: true`, all `Tracking: false`, plus the four
  required-reason APIs (`CA92.1`, `C617.1`, `E174.1`, `35F9.1`).
- **Play data safety form** — same information, different format. **Still to do**, and it must
  match the manifest above answer for answer
- Account deletion must be reachable in-app (Apple requires it) — built in Phase 7
- Export compliance: standard HTTPS only

### Contacts — declare it, and declare it as *collected*

This bullet previously read *"there is no Contacts permission to declare, which removes the most
review-sensitive item from both forms."* **That is false**, and it was false in the direction that
produces a false declaration to two app stores rather than merely an out-of-date note. Both
permissions are requested:

| | Where |
|---|---|
| `NSContactsUsageDescription` | `app.config.ts:89` |
| `android.permission.READ_CONTACTS` | `app.config.ts:102` |

What the app actually does (`features/people/pickContact.ts`) is genuinely narrow, and the
narrowness is worth stating on the forms because it is unusual:

- The picker is **drawn by the OS** (`Contact.presentPicker()`). The app never sees the list.
- `getAll()` exists in `expo-contacts` and **is never called**. Nothing is enumerated.
- No address book is hashed and uploaded to ask the server "which of these people are users".
  That upload is what makes contact-matching a privacy problem, and it is the thing we do not do.
- On iOS 18+ the out-of-process picker needs no grant at all; the usage string covers older iOS
  and Android, where the system picker returns nothing without the permission.

**But the answer on the Data Safety form is still "collected", not merely "accessed".** The name
and the E.164-normalised phone number of the chosen contact are sent to the server and stored as
a placeholder profile plus a `kind='phone'` contact point (`upsert_contact_profile`). Reading only
one contact reduces the *volume*; it does not change the fact that contact data leaves the device
and is retained. Declaring "accessed but not collected" here would be the kind of inaccuracy that
gets an app pulled after it ships, which is far worse than answering plainly up front.

So: **Contacts → collected → Name, Phone number**, purpose *app functionality*, not shared with
third parties, not used for advertising or tracking, deletable via in-app account deletion. The
iOS privacy manifest needs the matching `NSPrivacyCollectedDataType` entries.

Full declaration set for both forms: **Contacts (name, phone), email address, name, avatar
image, UPI id, push token, and user-generated content** (expense descriptions, comments,
receipt images).

## 5. IAP review — **not for v1**

**v1 ships with tipping switched off, so there are no IAP products to submit and this section
does not apply to the first release.** Submitting products for a binary that cannot transact
would invite a rejection over a feature we deliberately are not shipping.

The reason it is cut is depth, not reluctance: what is missing is four dependencies deep and two
of them are other people's queues — paid store accounts → products created *and approved* (a
second review that can block the binary) → `react-native-purchases` (native, needs a rebuild) →
the **`iap-verify` Edge Function, which does not exist**. That last one is load-bearing: the
client holds **SELECT only** on `tip_jar_purchases` (`0020:182`) by design, because a client that
can insert a purchase row can claim to have paid without paying.

The current state is safe by construction — no key means `purchase()` throws a typed error and
the button stays disabled. **Footgun:** `isTipJarConfigured()` keys on the mere *presence* of
`EXPO_PUBLIC_REVENUECAT_KEY`, so setting it early enables the button and then throws at the user.
Do not set it until the whole chain above exists.

When tipping is added later it needs **no screen changes**. What applies then:

> Three **consumable** products per store at ₹99 / ₹199 / ₹499. Both stores review IAP separately
> from the binary and will reject a build whose products aren't approved and attached. Submit
> them early. Apple will ask what the tip unlocks; the honest answer — nothing, everything is
> already free — is acceptable, but the listing copy must be unambiguous so review doesn't read
> it as a donation (donations must use other methods; tips for the app itself must use IAP).

## 5b. Recurring expenses — also cut from v1

The **backend is built and scheduled**: `recurring_expense_rules`, `recurring_expense_runs`, and
`app.run_due_recurring_expenses()` running hourly under `pg_cron` (`0029`, `0030`). What does not
exist is any UI to create a rule, and that is a deliberate cut rather than an oversight.

Leaving the backend in place is harmless and was checked rather than assumed: with no rules, the
hourly job iterates an empty table and does nothing. It needs no store declaration, and the
composite `PRIMARY KEY (rule_id, run_on)` that makes the runner idempotent stays exercised by its
pgTAP tests, so it will not rot before the UI arrives.

## 6. Builds

```bash
eas build --platform all --profile production
eas submit --platform ios
eas submit --platform android
```

`eas.json` profiles: `development` (dev client), `preview` (internal distribution),
`production`. Configure EAS Update channels so OTA updates map to release channels.

Ship to TestFlight and Play internal testing first, with real users on real expenses for at
least a week before public release. A money app's first bad review is expensive.

## 7. Post-launch readiness

Sentry alerting configured before launch, not after. Supabase Pro ($25/mo) for point-in-time
backups — the free tier's backup story isn't good enough once real financial records exist.
Watch the `push_receipts` `DeviceNotRegistered` rate and the `mutation_log` conflict rate as
early health signals.

## Acceptance criteria

- Production builds pass App Store Connect and Play Console validation
- No privacy-manifest or data-safety warnings
- **Contacts declared as collected** (name, phone) on both forms — see §4
- Deep links open the app from a cold start on both platforms
- Crash-free sessions >99.5% across the internal testing week
- ~~IAP products approved and purchasable~~ — not v1; tipping ships off (§5)

## Verification

Full end-to-end on a TestFlight build and a Play internal-testing build, on physical devices,
with a real UPI payment handoff.
