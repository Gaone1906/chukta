import { supabase } from '@/lib/supabase';
import { translateError } from '@/lib/errors';

/**
 * The tip jar's purchase layer — the seam where RevenueCat will plug in.
 *
 * Nothing here talks to a store yet, and that is a deliberate stopping point rather than a
 * stub left by accident. Buying anything requires products configured in App Store Connect and
 * Play Console, which require paid developer accounts, which do not exist yet (PROGRESS.md,
 * "Outstanding, blocked on the user"). `react-native-purchases` is also a native module, so it
 * cannot be added without a rebuild.
 *
 * What is real: the product definitions, the "have I tipped before" read, and the shape the
 * screen calls. When the accounts exist, `isTipJarConfigured` starts returning true and
 * `purchase()` gets a body — no screen changes.
 *
 * ## The rule that must not be relaxed later
 *
 * The client NEVER writes `tip_jar_purchases`. It has SELECT and nothing else (0020), because
 * a client that can insert a purchase row can claim to have paid without paying. The receipt
 * goes to the `iap-verify` Edge Function, which holds the service key, checks it against the
 * App Store Server API or the Google Play Developer API, and writes the row itself.
 */

export interface TipProduct {
  /** The store product identifier. Same string in both stores, to keep the mapping trivial. */
  id: string;
  amountMinor: bigint;
}

/**
 * Consumables, not non-consumables — a non-consumable can be bought once per account, ever,
 * which would let someone tip exactly one time. See the note in (app)/tip.tsx.
 */
export function tipProducts(): TipProduct[] {
  return [
    { id: 'tip_99', amountMinor: 9900n },
    { id: 'tip_199', amountMinor: 19900n },
    { id: 'tip_499', amountMinor: 49900n },
  ];
}

/** True once the store products and the RevenueCat key are actually wired up. */
export function isTipJarConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_REVENUECAT_KEY);
}

export interface Tip {
  id: string;
  amountMinor: bigint;
  purchasedAt: string;
}

/** Tips this account has already made. Read-only — see the note above about who writes here. */
export async function getMyTips(): Promise<Tip[]> {
  const { data, error } = await supabase
    .from('tip_jar_purchases')
    .select('id, amount_minor, purchased_at')
    .order('purchased_at', { ascending: false });

  if (error) throw translateError(error);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    // bigint, as a string across the wire — same rule as every other amount in this app.
    amountMinor: BigInt(String(row.amount_minor)),
    purchasedAt: String(row.purchased_at),
  }));
}
