# Privacy Policy

**Effective:** 16 August 2026 · **Applies to:** the Chukta mobile app for iOS and Android

> ⚠️ Draft. Not reviewed legal advice. See `legal/README.md`.

Chukta is an expense-splitting app. It records who paid for what among friends so nobody has
to keep a mental tally. This policy explains what it stores, why, and what you can do about it.

Short version: we store what's needed to compute balances between you and the people you share
expenses with. There are no ads today, no analytics products, no data sales, and no third-party
trackers.

---

## 1. Who we are

Chukta is published by Pranav Yarasi. Contact: pranav.ccs5@gmail.com.

For users in India, the Grievance Officer under the Digital Personal Data Protection Act 2023
is Pranav Yarasi, reachable at pranav.ccs5@gmail.com.

## 2. What we collect

**You give us:**

| Data | Why | Required? |
|---|---|---|
| Name | So friends recognise you in a group | Yes |
| Email address (from Apple or Google sign-in) | Account identity and recovery | Yes |
| Profile photo | Display only | No |
| UPI ID / Venmo handle / PayPal link | Pre-fills payment apps so friends can pay you back | No |
| Expense details — description, amount, currency, date, participants, split | The core function of the app | Yes |
| Receipt photos | Your reference, attached to an expense | No |
| Comments on expenses | Shared with that expense's participants | No |
| Feedback you send | To read and reply | No |

If you sign in with Apple and use **Hide My Email**, we only ever receive Apple's relay
address. We never see your real one.

**Collected automatically:**

- A device push token, if you enable notifications
- Platform, app version and timezone, to deliver notifications at sensible hours
- Crash reports and error diagnostics via Sentry

**Contacts — read only what you pick.** If you choose "Choose from contacts" when adding
someone, your phone shows you its own contact picker and hands us the **one** contact you
select, so we can fill in their name and number. We never read, scan, upload or store your
address book, and we never check your contacts against our records to tell you who else uses
Chukta. You can add anyone by typing their name instead, which needs no permission at all.

**We do not collect:** your address book (see above — only the single contact you pick, and
only when you pick one), your location, your advertising identifier, your browsing activity,
or your bank or card details. Invitations still go through your device's own share sheet, so
we never see who you invited or how.

## 3. What we never touch

**Chukta does not process payments.** When you tap "Pay via", the app hands a pre-filled
request to your UPI, Venmo or PayPal app and stops there. Whether you actually pay, and what
happens inside that app, is between you and them. Nothing in Chukta is verified against a bank
or a payment processor — marking something settled is a self-reported note, and the app says so
where it matters.

We therefore never see or store card numbers, bank account numbers, UPI PINs, passwords, or
transaction confirmations.

## 4. Who can see your data

**People you share expenses with.** If you add an expense with someone, they can see its
description, amount, date, split, comments, receipt, and your name, photo and payment handles.
That is the point of the app. Nobody else can see it — enforced in the database, not just the
interface.

**Someone you've been added to before you sign up.** A friend can add you to an expense using
your name before you have an account. If you later sign up and that record matches you, it
becomes yours. You can review and leave any group.

**Service providers**, limited to what each needs to function:

| Provider | Purpose | Data |
|---|---|---|
| Supabase | Database, authentication, file storage | All app data |
| Expo (Expo Push Service) | Push notification delivery | Device token, notification text |
| Apple / Google | Sign-in, in-app purchases | Authentication identifiers, purchase receipts |
| Sentry | Crash reporting | Diagnostics, device model, app version |
| Frankfurter / European Central Bank | Currency rates | Nothing about you — we fetch rates, we send nothing |

**We never sell your data.** Chukta does not currently show advertising. If that changes, this
policy — and what we collect — will change accordingly, and we'll tell you first (Section 10).

**Legal disclosure:** we will disclose data if legally compelled, and will tell you unless
prohibited from doing so.

## 5. Where data is stored

On Supabase infrastructure, in Mumbai, India. Encrypted in transit (TLS) and at rest.

## 6. How long we keep it

Your data stays while your account is open. Delete your account and we anonymize your profile
immediately — your name becomes "Deleted user", and your photo, payment handles, email and
phone are erased.

**Expense records themselves are not deleted.** They are shared financial records: erasing your
side of a ₹4,320 dinner would silently corrupt the balances of everyone else who was there. We
keep the amounts and splits, detached from your identity. This is a deliberate design decision
and we'd rather be plain about it than surprise you.

Diagnostics are kept 90 days. Sync and notification logs, 30 days.

## 7. Your rights

You can, from inside the app:

- **See** everything about you — it's all on your own screens
- **Correct** your name, photo, and payment handles in Settings
- **Delete** your account in Settings, subject to section 6

To request a copy of your data in a portable format, or to object to processing, email
pranav.ccs5@gmail.com. We'll respond within 30 days.

If you're in India, you may also complain to the Data Protection Board. In the EEA/UK, to your
local supervisory authority.

## 8. Children

Chukta isn't intended for anyone under 13 (or the local minimum age). We don't knowingly
collect their data. If you believe a child has an account, email us and we'll remove it.

## 9. Security

TLS in transit, encryption at rest, row-level access control in the database so one group's
data is unreachable from another, and no passwords to steal — sign-in goes through Apple or
Google. Payment handles like a UPI ID are visible to people you share expenses with, by design,
since that's how they pay you back.

No system is perfectly secure. If you find a vulnerability, email pranav.ccs5@gmail.com; we'd rather
hear from you than not.

## 10. Changes

If we change this policy materially we'll notify you in the app before the change takes effect.
The current version is always at this URL, with its effective date at the top.

## 11. Contact

Pranav Yarasi · pranav.ccs5@gmail.com
