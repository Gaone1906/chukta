// Hand a batch of claimed notifications to Expo, and record what Expo said.
//
// Invoked by `internal.dispatch_notifications()` every 30 seconds via `net.http_post`. The
// database has already decided WHAT to send and marked those rows `sending`; this function's
// only job is the network call and writing back the outcome.
//
// ---------------------------------------------------------------- why Expo and not APNs
//
// The design doc said APNs. That predates the Android decision. Expo Push fans out to APNs
// *and* FCM behind one endpoint and one token format, which is the difference between one
// integration and two plus a pair of signing keys to rotate.
//
// ---------------------------------------------------------------- the two round trips
//
// Expo's send returns a TICKET, not a delivery outcome. Whether a token is dead
// (`DeviceNotRegistered`) only appears in the RECEIPT, fetched minutes later. A pipeline that
// only reads tickets keeps pushing to uninstalled apps forever, and that is what gets a sender
// throttled. So tickets are stored here and swept later.

import { createClient } from 'jsr:@supabase/supabase-js@2';

/** Expo's documented ceiling for one request. Exceeding it is rejected outright, not truncated. */
const EXPO_BATCH_LIMIT = 100;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface Message {
  queue_ids: number[];
  profile_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  tokens: string[];
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Every key the runtime will accept as "this is our own cron calling".
 *
 * ---------------------------------------------------------------- why this is a set
 *
 * This used to compare against `SUPABASE_SERVICE_ROLE_KEY` alone, and it returned 403 to fifteen
 * consecutive real dispatches. Nothing was misconfigured: the Vault secret was verified to be a
 * legacy JWT with `"role":"service_role"`, and the URL was right. Supabase is simply mid-migration
 * from the legacy `service_role` JWT to the `sb_secret_…` keys — the Edge Functions dashboard
 * already marks `SUPABASE_SERVICE_ROLE_KEY` DEPRECATED in favour of `SUPABASE_SECRET_KEYS` — so
 * the value the runtime injects and the value a human copies out of the dashboard can both be
 * legitimate and still not be the same string.
 *
 * Matching against every key the runtime knows about removes the coupling entirely. It is not
 * looser: each of these is a full-privilege key, so accepting any of them grants nothing that
 * accepting one did not.
 *
 * The failure mode this replaces is the expensive kind — a silent 403 that looks exactly like a
 * push-delivery problem, so it gets debugged in the notification pipeline rather than in auth.
 */
function acceptableKeys(): string[] {
  const keys = new Set<string>();

  /*
   * The one we control on both ends, and the only one that is actually reliable.
   *
   * Everything below is a key SUPABASE injects, and the whole point of this function's auth is
   * to recognise a caller whose token comes from OUR Vault. Those two things are only equal by
   * coincidence, and during Supabase's migration off legacy JWTs they stopped being equal:
   * fifteen dispatches were refused while the Vault secret was verifiably a `service_role` JWT
   * and the URL was correct. Matching a wider set of injected keys did not fix it either.
   *
   * `CHUKTA_DISPATCH_KEY` is a shared secret set as an Edge Function secret, holding the same
   * string as the `chukta_service_key` Vault entry. It cannot drift when Supabase renames or
   * re-formats anything, because nothing but us writes either copy.
   */
  const shared = Deno.env.get('CHUKTA_DISPATCH_KEY');
  if (shared) keys.add(shared);

  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) keys.add(legacy);

  // The replacement: a JSON dictionary rather than a bare string. Parsed defensively — a shape
  // change here must not take the whole dispatcher down with it.
  try {
    const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === 'string') keys.add(parsed);
      else if (Array.isArray(parsed)) for (const v of parsed) if (typeof v === 'string') keys.add(v);
      else if (parsed && typeof parsed === 'object') {
        for (const v of Object.values(parsed)) if (typeof v === 'string') keys.add(v);
      }
    }
  } catch {
    // Malformed: fall back to whatever else we have rather than refusing every caller.
  }

  return [...keys];
}

