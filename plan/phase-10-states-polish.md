# Phase 10 — The missing states & polish

**Status:** ⬜ not started · **Estimate:** 1.5 weeks · **Depends on:** Phases 5–9

## Goal

Everything the design pass never covered. This phase exists because of one finding worth
stating plainly: **across all 20 prototype files there is not a single empty state and not a
single error state.** A brand-new user currently has no designed experience at all.

## 1. Empty states — none exist

Every one of these needs designing and building:

| Surface | When |
|---|---|
| Home · Groups | First run, no groups |
| Home · People | First run, no people |
| Group detail | Group created, no expenses yet (the "plan a trip in advance" case the empty-group escape hatch exists for) |
| Person detail | Shared group, no shared expenses |
| Expense detail | No comments |
| Invite / Add friend | No search results |
| Picker | No groups and no people yet |
| Settle up | Everything already settled |
| Search | No matches, in all three search fields |

The first-run Home is the most important screen in the app for retention and it currently
doesn't exist. Voice per the design doc: dry, confident, a little funny, never corporate,
never apologetic.

## 2. Error states — none exist either

- Network unavailable (distinct from offline-with-cache, which is normal and shouldn't alarm)
- Save failed → retry, with the expense preserved
- **Invalid OTP** — the OTP screen has no invalid-code treatment at all
- Sign-in failed / cancelled
- Permission denied (403 from RLS — should be impossible, so it means a bug; log to Sentry)
- Conflict resolution sheet (from Phase 8)
- Upload failed
- IAP failed or cancelled
- Deleted-out-from-under-you: viewing an expense someone else just deleted

## 3. Loading states

The only real one anywhere is the `Done` screen's seal. Needed: skeletons for Home, Group and
Person lists (glass rows with a shimmer), inline spinners on buttons, and pull-to-refresh.

## 4. Undesigned screens still outstanding

Carried from earlier phases — build them here if not already done: group members / group
settings (`onMembers` in the Group prototype is bound to no element), edit profile, per-field
Settings editors, currency picker, date picker, "who paid" picker, recurring-expense setup.

## 5. Accessibility

- Every interactive element gets an `accessibilityLabel` and `accessibilityRole`; amounts read
  as "you owe one thousand four hundred and twenty rupees", not "₹1,420"
- Dynamic Type — the design uses fixed pixel sizes throughout; verify at 200% and fix overflow
- Contrast: `rgba(255,255,255,.3)` captions on glass are around 2.5:1 and **fail WCAG AA**.
  Several of the prototype's quieter greys will need lifting.
- 44×44pt minimum touch targets — several prototype chips are smaller
- Reduced motion kills ripple, blob drift and the seal animation
- VoiceOver / TalkBack pass over the whole add-expense flow

## 6. Android blur performance

The dedicated pass. `expo-blur`'s `dimezisBlurView` is expensive and Home renders 5+ glass
rows plus a segmented control plus a FAB simultaneously.

Measure on a real low-end device. If frames drop: cap concurrent blurred surfaces, drop blur
on list rows while scrolling, or ship the semi-opaque fallback on Android below a device
threshold. The `GlassSurface` switch from Phase 1 exists precisely so this is a config change,
not a refactor.

## 7. Copy pass

The prototype's toasts all say "demo only". Every string needs a real one in the app's voice.
Existing anchors: "Splits everything except chai sutta breaks", "चुकता", "EST. BETWEEN
FRIENDS", "Made free, on purpose", "Your account is open and the maths is now our problem",
"Goes directly to the people who built this, not a support queue".

Never guilt-driven — that's explicit for the tip jar and should hold everywhere.

## Acceptance criteria

- Every list has a designed empty state; a freshly created account is not a blank screen
- Every failure path shows something actionable, never a silent no-op
- All contrast ratios meet WCAG AA
- VoiceOver and TalkBack can complete: sign in → add expense → settle up
- 200% Dynamic Type doesn't clip or overlap anywhere
- Home holds 60fps while scrolling on the low-end Android target
- Zero "demo only" strings remain (`grep -r "demo only" apps/`)

## Verification

Physical low-end Android device for perf. Accessibility Inspector (iOS) and Accessibility
Scanner (Android). Create a fresh account and screenshot every empty state.
