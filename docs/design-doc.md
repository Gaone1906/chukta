# Hisaab — Design Doc

This is the master reference for building Hisaab in Claude Code. It explains what
the app is, why it looks the way it does, every screen and what happens after it,
and the exact design system to build against. Pair this with the screen images and
HTML exports in `design-reference/`.

## What this app is

Hisaab is a Splitwise clone for iOS: split shared expenses with friends, track who
owes whom, settle up via UPI/Venmo/PayPal deep links. Every feature is free forever
— no gated tiers, no paywalled multi-currency, no ads. The only monetization is an
optional one-time tip jar. The pitch: everything Splitwise charges for, free,
because the people building this were tired of ad-filled apps charging for basic
features.

## How we got here (brief)

Naming went FreeSplit → ChaiSutta (dropped — trademark overlap with the real "Chai
Sutta Bar" franchise in India) → ChaiSplit → **Hisaab**, final. "Hisaab"
(hisab-kitab) means "accounts/reckoning" in Hindi/Urdu.

Visual direction went through a full pastel-glass exploration, then a premium
dark-metallic exploration (black+gold, black+bronze, etc.), then a fully
skeuomorphic fountain-pen/ledger-page direction with handwriting-reveal animations
and bahi-khata details (red thread binding, brass corners, a "श्री" mark, a "चुकता"
ink stamp) — **scrapped as the primary UI on usability grounds**, since handwritten
fonts and page-turn navigation risk real misreads in a finance app. The ledger-stamp
idea survives only as the logo/mark, not as functional UI. Final direction: dark
glassmorphism (Apple Liquid Glass style) in **Oxblood + Gold Leaf**.

---

## Design system

### Color tokens

| Token | Value | Usage |
|---|---|---|
| `bg-base` | `#0A0405` | App background |
| `bg-radial-glow` | radial gradient `#2A1216 → #0A0405` | Ambient depth behind every glass panel |
| `accent-primary` (oxblood) | `#7A2833` | Primary accent, borders, pending-balance text, secondary buttons |
| `accent-secondary` (gold leaf) | `#B8963C` | Primary buttons/CTAs, active states, settled badges |
| `text-highlight` | `#D9B25C` | Balances, high-emphasis numbers on dark glass |
| `glass-fill` | `rgba(255,255,255,0.05)` | Card/panel backgrounds |
| `glass-border` | `rgba(255,255,255,0.12)` | Card/panel borders |
| `glass-blur` | `blur(22–24px) saturate(130–140%)` | The signature glass effect — always paired with the radial glow and blurred color blobs behind it, never a flat dark background |
| `shadow-glass` | `0 8px 28–32px rgba(0,0,0,0.45)` | Depth under every glass panel |

**Dark mode only.** No light variant — this was an early open question, resolved in
favor of dark-only as the permanent direction, not a placeholder.

### Typography

- **Rozha One** (Devanagari-rooted serif display) — wordmark, logo lockup, and
  screen titles/headlines **only**.
- **Hind** (humanist sans, Indian Type Foundry) — all body text, labels, and
  critically **all balance/amount numbers**. This split exists specifically because
  handwritten/decorative fonts are bad at numbers — a misread amount is a real
  usability failure in a finance app, not just an aesthetic nitpick.
- Neither ships with iOS by default — both must be bundled as font files and
  registered in the app target.

### Logo / mark

A circular ink-stamp/wax-seal design with "HISAAB" set inside — an official-document
feel, like a stamp on a ledger. Two exports needed:
- **Transparent background version** — used in-app, layered over glass panels
- **Flat opaque 1024×1024 version, no transparency, no pre-rounded corners** — the
  actual App Store icon; iOS applies its own rounded-square mask automatically, and
  the App Store rejects icons with an alpha channel

The stamp is reserved for branding moments (logo, onboarding, the completion
screen). It is **not** reused as the "settled" indicator on list rows — that's a
separate, simpler gold-leaf checkmark badge, to keep the stamp special rather than
diluting it into a recurring UI element.

### Signature interaction: the ripple transition

Tapping the FAB (or a back chevron) triggers a gentle water-ripple-style transition:
a circular reveal expanding from the tap point, clearing the old screen to show the
new one. **Build note:** implement this as a circular reveal/clip-shape animation
(standard SwiftUI, `clipShape` + `GeometryReader`, easing the radius outward) — not
a literal Metal-shader water distortion. The latter looks more premium but is a
much heavier, iOS-17+-gated custom-shader build; the circular reveal reads as
"ripple" in spirit at a fraction of the cost. This transition is the **general
pattern for every screen change in the app**, not just the add-expense flow.

### Component patterns

- **Glass card** — `glass-fill` background, `glass-border`, `glass-blur`, rounded
  corners, `shadow-glass` beneath it, subtle inner highlight at the top edge to sell
  material thickness
- **Glass pill button** — same glass material as cards, gold-leaf tinted border on
  press state; primary actions are gold-leaf filled, secondary actions are outlined
  glass
- **Segmented switcher** (Home screen) — two labels side by side in one glass pill
  container; a smaller gold-leaf tinted rectangle sits behind whichever label is
  active and slides between them on tap
- **Split-type tabs** (add-expense form) — horizontal row of small glass pill tabs:
  Equal, Exact, Percentage, Shares, Itemized
- **Settled badge** — small gold-leaf checkmark badge, replaces a pending amount
  entirely on a list row when a balance is fully settled (not the stamp mark)
- **FAB** — circular glass button, gold-leaf accented, plus icon, floats above
  content with its own shadow

### Content voice

Dry, confident, a little funny, never corporate. Examples already locked in:
tagline "Splits everything except chai sutta breaks" (early direction, since
revised alongside the Hisaab rename), the "चुकता" (chukta/settled) concept,
"EST. BETWEEN FRIENDS," and the tip jar's "Made free, on purpose" framing. Error
and empty states should follow this same register — honest and plain, not
apologetic, never guilt-driven (especially on the tip jar, which explicitly
should never feel like a plea).

---

## Screen inventory & navigation flow

In build order. Every screen shares the design system above; only the differences
are called out per screen.

### Onboarding (linear flow)

1. **Entry** — app wordmark, stamp logo, tagline, three auth buttons: Continue with
   Apple / Google / phone number. First impression — the one screen allowed to be
   slightly more decorated than the rest.
2. **Phone number entry** — reached from "Continue with phone number." Country code
   + number field, "Send code" button (disabled until valid).
3. **OTP verification** — six-digit code entry, resend timer, "Verify" button.
4. **Profile setup** — name, optional photo, UPI ID (required — "so friends can pay
   you back directly"). "Get started" button.
5. **Success/completion** — loader resolving into the stamp settling into place,
   "You're all set" headline, "Go to your hisaab-kitaab" button → **Home**.

### Home (the hub)

Segmented switcher: **Groups ⇄ People**. List of glass rows below — group name or
person name, member count/avatar, and on the right either a pending balance in
oxblood or a gold-leaf checkmark badge if settled. Profile icon top-left opens the
**Sidebar**. FAB bottom-right opens the **add-expense flow**.

### Group detail

Reached by tapping a group row. Group name as title, member avatar stack, a glass
summary card (net balance + per-person breakdown + inline "Settle up"), then a
chronological list of expense rows. FAB here adds an expense directly to this group
(add-expense flow, group-context variant).

### Person detail

Reached by tapping a person row in the People tab (confirmed: **full screen, not an
inline expansion**). Combined net balance across every shared group, inline "Settle
up," then a list of the shared expenses that make up the balance — each tagged with
which group it came from (or untagged, if it's a one-off expense — see below).

### Add-expense flow (one shared form, three entry variants)

One underlying form — amount, description, date, who paid, split-type tabs
(Equal/Exact/Percentage/Shares/Itemized), live split preview, "Save expense" — with
three different entry paths into it:

- **From Home's FAB**: a "Who's this with?" picker first (search + mixed list of
  existing groups and individual people, multi-select for people), then the shared
  form. **Group creation is folded into this form**: an optional "name this group"
  field on the form itself — naming it promotes the participant set into a
  persistent group; leaving it blank keeps it a one-off expense between those
  people. There is no separate "Create group" screen for this path.
- **From a Group detail FAB**: skips the picker, goes straight to the form,
  pre-filled with the group's name and members.
- **From a Person detail FAB**: skips the picker, goes straight to the form,
  pre-filled to just the two of you.

All three share the ripple transition on open/back.

### Empty-group creation (built separately, outside this design pass)

A lightweight escape hatch for creating a named, empty group ahead of any expense
(e.g. planning a trip before spending starts) — exists because the add-expense
flow's group creation only fires once a first expense is logged, and some users
want the container set up in advance.

### Settle up

Reached from "Settle up" on Group detail, Person detail, or an expense-flow
context. Shows amount + direction (you owe / you're owed), a "Pay via" row of UPI
app icons handing off to the relevant app, and a quieter "Mark as settled" manual
option for payments made outside the app. Explicitly self-reported, not verified —
copy says so honestly.

### Sidebar

Slides in from the left over a dimmed Home screen. Profile summary at top, then:
**Tip jar**, Settings, Invite friends, Help and feedback, About Hisaab, and Sign out
near the bottom in a quieter treatment. (CSV/data export was considered and cut
from v1 scope — too niche for launch.)

### Add friend

Reached from a "+ Add someone new" affordance on the People tab. Search field,
contacts list with Invite/Add buttons depending on whether the contact is already
on Hisaab, and a note that invited friends can view a shared expense before
installing the app.

### Settings

Reached from the Sidebar. Grouped glass sections: Account (name, photo, UPI ID),
Notifications (toggles), Preferences (default currency). Quiet "Delete account"
link, de-emphasized.

### Tip jar

Reached from the Sidebar. The app's only monetization touchpoint. "Made free, on
purpose" headline, an honest explanation of the free-forever philosophy, preset
one-time amounts (₹99/₹199/₹499) + custom amount, a primary "Send tip" button, and
a visually secondary "Share Hisaab" action for people who can't tip but can spread
the word. One-time only, no subscription — stated explicitly at the bottom.

### Help and feedback

Reached from the Sidebar. FAQ accordion (4-5 common questions, short honest
answers), plus a direct feedback text area that goes straight to the developers,
not a support queue.

### About Hisaab

Reached from the Sidebar. Stamp mark, app name, one or two lines on the app's
philosophy, version number, links (Terms, Privacy, Rate Hisaab, Tip jar), and a
modest credit line.

---

## Feature spec (functional)

**Groups & members:** unlimited groups, add/remove members, optional group icon
(skipped for v1 — default icon/initials only, no picker), shareable links so
non-members can view an expense before signing up.

**Expenses:** description, amount, currency, date, payer(s), split type (Equal,
Exact, Percentage, Shares, Itemized), multi-payer support, recurring expenses,
receipt photo attachment (no OCR), comments, full edit/delete audit trail.

**Multi-currency:** any currency per expense, live FX rate locked at entry time
(free-tier API, cached, refreshed a few times a day — comfortably under any
rate-limit at this user scale), group-level default with per-expense override.

**Balances & settling:** simplified debt view (minimized transaction count),
per-person/per-group running balances, manual settlement recording, UPI deep-link
handoff (`upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR&tn=<note>`, detect
installed apps via `LSApplicationQueriesSchemes`, picker if multiple installed),
Venmo/PayPal deep links for non-Indian users. Self-reported settlement, not
processor-verified — no PSP/aggregator integration in scope.

**Sync, offline, notifications:** real-time cross-device sync, full offline
read/write with sync-on-reconnect, push notifications for new expenses/payments/
reminders.

**Account & data:** Sign in with Apple + email/password fallback, dark mode,
standard accessibility support. CSV export cut from v1.

**Monetization:** single tip-jar entry point, one-time preset + custom amounts via
Apple IAP (non-consumable), no subscription, no other monetization surface anywhere
in the app.

## Explicitly out of scope

- Any paid/"supporter" tier or feature gating of any kind
- Receipt OCR / auto-parsing
- In-app payment processing or payment confirmation webhooks (deep-link handoff
  only)
- Ads of any kind
- Analytics dashboards, custom themes, custom group icons, or other "premium"
  extras discussed and cut earlier
- CSV/data export (v1)

## Technical notes

- **Backend:** Supabase (Postgres + Auth + Realtime + Storage) — free tier
  comfortably covers ~1,000 users; Pro ($25/mo) mainly for backups/reliability, not
  a usage ceiling
- **Push:** Apple Push Notification service (APNs) — free
- **FX rates:** any free-tier currency API, cached client-side
- **Platform:** iOS native, SwiftUI recommended over UIKit
- **Fonts:** Rozha One and Hind must be bundled and registered — neither ships with
  iOS
- **Ripple transition:** circular reveal/clip-shape, not a shader-based distortion
- **Apple Developer Program:** $99/year, required for distribution, push, and Sign
  in with Apple

## Asset locations

```
design-reference/
  screens/       (HTML + PNG pairs per screen, numbered in build order)
  logo/          (hisaab-stamp-transparent.png, hisaab-app-icon-1024.png)
  tokens/        (this document)
```

Point Claude Code at the relevant screen's HTML for exact spacing/color/blur
values, the PNG for a quick visual check, and this document for context on why
things are the way they are — especially the sections on what was tried and
rejected, so it doesn't reintroduce the skeuomorphic ledger UI or a supporter tier.