Deno.serve(async (req) => {
  // The caller is our own cron job carrying a service key. Anything else is refused before a
  // single push is sent — this endpoint can spend money and annoy users, so it is not open.
  const auth = req.headers.get('Authorization');
  const keys = acceptableKeys();
  const presented = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!presented || keys.length === 0 || !keys.includes(presented)) {
    return new Response('forbidden', { status: 403 });
  }

  /*
   * The DB client uses an INJECTED key, never the caller's and never the shared secret.
   *
   * Those are two different jobs. `CHUKTA_DISPATCH_KEY` exists to prove the caller is our cron;
   * it is not required to be a credential that can read the database, and after this change it
   * may deliberately be something that cannot. The client therefore takes whatever Supabase
   * provides — which is also the value guaranteed to still work after the legacy keys are
   * finally retired.
   */
  const dbKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
    keys.find((k) => k !== Deno.env.get('CHUKTA_DISPATCH_KEY'));

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, dbKey!);

  const { messages } = (await req.json()) as { messages: Message[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ sent: 0 });
  }

  /*
   * One Expo message per TOKEN, not per person.
   *
   * Somebody signed in on a phone and a tablet has two tokens and should be buzzed on both.
   * Keeping the queue-row ids alongside each lets the outcome be written back to the right
   * rows even though the batching below reorders nothing but flattens everything.
   */
  const flat = messages.flatMap((m) =>
    m.tokens.map((token) => ({
      queueIds: m.queue_ids,
      to: token,
      title: m.title,
      body: m.body,
      data: m.data,
      sound: 'default',
      // Expo collapses same-key notifications on the device itself, which is the last line of
      // defence behind the database's own coalescing.
      collapseId: String(m.data?.group_id ?? m.profile_id),
    })),
  );

  // A person with no registered device is not a failure — they simply have not opened the app
  // on a phone yet. Their rows are completed so they do not sit in `sending` until the sweep.
  const tokenless = messages.filter((m) => m.tokens.length === 0).flatMap((m) => m.queue_ids);
  if (tokenless.length > 0) {
    await supabase.rpc('complete_notifications', { p_ids: tokenless, p_error: null });
  }

  let sent = 0;

  for (let i = 0; i < flat.length; i += EXPO_BATCH_LIMIT) {
    const chunk = flat.slice(i, i + EXPO_BATCH_LIMIT);

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, deflate' },
        body: JSON.stringify(chunk.map(({ queueIds: _ignored, ...msg }) => msg)),
      });

      const payload = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = payload.data ?? [];

      for (let j = 0; j < chunk.length; j++) {
        const ticket = tickets[j];
        const item = chunk[j]!;

        if (ticket?.status === 'ok') {
          sent++;
          await supabase.rpc('complete_notifications', { p_ids: item.queueIds, p_error: null });
        } else {
          /*
           * `DeviceNotRegistered` can appear in the ticket too, when Expo already knows the
           * token is bad. Retire it immediately rather than waiting for the receipt sweep —
           * there is no reason to keep pushing to it for another fifteen minutes.
           */
          const code = ticket?.details?.error ?? 'unknown';
          if (code === 'DeviceNotRegistered') {
            await supabase.rpc('disable_push_token', { p_token: item.to, p_reason: code });
          }
          await supabase.rpc('complete_notifications', {
            p_ids: item.queueIds,
            p_error: ticket?.message ?? code,
          });
        }
      }
    } catch (e) {
      /*
       * Deliberately does NOT mark these rows failed.
       *
       * A fetch that threw means we never learned whether Expo accepted them, and marking them
       * failed would drop notifications that may well have been delivered. Left in `sending`,
       * they are swept back to `pending` after ten minutes by
       * `internal.requeue_stuck_notifications` and tried again — at most a duplicate, never a
       * silent loss. Same reasoning as the outbox drainer on the client.
       */
      console.error('expo push failed, leaving rows for the sweep:', e);
    }
  }

  return Response.json({ sent });
});
