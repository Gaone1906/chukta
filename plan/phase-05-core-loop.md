# Phase 5 — The core loop

**Status:** ⬜ not started · **Estimate:** 3 weeks · **Depends on:** Phases 1, 2, 3, 4

## Goal

The actual product: see your balances, add an expense, see the balance change. This is the
largest phase and it contains the one screen that has to be **designed** before it can be
built.

## Screens

| Screen | Reference | State |
|---|---|---|
| Home | `Hisaab Home.dc.html` | Designed. Tab switch + row taps already real in the prototype. |
| Group detail | `Hisaab Group.dc.html` | Designed, fully static |
| Person detail | `Hisaab Person.dc.html` | Designed, fully static. Full screen, not an inline expansion — confirmed in the design doc. |
| "Who's this with?" picker | `Hisaab Add Expense.dc.html` frame 1 | Designed, real multi-select |
| New group (empty) | Same file, `view === 'create'` | Designed but only as a sub-state — needs extracting into its own route |
| Expense form | `Hisaab Expense Form.dc.html` | Designed, most interactive screen in the set |
| **Expense detail** | **does not exist** | **Must be designed first** |
| **Edit expense** | **does not exist** | **Must be designed first** |

### The expense detail screen

Every expense row in Group and Person detail currently toasts "Expense detail — demo only."
There is no screen. The design doc never mentions one, but the feature spec promises comments,
receipt attachments, and a full edit/delete audit trail — all of which need somewhere to live.

Needs: description/amount/date/currency header · who paid (multi-payer aware) · the split
breakdown per person · receipt thumbnail → full viewer · comments thread · edit and delete ·
revision history ("Priya changed the amount from ₹4,320 to ₹4,500, 2 days ago").

Design it against the existing system before building — it's roughly a Group-detail summary
card plus a comment list, so it should compose from Phase 1 primitives.

## Work

### Home

Segmented switcher Groups ⇄ People over a list of glass rows. Data comes from a single
`app.get_home_summary()` call — one round trip returns both tabs plus balances. Profile button
top-left opens the Sidebar (Phase 7); FAB bottom-right opens the picker.

Row right-hand side: pending balance in oxblood, or a gold checkmark badge if settled. Amounts
use `@hisaab/core`'s `formatAmount` with `en-IN` grouping.

### Group and Person detail

Group: title, member avatar stack, glass summary card (net balance + per-person breakdown +
inline "Settle up"), then the chronological expense list. Note `onMembers` exists in the
prototype but is bound to no element — the members list/settings screen needs designing too.

Person: combined net balance across every shared group, inline "Settle up", then the shared
expenses that make up the balance, each tagged with which group it came from — or untagged if
it's a one-off. That tag is why `expenses.group_id` is nullable.

### The add-expense flow — one form, three entry points

The single most important interaction in the app.

- **From Home's FAB** → picker first (search + mixed list of groups and people, multi-select
  for people) → form. **Group creation is folded into the form**: an optional "name this
  group" field. Naming it promotes the participant set into a persistent group; leaving it
  blank keeps the expense a one-off. There is deliberately no separate "Create group" screen
  on this path.
- **From a Group FAB** → straight to the form, pre-filled with that group's name and members
- **From a Person FAB** → straight to the form, pre-filled to the two of you

All three open and close with the ripple transition.

The form: amount, description, date, who paid, split-type tabs
(Equal/Exact/Percentage/Shares/Itemized), live split preview, Save.

> ⚠️ The prototype's split preview uses **fabricated demo weight distributions** (Shares 2:1,
> Percentage 40/rest, Exact 1.4:1, Itemized alternating 1.25/0.75) and rounds each share
> independently, which loses money. Replace entirely with `@hisaab/core`'s allocator, and
> build the real per-person input UI for Exact/Percentage/Shares/Itemized — the prototype has
> no editable per-person fields at all. That UI is unbuilt and undesigned.

Date row and "who paid" row are both toast stubs in the prototype and need real pickers.

### Search

Three search inputs exist across the picker and Add friend; **none has an `onChange` handler**.
They're decorative. Wire them against `pg_trgm` on `profiles.display_name` and `groups.name`,
debounced, with a designed empty result state.

## Acceptance criteria

- Add an expense from each of the three entry points; balance updates correctly on Home,
  Group **and** Person
- All five split types produce shares that sum exactly to the total (spot-check ₹100 ÷ 3)
- Naming the group field creates a real group; leaving it blank creates a one-off that still
  appears on Person detail, untagged
- Multi-payer expense splits and settles correctly
- Edit an expense → the balance moves and a revision row appears
- Ripple transition fires on every screen change, both directions

## Verification

Maestro: `add-expense-from-home`, `add-expense-from-group`, `add-expense-from-person`, each
asserting the post-add balance on all three screens.
