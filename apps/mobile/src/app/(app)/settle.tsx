import {
  buildUpiUri,
  formatAmount,
  isValidVpa,
  money,
  parseAmount,
  settlementNote,
  toAmountInput,
} from '@chukta/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton, GlassSurface, Toast, color, font, radius } from '@/design';
import { useSession } from '@/features/auth/session';
import { toISODate } from '@/features/expenses/DateSheet';
import { FOOTER_CLEARANCE, FooterBar } from '@/features/expenses/FooterBar';
import { ScreenHeader } from '@/features/expenses/ScreenHeader';
import { EmptyState } from '@/features/home/EmptyState';
import { RowSkeleton } from '@/features/home/RowSkeleton';
import { Avatar } from '@/features/people/Avatar';
import { QrCode, type QrHandle } from '@/features/settle/QrCode';
import { qrSaveAvailable, saveQrToPhotos } from '@/features/settle/saveQr';
import { discoverUpiApps, openUpiPayment, type UpiApp } from '@/features/settle/upiApps';
import { getPersonDetail, newMutationId } from '@/lib/api';
import { useOffline } from '@/lib/offline/OfflineProvider';
import { queueSettlement } from '@/lib/offline/writes';
import { afterExpenseChange, queryKeys } from '@/lib/queryKeys';

/**
 * Settle up.
 *
 * Ported from design-reference/screens/Hisaab Settle Up.dc.html.
 *
 * The whole screen rests on one honest fact, which the copy says out loud rather than hiding:
 * **nothing here verifies a payment**. There is no PSP and no webhook. We hand the amount and
 * the payee to the user's own UPI app, and then we take their word for it. Pretending
 * otherwise would be the single most damaging thing this app could do.
 *
 *   /settle?profileId=…            settle everything outstanding with one person
 *   /settle?profileId=…&groupId=…  settle only what is outstanding inside one group
 */
