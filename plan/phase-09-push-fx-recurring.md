# Phase 9 — Push, FX, recurring & receipts

**Status:** ⬜ not started · **Estimate:** 1.5 weeks · **Depends on:** Phases 3, 8

## Goal

The four background features from the feature spec. Grouped because they're all
`pg_cron` + Edge Function shaped and share the same plumbing.

## Push notifications

**Pipeline:** write RPC appends `change_events` (same transaction) → `AFTER INSERT` trigger
enqueues `internal.notification_queue` with `not_before = now() + 45s` → `pg_cron` every 30s
calls `net.http_post` → `push-dispatch` Edge Function batches ≤100 messages per Expo Push API
call → tickets stored in `push_receipts` → a second job 15 minutes later fetches receipts and
disables tokens returning `DeviceNotRegistered`.

**Expo Push Service, not raw APNs.** The design doc says APNs — that predates the Android
decision. Expo fans out to APNs *and* FCM behind one API and one token format.

**Never call an HTTP endpoint inside the mutation transaction.** The queue is what makes
coalescing possible at all, and it means a push outage can't fail an expense write.

### What notifies

| Event | Recipients |
|---|---|
| Expense created | all participants except the actor |
| Expense edited **where your own share changed** | affected participants only — diff `share_base_minor` across revisions, so a typo fix notifies nobody |
| Expense deleted | all participants |
| Settlement recorded naming you | the counterparty |
| Comment | participants + prior commenters |
| Added to a group | the new member |
| Manual nudge | the debtor, max 1 per pair per 24h |
| Recurring expense auto-posted | participants |
| Weekly digest | opt-in, Sunday, per-timezone |

### Storm avoidance — five mechanisms

1. **Coalescing.** `coalesce_key` (e.g. `group:{id}:expense_added`) + 45s delay; the drainer
   collapses N rows into *"Priya added 4 expenses to Goa, finally."* Someone entering a trip's
   receipts in one sitting produces one push, not eleven.
2. **Edit debounce** — same expense id, 5-minute window.
3. **Rate limits** — max 1 per (profile, group) per 60s, ~20/hour/profile; overflow rolls into
   a digest rather than being dropped.
4. **Never notify the actor** — enforced in the enqueue trigger, not the dispatcher.
5. **Prefs + quiet hours** — `notification_prefs` gates by category, matching the three
   Settings toggles; quiet-hours pushes defer to the next morning in the recipient's timezone.

Profile merges emit **one** event per affected recipient, never one per repointed row — the
single most likely storm source in the schema.

## FX rates

**Frankfurter** (`api.frankfurter.dev`) primary — ECB data, no API key, free, unmetered — with
`open.er-api.com` as fallback for currencies ECB doesn't publish. Keyless means no secret to
rotate and no free-tier cliff.

Daily granularity is correct: nobody splitting a dinner needs intraday FX.

`pg_cron` at `0 2,8,14,20 * * *` → `fx-refresh` Edge Function → upsert `fx_rates`, keyed
`(base, quote, as_of)`. One base (USD) per fetch; cross rates derived as
`rate(A→B) = rate(USD→B) / rate(USD→A)`. History retained permanently — a few thousand rows a
year, and it makes any locked rate auditable years later. Four runs a day against a
once-daily source is deliberate headroom so one failed fetch never leaves rates stale.

**Locking at entry.** The client keeps a snapshot refreshed on app foreground and shows the
conversion live in the form, so offline entry matches what the user saw. `create_expense` may
include a proposed rate; the server accepts it **only within ±2% of its own latest**, otherwise
substitutes and returns the correction so the UI can say "rate updated to ₹83.12/$". Then
`fx_rate`, `fx_rate_as_of`, `fx_rate_source` and `amount_base_minor` are written onto the
expense and **never recomputed** — editing the description keeps the original rate. Bounding
the client-proposed rate caps any abuse at noise level while keeping offline entry honest.

## Recurring expenses

`recurring_expense_rules` (template jsonb + frequency + interval + timezone + `next_run_on`)
and `recurring_expense_runs` with `PRIMARY KEY (rule_id, run_on)` — **that composite key is the
idempotency guard**; without it a cron retry double-posts rent.

`app.run_due_recurring_expenses()` hourly under `pg_cron`, evaluating each rule against its own
timezone so "1st of the month" fires at local midnight, and clamping
`day_of_month = least(day_of_month, days_in_month)` so a 31st rule survives February.

The setup UI is **undesigned** — needs designing before building.

## Receipts

`expo-image-picker` (camera + library) → resize/compress client-side → upload to the private
`receipts` bucket at `receipts/{expense_id}/{uuid}.jpg` → row in `expense_attachments`. Storage
policy gates on `auth_ext.can_read_expense`. Viewer with pinch-zoom on the expense detail
screen.

**No OCR** — explicitly out of scope.

## Acceptance criteria

- Push arrives on both platforms for an expense added by another user
- Eleven expenses added in one sitting produce **one** coalesced notification
- Editing only an expense's description notifies nobody
- Quiet hours defer correctly across timezones
- A foreign-currency expense locks its rate; editing the description doesn't change it
- A monthly rule on the 31st fires on 28 Feb, once, even if cron retries
- Receipt uploads, and a non-participant gets 403 on the storage path

## Verification

```bash
supabase functions serve      # local Edge Function testing
select cron.schedule(...)     # verify jobs registered after db reset
```

Push needs physical devices — simulators can't receive APNs.
