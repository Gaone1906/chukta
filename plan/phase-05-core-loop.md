# Phase 5 — The core loop

**Status:** ✅ done, 2026-07-25 · **Estimate:** 3 weeks · **Depends on:** Phases 1–4 (all done)

Every acceptance criterion below was checked on the Android emulator against local Supabase
with the dev seed — see `plan/PROGRESS.md` for what was verified and what it exposed.

The actual product: see your balances, add an expense, watch the balance move. Largest phase,
and it contains the one screen that must be **designed** before it can be built.

Built in full — not a thin slice. Confirmed with the user.

---

## Chunks

Each is independently committable and independently verifiable on the emulator. Work them in
order; later ones assume earlier ones.

### 5A — Data layer

**Goal:** every screen reads through one typed, cached path. No screen touches `supabase`
directly.

- `@tanstack/react-query` + a `QueryClientProvider` in the root layout.
- `src/lib/api.ts` — thin typed wrappers over the RPCs built in Phase 3:
  `getHomeSummary`, `getGroupDetail`, `getPersonDetail`, `simplifyGroupDebts`,
  `createExpense`, `updateExpense`, `deleteExpense`, `recordSettlement`,
  `upsertContactProfile`.
- `src/lib/queryKeys.ts` — one place, so invalidation after a mutation is not guesswork.
- Every mutation generates a `client_mutation_id` (uuid) up front. The RPCs are idempotent on
  it; this is what makes a retry safe and is the seam Phase 8's outbox plugs into.
- A shared error shape. `P0409` is the conflict code and must be distinguishable from a
  generic failure — Phase 8 depends on that.

**Done when:** Home renders from `get_home_summary` against local Supabase with seeded data.

### 5B — Seed data

**Goal:** something to look at, and a repeatable fixture for every later chunk.

- `supabase/seed.sql` — a handful of profiles, two groups, one-off expenses, a settled
  balance and an unsettled one, mirroring the names in the prototypes (Goa finally, Flat 302,
  Priya, Arjun, Meher). Applied automatically by `supabase db reset`.
- Must produce at least one **settled** row and one **placeholder** participant, so those
  states are visible without hand-crafting them each time.

### 5C — Home

Reference: `design-reference/screens/Hisaab Home.dc.html`

- Segmented switcher Groups ⇄ People (component exists from Phase 1).
- Rows from `get_home_summary`, amounts via `@hisaab/core` `formatAmount`.
- Profile button → Sidebar (Phase 7 stub for now). FAB → picker.
- **Empty states** — none exist in the design set. A brand-new account currently has no
  designed experience at all; write one for both tabs.
- Pull to refresh; skeleton rows while loading.

### 5D — Group detail

Reference: `Hisaab Group.dc.html`

- Header, member avatar stack, glass summary card with the per-person breakdown, inline
  Settle up (screen itself is Phase 6).
- Chronological expense list, paginated via `get_group_detail(p_before)`.
- FAB → expense form pre-filled with this group.
- `onMembers` exists in the prototype but is bound to nothing — the members/settings screen
  needs designing. Stub it visibly rather than silently.

### 5E — Person detail

Reference: `Hisaab Person.dc.html`

- Combined balance across every shared group, plus the per-group breakdown from
  `get_person_detail`.
- Shared expense list, each row tagged with its group — or untagged when it is a one-off.
  That tag is exactly why `expenses.group_id` is nullable.
- FAB → expense form pre-filled to the two of you.

### 5F — Add-expense: the picker

Reference: `Hisaab Add Expense.dc.html` (frame 1, plus the `view === 'create'` sub-state)

- Search + mixed list of groups and loose people, multi-select for people, mutually exclusive
  with picking a group.
- "+ New group" — the empty-group escape hatch. Exists only as a sub-state inside that
  prototype file; extract it into its own route.
- Search must actually work — all three search inputs in the design set are decorative.

### 5G — Add-expense: the form

Reference: `Hisaab Expense Form.dc.html` — the most interactive screen in the set.

- Amount, description, date, who paid, split-type tabs, live preview, Save.
- **All five split types with real per-person inputs.** The prototype has no editable
  per-person fields at all and fabricates its distributions; this is new UI, not a port.
- Preview computed by `@hisaab/core` `computeShares` — the same function the server mirrors.
- The optional "name this group" field: naming it promotes the participant set into a group,
  leaving it blank keeps a one-off. `create_expense` takes `new_group` for exactly this.
- Date picker and payer picker are toast stubs in the prototype — both need building.
- Three entry points (Home FAB → picker → form; Group FAB; Person FAB), one form.

### 5H — Expense detail, edit, delete

**No design exists. Design it first**, composed from Phase 1 primitives.

Every expense row in Group and Person detail currently leads nowhere — this is the biggest
hole in the design set.

- Header, who paid (multi-payer aware), per-person split breakdown.
- Comments (`add_comment`), receipt thumbnail, revision history from `expense_revisions`.
- Edit → the form, prefilled, calling `update_expense` with `expected_revision`.
- Delete → confirm, then `delete_expense`.
- **Conflict UI**: on `P0409`, show a field-level diff against the server snapshot carried in
  the error DETAIL. Never auto-merge.

### 5I — Ripple navigation

Replace the placeholder Stack in `(app)/_layout.tsx` with the ripple transition. Origin comes
from the tap point — `FAB` already reports it. Must respect `getGlassBackend()`.

### 5J — Verification pass

On the emulator, with seeded data:

- Add an expense from **each of the three entry points**; confirm the balance moves correctly
  on Home, Group **and** Person.
- ₹100 split three ways sums to exactly ₹100 (the prototype's bug).
- Edit an expense → balance moves, revision recorded.
- A stale `expected_revision` surfaces the conflict sheet rather than overwriting.
- Naming the group field creates a real group; leaving it blank creates a one-off that still
  appears on Person detail, untagged.
- Screenshot each screen against the prototype.

---

## Acceptance criteria

- All five split types produce shares summing exactly to the total.
- The three entry points share one form and one code path.
- No screen calls `supabase` directly; everything goes through `src/lib/api.ts`.
- Every list has a designed empty state.
- Balances agree between Home, Group detail and Person detail — they are all derived from the
  same views, so a disagreement means a caching bug.
