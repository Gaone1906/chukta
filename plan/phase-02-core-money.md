# Phase 2 — `packages/core`, the money engine

**Status:** ⬜ not started · **Estimate:** 0.5 week · **Depends on:** Phase 0
**Can run in parallel with Phases 1 and 3.**

## Goal

Every calculation that decides who owes whom, as pure functions with no I/O, no React Native,
and exhaustive property tests. This is the one place in the codebase where a bug costs users
real money, so it is isolated and tested harder than anything else.

## The bug this phase exists to prevent

`design-reference/screens/Hisaab Expense Form.dc.html:214` computes each person's share as
`Math.round(amount * w[i] / total)`. A ₹100 three-way split renders ₹33 + ₹33 + ₹33 and
silently loses a rupee. Independently rounding each share **cannot** be made to sum to the
total; the allocation has to be done jointly.

## Work

### `src/money.ts`

`Money = { minor: bigint, currency: string }`. Never floats, never `number` for amounts.
Currency exponent comes from a table (INR/USD 2, JPY 0, KWD/BHD 3) and is **snapshotted onto
the expense row** by the backend, so a reference-data fix can't retroactively move a decimal
point on historical data.

### `src/split.ts` — the allocator

One function serves all five split types:

```ts
allocate(total: bigint, weights: number[], keys: string[]): bigint[]
```

**Largest-remainder (Hamilton) method:**

1. `W = Σ weights` (throw if 0)
2. `exact_i = total * weights_i / W` at full precision
3. `base_i = floor(exact_i)` — floor toward −∞, which stays correct for negative totals
4. `R = total − Σ base_i`, so `0 ≤ R < n`
5. Sort by `frac_i` desc, then `weights_i` desc, then `keys_i` ascending
6. Add one minor unit to the first `R` participants

Step 5's final key tiebreak is the important part: it makes the result **deterministic and
reproducible**, so the client's offline split preview matches the server's plpgsql
implementation byte for byte, and an outbox replay can't produce different numbers.

The five types differ only in the weight vector:

| Type | Weights | Validation |
|---|---|---|
| Equal | all 1 | n ≥ 1 |
| Shares | share counts | all > 0 |
| Percentage | the percentages | must sum to exactly 100 — reject otherwise, then allocate. Do **not** compute each share independently from its percentage. |
| Exact | n/a — user supplies minor units | must sum to the total; surface the leftover for assignment |
| Itemized | per-item allocation, then tax/tip/discount allocated pro-rata to each person's pre-tax subtotal, then summed | items + tax + tip − discount = total |

Itemized flattens down to plain per-person shares. Nothing downstream ever needs to know an
expense was itemized.

### `src/fx.ts`

Convert **once at the total level**, then allocate independently in each currency:

```
amountBase = roundHalfEven(amount × 10^(expBase − expExpense) × rate)
shares     = allocate(amount,     weights, keys)
sharesBase = allocate(amountBase, weights, keys)
```

Same weights and same tiebreak means both vectors sum exactly to their own totals *and* the
same person gets the rounding benefit in both. Converting each share individually would
reintroduce the sum≠total bug in the base currency — which is the currency balances are
computed in.

### `src/settle.ts` — debt simplification

Net balances per person (they sum to zero by construction), then:

1. **Exact cancellations first** — drop pairs that net to zero; match any debtor whose debt
   exactly equals some creditor's credit. These are the wins that preserve real relationships.
2. **Greedy max-cash-flow on the remainder** — repeatedly match the largest debtor with the
   largest creditor. Ties broken by key ascending for determinism.

At most n−1 transfers. Exact minimization is NP-hard (reduces to subset-sum), so greedy is
the right engineering answer — same as Splitwise.

### `src/format.ts`

`formatAmount(money, locale)` with **its own `en-IN` lakh/crore grouping**, not
`Intl.NumberFormat`. Hermes' `Intl` support differs between iOS and Android, and ₹12,480 vs
₹1,24,80,000 grouping is a stated design requirement (`hisaab-row.js` relies on it).

## Acceptance criteria

Property tests with `fast-check`, and these are the gate:

- ∀ total, weights, split type: `Σ allocate(...) === total`, exactly
- ∀ inputs: no share is negative
- Allocation is stable — same inputs always give the same output
- FX: both the expense-currency and base-currency vectors sum to their own totals
- Simplification preserves every person's net balance and emits ≤ n−1 transfers
- Percentages that don't sum to 100 are rejected, not silently normalised

Plus fixture tests mirroring the prototype's demo distributions so Phase 5's live split
preview can be checked against something.

## Verification

```bash
npm run test --workspace @hisaab/core
```

Later, in Phase 3, the same fixtures run against the plpgsql `app.allocate_minor` via pgTAP
and must produce identical output. Add that cross-check as soon as both exist.
