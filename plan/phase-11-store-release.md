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

> ⚠️ **Open question #1.** "Hisaab" already exists on the stores, so the display name needs
> deciding. It's a variable (`APP_DISPLAY_NAME` in `app.config.ts`) precisely so this can be
> settled late. The bundle id `club.uni.hisaab` is already fixed and doesn't need to match the
> display name.

Check availability on both stores before committing.

## 2. Icons

`assets/brand/hisaab-stamp.png` **cannot** be shipped as the icon as-is:

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
- **iOS privacy manifest** (`PrivacyInfo.xcprivacy`) declaring collected data types and any
  required-reason APIs used by dependencies
- **Play data safety form** — same information, different format
- Because invites go through the OS share sheet, there is **no Contacts permission to
  declare**, which removes the most review-sensitive item from both forms
- Account deletion must be reachable in-app (Apple requires it) — built in Phase 7
- Export compliance: standard HTTPS only

## 5. IAP review

Three **consumable** products per store at ₹99 / ₹199 / ₹499. Both stores review IAP
separately from the binary and will reject a build whose products aren't approved and
attached. Submit them early.

Apple will ask what the tip unlocks. The honest answer — nothing, everything is already free —
is acceptable, but the listing copy should be unambiguous so review doesn't read it as a
donation (donations must use other methods, tips for the app itself must use IAP).

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
- IAP products approved and purchasable in production
- Deep links open the app from a cold start on both platforms
- Crash-free sessions >99.5% across the internal testing week

## Verification

Full end-to-end on a TestFlight build and a Play internal-testing build, on physical devices,
with a real UPI payment handoff.
