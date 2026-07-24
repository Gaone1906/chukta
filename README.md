# Hisaab

Split shared expenses with friends. Track who owes whom, settle up through UPI, Venmo or
PayPal. **Every feature free, forever** — no tiers, no paywalls, no ads. The only monetization
is an optional one-time tip jar.

*Hisaab* (हिसाब, from *hisab-kitab*) means "accounts" or "reckoning".

## Status

Pre-alpha. Design is largely done; the app is being built phase by phase.
**[plan/PROGRESS.md](plan/PROGRESS.md) is the single source of truth for where things stand.**

## Getting started

```bash
npm install
npm run typecheck && npm run lint && npm run test
```

Run the app (needs a dev build — several native modules don't work in Expo Go):

```bash
npm run android
npm run ios
```

Browse the design prototypes:

```bash
npm run design-reference   # http://localhost:8080/screens/
```

Local database:

```bash
npm run db:start           # needs Docker
npm run db:reset
npm run db:types
```

## Layout

| Path | What |
|---|---|
| `apps/mobile/` | The Expo app. `modules/upi/` is a local native module for UPI app discovery. |
| `packages/core/` | Pure money logic — split allocation, debt simplification, FX, formatting. No React Native, no I/O, property-tested. |
| `supabase/` | Migrations, Edge Functions, pgTAP tests. |
| `design-reference/` | The original HTML prototypes and brand assets. Visual source of truth; nothing here ships. |
| `plan/` | One file per build phase, plus `PROGRESS.md`. |
| `docs/` | `design-doc.md` — product rationale, design system, screen inventory. |
| `legal/` | Terms and Privacy Policy drafts. |

## Stack

React Native + Expo (SDK 57) · TypeScript · expo-router · Supabase (Postgres, Auth, Realtime,
Storage, Edge Functions) · TanStack Query · Reanimated · RevenueCat · Expo Push.

Two decisions differ from `docs/design-doc.md`, deliberately:

- The doc specifies **iOS-native SwiftUI**; that can't produce an Android app, so this is
  React Native.
- The doc assumes **phone/OTP auth**; India requires TRAI DLT registration and a paid SMS
  provider, so v1 ships Apple + Google and keeps the phone screens flag-gated.

Full rationale and the rest of the decisions are in [plan/PROGRESS.md](plan/PROGRESS.md).

## A note on the money code

`packages/core` is separated from the app on purpose. Split allocation and debt simplification
are the places where a bug costs users real money, so they live as pure functions with
property-based tests asserting that shares always sum exactly to the total — across all five
split types, in every currency, including after FX conversion.

The design prototype rounded each share independently, which loses a rupee on a ₹100 three-way
split. That class of bug is what these tests exist to prevent.