export default function SettleUp() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const offline = useOffline();
  const { profile } = useSession();
  const { profileId, groupId, groupName } = useLocalSearchParams<{
    profileId?: string;
    groupId?: string;
    groupName?: string;
  }>();

  // Null means "the user has not touched it", so the field shows the outstanding balance.
  // Storing the default in state and syncing it with an effect would fight anyone paying only
  // part of what they owe, every time the balance refetched.
  const [typedAmount, setTypedAmount] = useState<string | null>(null);
  const [apps, setApps] = useState<UpiApp[]>([]);
  const [nativePicker, setNativePicker] = useState(false);
  const [showQr, setShowQr] = useState(false);

  /*
   * One ref per QR, because the two are never on screen together — the paying code lives in the
   * `iOwe` branch and the receiving code in the other, so a single shared ref would be pointed
   * at an unmounted node half the time.
   */
  const payQrRef = useRef<QrHandle>(null);
  const receiveQrRef = useRef<QrHandle>(null);

  const [toast, setToast] = useState<string | null>(null);
  // One idempotency key per visit to this screen: if the response is lost and the user taps
  // Mark as settled again, the same key makes it a no-op rather than a second settlement.
  // Held as state rather than a ref because it is read during render, to build the UPI `tr`.
  const [mutationId] = useState(newMutationId);

  const saveQr = async (ref: React.RefObject<QrHandle | null>) => {
    const outcome = await saveQrToPhotos(ref.current);
    setToast(
      outcome === 'saved'
        ? 'Saved to your photos.'
        : outcome === 'denied'
          ? 'Chukta needs permission to save to your photos.'
          : "Couldn't save the code — screenshot it instead.",
    );
    setTimeout(() => setToast(null), 2600);
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.person(profileId!),
    queryFn: () => getPersonDetail(profileId!),
    enabled: Boolean(profileId),
  });

  useEffect(() => {
    void discoverUpiApps().then(({ apps: found, native }) => {
      setApps(found);
      setNativePicker(native);
    });
  }, []);

  // Scoped to the group when we came from one, otherwise the whole pair balance.
  const outstanding = useMemo(() => {
    if (!data) return 0n;
    if (!groupId) return data.net_minor;
    return data.by_group.find((g) => g.group_id === groupId)?.net_minor ?? 0n;
  }, [data, groupId]);

  const amountText = typedAmount ?? toAmountInput(absOf(outstanding), 'INR');
  const amountMinor = parseAmount(amountText, 'INR') ?? 0n;
  const iOwe = outstanding < 0n;
  const person = data?.person;
  const theirVpa = person?.upi_vpa ?? null;
  const firstName = (person?.display_name ?? 'them').trim().split(/\s+/)[0]!;

  /*
   * A deep LINK only works in one direction — you can hand someone money, you cannot reach into
   * their phone and take it. That is why this requires `iOwe`.
   *
   * A QR is a different transport and the direction reverses, which the rest of this screen used
   * to miss. See `myUpiUri` below.
   */
  const canPayByUpi = iOwe && Boolean(theirVpa) && isValidVpa(theirVpa ?? '') && amountMinor > 0n;

  /** Your own id, for the case where they are the one paying. */
  const myVpa = profile?.upi_vpa ?? null;
  const canBePaidByUpi =
    !iOwe && Boolean(myVpa) && isValidVpa(myVpa ?? '') && amountMinor > 0n;

  const upiUri = useMemo(() => {
    if (!canPayByUpi || !person) return null;
    try {
      return buildUpiUri({
        vpa: theirVpa!,
        name: person.display_name,
        amountMinor,
        note: settlementNote(profile?.display_name ?? 'a friend', groupName ?? null),
        ref: mutationId,
      });
    } catch {
      // A VPA that passed the pattern but still cannot build a URI is not worth a crash; the
      // screen degrades to Mark as settled.
      return null;
    }
  }, [canPayByUpi, person, theirVpa, amountMinor, profile, groupName, mutationId]);

  /*
   * The same URI, pointed the other way: **your** VPA, for them to scan.
   *
   * This screen used to say "a UPI link only works in the direction of paying" and stop there.
   * True of a deep link, and wrong about a QR — the code is read by THEIR phone, so a QR carrying
   * your id is precisely how you get paid. It is what every shop counter in India is doing. The
   * old copy conflated the transport with the direction and left the receiving half of settle-up
   * with nothing but "mark as settled".
   *
   * `pn` is your name rather than theirs, so their app confirms who they are paying — the one
   * field that must not be copy-pasted from the paying branch.
   *
   * No `tr` reference. `mutationId` ties a payment to the settlement row this device is about to
   * write, and here the payment happens on a device we will never hear from; a reference that
   * cannot be reconciled is worse than none.
   */
  const myUpiUri = useMemo(() => {
    if (!canBePaidByUpi || !profile) return null;
    try {
      return buildUpiUri({
        vpa: myVpa!,
        name: profile.display_name,
        amountMinor,
        note: settlementNote(person?.display_name ?? 'a friend', groupName ?? null),
      });
    } catch {
      return null;
    }
  }, [canBePaidByUpi, profile, myVpa, amountMinor, person, groupName]);

  /*
   * Recording a settlement is queued like every other money write — with one difference that
   * decides the shape of it.
   *
   * `mutationId` is held in state, not minted here, because it has already left the device:
   * it goes out inside the UPI deep link as the transaction reference `tr`, before the write
   * is attempted at all. So the queue has to adopt that exact key rather than generate its
   * own. Handing UPI one reference and the server another would break the only thread tying a
   * payment in GPay to a settlement in Chukta.
   */
  const record = () => {
    if (!profile) return;
    try {
      queueSettlement(
        profile.id,
        {
          groupId: groupId ?? null,
          fromProfileId: iOwe ? profile.id : profileId!,
          toProfileId: iOwe ? profileId! : profile.id,
          amountMinor,
          method: 'upi',
          settledOn: toISODate(new Date()),
        },
        mutationId,
      );
      offline.refresh();
      offline.sync();
      for (const key of afterExpenseChange(groupId ?? null)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      router.back();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setToast(`${label} copied.`);
    setTimeout(() => setToast(null), 2200);
  };

  const settled = outstanding === 0n;
  const tooMuch = amountMinor > (outstanding < 0n ? -outstanding : outstanding);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + FOOTER_CLEARANCE },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          title="Settle up"
          subtitle={
            person ? `${person.display_name}${groupName ? ` · ${groupName}` : ''}` : undefined
          }
          action={
            person ? <Avatar name={person.display_name} url={person.avatar_url} size={44} /> : undefined
          }
        />

        {error && !data ? (
          <EmptyState
            title="Couldn't load this balance"
            body={(error as Error).message}
            actionLabel="Try again"
            onAction={() => void refetch()}
          />
        ) : isLoading || !data ? (
          <View style={styles.loading}>
            <RowSkeleton count={2} />
          </View>
        ) : settled ? (
          <EmptyState
            title="Nothing to settle"
            body={`You and ${firstName} are square. Nothing outstanding${groupName ? ` in ${groupName}` : ''}.`}
          />
        ) : (
          <>
            <GlassSurface radius={radius.panel} elevation="glass" style={styles.amountCardSpacing} contentStyle={styles.amountCard}>
              <Text style={styles.label}>{iOwe ? 'You owe' : `${firstName} owes you`}</Text>

              <View style={styles.amountRow}>
                <Text style={styles.rupee}>₹</Text>
                <TextInput
                  value={amountText}
                  onChangeText={setTypedAmount}
                  placeholder="0"
                  placeholderTextColor={color.textGhost}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  accessibilityLabel="Amount to settle"
                  style={styles.amountInput}
                />
              </View>

              <Text style={styles.context}>{describeContext(data.by_group, groupId)}</Text>

              {tooMuch ? (
                <Text style={styles.warn}>
                  That is more than the {formatAmount(money(absOf(outstanding), 'INR'))}{' '}
                  outstanding — fine if you meant to, worth a second look if not.
                </Text>
              ) : null}
            </GlassSurface>

            {iOwe ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Pay via</Text>

                {!theirVpa ? (
                  <Text style={styles.quiet}>
                    {firstName} hasn&rsquo;t added a UPI ID yet, so there is nothing to hand the
                    payment to. Pay however you normally would, then mark it settled below.
                  </Text>
                ) : !upiUri ? (
                  <Text style={styles.quiet}>Enter an amount to hand this to a UPI app.</Text>
                ) : (
                  <>
                    <View style={styles.payRow}>
                      {/* Android has a real system-level upi:// intent, so its own chooser is
                          both correct and better than anything we would draw. iOS has no such
                          handler, so each app is offered individually. */}
                      {apps.length === 0 ? (
                        <GlassButton
                          label="Open a UPI app"
                          variant="primary"
                          style={styles.payButton}
                          onPress={async () => {
                            if (!(await openUpiPayment(upiUri))) {
                              setShowQr(true);
                              setToast('No UPI app answered — scan the code instead.');
                            }
                          }}
                        />
                      ) : (
                        apps.map((app) => (
                          <Pressable
                            key={app.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Pay with ${app.label}`}
                            onPress={async () => {
                              if (!(await openUpiPayment(upiUri, { app, native: nativePicker }))) {
                                setShowQr(true);
                                setToast(`${app.label} didn't open — scan the code instead.`);
                              }
                            }}
                          >
                            <GlassSurface radius={radius.cardCompact} contentStyle={styles.appTile}>
                              {/* The app's OWN icon, queried from the device. Bundling
                                  GPay/PhonePe/Paytm marks as assets is exactly what querying
                                  avoids — and iOS gives no such API, hence the label-only
                                  fallback. */}
                              {app.iconBase64 ? (
                                <Image
                                  source={{ uri: app.iconBase64 }}
                                  style={styles.appIcon}
                                  contentFit="contain"
                                />
                              ) : null}
                              <Text style={styles.appLabel}>{app.label}</Text>
                            </GlassSurface>
                          </Pressable>
                        ))
                      )}
                    </View>

                    <Text style={styles.help}>
                      Opens with {formatAmount(money(amountMinor, 'INR'))} and {firstName}&rsquo;s
                      UPI ID already filled in. Nothing is paid until you confirm it there.
                    </Text>

                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setShowQr((v) => !v)}
                      hitSlop={8}
                    >
                      <Text style={styles.link}>
                        {showQr ? 'Hide the QR code' : 'Show a QR code instead'}
                      </Text>
                    </Pressable>

                    {showQr ? (
                      <View style={styles.qrBlock}>
                        <QrCode ref={payQrRef} value={upiUri} />
                        <Text style={styles.help}>
                          Scan from any UPI app. Save it if someone else is doing the paying.
                        </Text>
                        <View style={styles.copyRow}>
                          <GlassButton
                            label="Copy UPI ID"
                            onPress={() => void copy('UPI ID', theirVpa!)}
                            style={styles.copyButton}
                          />
                          <GlassButton
                            label="Copy amount"
                            onPress={() =>
                              void copy('Amount', formatAmount(money(amountMinor, 'INR'), {
                                symbol: false,
                                decimals: 'always',
                              }))
                            }
                            style={styles.copyButton}
                          />
                        </View>
                        {qrSaveAvailable() ? (
                          <GlassButton label="Save to Photos" onPress={() => void saveQr(payQrRef)} />
                        ) : null}
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            ) : (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>They owe you</Text>

                {myUpiUri ? (
                  <>
                    <Text style={styles.quiet}>
                      Show {firstName} this code. Scanning it opens their UPI app with your id and{' '}
                      {formatAmount(money(amountMinor, 'INR'))} already filled in.
                    </Text>

                    <View style={styles.qrBlock}>
                      <QrCode ref={receiveQrRef} value={myUpiUri} />
                      <View style={styles.copyRow}>
                        <GlassButton
                          label="Copy your UPI ID"
                          onPress={() => void copy('UPI ID', myVpa!)}
                          style={styles.copyButton}
                        />
                        <GlassButton
                          label="Copy amount"
                          onPress={() =>
                            void copy('Amount', formatAmount(money(amountMinor, 'INR'), {
                              symbol: false,
                              decimals: 'always',
                            }))
                          }
                          style={styles.copyButton}
                        />
                      </View>
                      {/* The code most likely to leave the app: they will want to send this to
                          whoever owes them rather than hold a phone up across a table. */}
                      {qrSaveAvailable() ? (
                        <GlassButton
                          label="Save to Photos"
                          onPress={() => void saveQr(receiveQrRef)}
                        />
                      ) : null}
                    </View>

                    {/* Money arriving and the ledger agreeing are two separate events, and only
                        one of them happens on this screen. Showing a code is not evidence of
                        payment, so Mark as settled stays a deliberate act below. */}
                    <Text style={styles.help}>
                      Nothing is recorded until you mark it settled below.
                    </Text>
                  </>
                ) : myVpa ? (
                  // A VPA that passed the pattern but could not build a URI. Rare, and not worth
                  // a crash — say what still works.
                  <Text style={styles.quiet}>
                    Couldn&rsquo;t build a QR from your UPI ID. {firstName} can still send the
                    money however they normally would — record it below once it arrives.
                  </Text>
                ) : (
                  <>
                    {/*
                      * The one thing standing between the user and being paid, so this offers the
                      * fix rather than stating the problem. Everyone who skipped the field during
                      * onboarding lands here.
                      */}
                    <Text style={styles.quiet}>
                      Add your UPI ID and this screen will show a code {firstName} can scan to pay
                      you. Until then, they will have to send it however they normally would.
                    </Text>
                    <GlassButton
                      label="Add your UPI ID"
                      onPress={() => router.push('/settings')}
                    />
                  </>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {!settled && data ? (
        <FooterBar>
          <GlassButton
            label="Mark as settled"
            variant={iOwe ? 'secondary' : 'primary'}
            disabled={amountMinor <= 0n || !profile}
            onPress={record}
          />
          <Text style={styles.disclaimer}>
            Self-reported. Nobody here can check your bank.
          </Text>
        </FooterBar>
      ) : null}

      <Toast message={toast} />
    </KeyboardAvoidingView>
  );
}

const absOf = (v: bigint): bigint => (v < 0n ? -v : v);

/** "Across 3 shared groups · Goa, finally, Flat 302" — the design's context line. */
function describeContext(
  byGroup: { group_id: string | null; group_name: string | null; net_minor: bigint }[],
  groupId?: string,
): string {
  if (groupId) return 'Only what is outstanding in this group.';

  const named = byGroup.filter((g) => g.group_id !== null && g.net_minor !== 0n);
  const oneOff = byGroup.some((g) => g.group_id === null && g.net_minor !== 0n);

  if (named.length === 0) return oneOff ? 'From one-off expenses.' : 'Nothing outstanding.';

  const list = named.map((g) => g.group_name).join(', ');
  const count = `Across ${named.length} shared ${named.length === 1 ? 'group' : 'groups'}`;
  return oneOff ? `${count} and one-off expenses · ${list}` : `${count} · ${list}`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  loading: { marginTop: 26 },
  // Margin on `style`, not `contentStyle`. contentStyle lands on the inner view inside
  // GlassSurface, so a margin there pads the content and leaves the card itself flush
  // against whatever is above it.
  amountCardSpacing: { marginTop: 22 },
  amountCard: { padding: 20, gap: 8 },
  label: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rupee: { fontFamily: font.light, fontSize: 34, color: color.textFaint },
  amountInput: {
    flex: 1,
    padding: 0,
    fontFamily: font.semibold,
    fontSize: 40,
    color: color.textHighlight,
  },
  context: { fontFamily: font.light, fontSize: 12.5, lineHeight: 18, color: color.textFaint },
  warn: { marginTop: 4, fontFamily: font.light, fontSize: 12.5, lineHeight: 18, color: color.creamRose },
  section: { marginTop: 28, gap: 12 },
  sectionTitle: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
  quiet: { fontFamily: font.light, fontSize: 14, lineHeight: 21, color: color.textMuted },
  payRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  payButton: { flex: 1, minWidth: '100%' },
  appTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  appIcon: { width: 26, height: 26, borderRadius: 6 },
  appLabel: { fontFamily: font.medium, fontSize: 14.5, color: color.creamWarm },
  help: { fontFamily: font.light, fontSize: 12.5, lineHeight: 19, color: color.textFaint },
  link: { fontFamily: font.medium, fontSize: 14, color: color.creamWarm },
  qrBlock: { gap: 14, marginTop: 4 },
  copyRow: { flexDirection: 'row', gap: 10 },
  copyButton: { flex: 1 },
  disclaimer: {
    textAlign: 'center',
    fontFamily: font.light,
    fontSize: 12,
    color: color.textFaint,
  },
});
