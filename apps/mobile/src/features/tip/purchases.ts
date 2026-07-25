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

/**
 * Buy one tip.
 *
 * This export is the thing the header above has been describing all along and which did not
 * actually exist — `tip.tsx` never called it, so even with a RevenueCat key set the Send button
 * toasted "not yet". Both halves of that are fixed: this throws a typed, honest error until the
 * store is wired, and the screen now branches on `isTipJarConfigured()` and calls it.
 *
 * When RevenueCat lands, the body becomes `Purchases.purchaseStoreProduct(...)` and the receipt
 * goes to the `iap-verify` Edge Function. **The client still never writes `tip_jar_purchases`**
 * — see the rule above, which does not relax when this gets a real implementation.
 */
export class TipUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TipUnavailableError';
  }
}

export async function purchase(productId: string): Promise<void> {
  if (!isTipJarConfigured()) {
    throw new TipUnavailableError(
      "Tips go through the App Store and Play, and Hisaab isn't on either one yet.",
    );
  }

  // Deliberately not a silent no-op. If the key is set but this is still unimplemented, the
  // loudest possible failure is the one that gets it finished before anyone is charged.
  throw new TipUnavailableError(
    `The store key is set but the purchase flow is not wired up yet (${productId}).`,
  );
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
