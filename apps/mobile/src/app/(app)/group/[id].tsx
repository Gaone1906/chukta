import { formatAmount, money } from '@chukta/core';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FAB, GlassButton, GlassSurface, SettledBadge, Toast, color, font, layout, radius, useRippleNav } from '@/design';
import { EmptyState } from '@/features/home/EmptyState';
import { RowSkeleton } from '@/features/home/RowSkeleton';
import { ExpenseRow, markerFor } from '@/features/expenses/ExpenseRow';
import { ScreenHeader } from '@/features/expenses/ScreenHeader';
import { useSession } from '@/features/auth/session';
import { getGroupDetail, type GroupMember } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { useState } from 'react';

/**
 * Group detail.
 * Ported from design-reference/screens/Hisaab Group.dc.html.
 */
export default function GroupDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useSession();
  const { rippleTo, rippleFrom } = useRippleNav();
  const [toast, setToast] = useState<string | null>(null);

  const { data, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: queryKeys.group(id!),
    queryFn: () => getGroupDetail(id!),
    enabled: Boolean(id),
  });

  const settleWith = (counterpartyId: string) =>
    router.push({
      pathname: '/settle',
      params: { profileId: counterpartyId, groupId: id!, groupName: data?.group.name ?? '' },
    });

  const ping = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  };

  // get_group_detail returns a balance per member without labelling which one is the caller,
  // so it is matched against the session profile rather than inferred.
  const myNet = data?.members.find((m) => m.profile_id === profile?.id)?.net_minor ?? 0n;
  const others = data?.members.filter((m) => m.profile_id !== profile?.id && m.net_minor !== 0n) ?? [];

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 150 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isLoading}
            onRefresh={() => void refetch()}
            tintColor={color.goldBright}
          />
        }
      >
        <ScreenHeader
          title={data?.group.name ?? 'Group'}
          subtitle={
            data ? `${data.members.length} ${data.members.length === 1 ? 'member' : 'members'}` : undefined
          }
          /*
           * The prototype drew an `onMembers` affordance here and bound it to nothing, which is
           * how a group ended up immutable after creation. This is that door.
           */
          action={
            data ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Group settings"
                hitSlop={10}
                onPress={(ev) =>
                  rippleFrom(ev, () =>
                    router.push({ pathname: '/group/settings', params: { id: id! } }),
                  )
                }
                style={styles.settingsButton}
              >
                <Text style={styles.settingsLabel}>Manage</Text>
              </Pressable>
            ) : undefined
          }
        />

        {error && !data ? (
          <EmptyState
            title="Couldn't load this group"
            body={(error as Error).message}
            actionLabel="Try again"
            onAction={() => void refetch()}
          />
        ) : isLoading || !data ? (
          <View style={styles.loading}>
            <RowSkeleton count={3} />
          </View>
        ) : (
          <>
            {/* Summary card: net position, then who owes what inside the group. */}
            <GlassSurface radius={radius.panel} elevation="glass" style={styles.summarySpacing} contentStyle={styles.summary}>
              <Text style={styles.summaryLabel}>
                {myNet > 0n ? "You're owed" : myNet < 0n ? 'You owe' : 'All square'}
              </Text>
              {myNet === 0n ? (
                <View style={styles.settledRow}>
                  <SettledBadge />
                  <Text style={styles.settledText}>Nothing outstanding in this group.</Text>
                </View>
              ) : (
                <Text style={styles.summaryAmount}>
                  {formatAmount(money(myNet, 'INR'), { signed: false })}
                </Text>
              )}

              <View style={styles.breakdown}>
                {others.map((m) => (
                  <Pressable
                    key={m.profile_id}
                    accessibilityRole="button"
                    accessibilityLabel={`Settle up with ${m.display_name}`}
                    hitSlop={6}
                    onPress={() => settleWith(m.profile_id)}
                    style={styles.breakdownRow}
                  >
                    <Text style={styles.memberName} numberOfLines={1}>
                      {m.display_name}
                      {m.is_placeholder ? <Text style={styles.pending}>  not on Chukta yet</Text> : null}
                    </Text>
                    <Text
                      style={[
                        styles.memberAmount,
                        { color: m.net_minor > 0n ? color.creamWarm : color.creamRose },
                      ]}
                    >
                      {m.net_minor > 0n ? 'is owed ' : 'owes '}
                      {formatAmount(money(m.net_minor, 'INR'), { signed: false })}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <GlassButton
                label="Settle up"
                variant={myNet === 0n ? 'secondary' : 'primary'}
                disabled={myNet === 0n}
                onPress={() => {
                  // A group settlement is always with one person. When there is only one
                  // counterparty, asking which would be a pointless step; when there are
                  // several, the breakdown above is already the picker.
                  if (others.length === 1) settleWith(others[0]!.profile_id);
                  else ping('Tap whoever you want to settle with, above.');
                }}
                style={styles.settleButton}
              />
            </GlassSurface>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Expenses</Text>
              <Text style={styles.sectionMeta}>Newest first</Text>
            </View>

            {data.expenses.length === 0 ? (
              <EmptyState
                title="No expenses yet"
                body="The group exists, which is the hard part. Add the first thing anyone paid for."
                actionLabel="Add an expense"
                onAction={(e) =>
                  rippleFrom(e, () =>
                    router.push({ pathname: '/expense/new', params: { groupId: id! } }),
                  )
                }
              />
            ) : (
              <View style={styles.list}>
                {data.expenses.map((e) => (
                  <ExpenseRow
                    key={e.id}
                    description={e.description}
                    amountMinor={e.amount_minor}
                    myShareMinor={e.my_share_minor}
                    meta={`${payerLabel(e.payers, data.members, profile?.id)} · split ${e.split_count} ways`}
                    paidBy={markerFor(e.paid_in_full_at, e.marked_by, profile?.id)}
                    onPress={(at) => rippleTo(at, () => router.push(`/expense/${e.id}`))}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <FAB
        style={[styles.fab, { bottom: insets.bottom + 30 }]}
        accessibilityLabel="Add an expense to this group"
        onPress={(at) =>
          rippleTo(at, () =>
            router.push({ pathname: '/expense/new', params: { groupId: id! } }),
          )
        }
      />

      <Toast message={toast} />
    </View>
  );
}

function payerLabel(
  payers: { profile_id: string; paid_amount_minor: bigint }[],
  members: GroupMember[],
  meId: string | undefined,
): string {
  if (payers.length === 0) return 'Nobody paid';
  if (payers.length > 1) return `${payers.length} people paid`;
  // "You paid", not your own display name — reading your own name back at you in a list you
  // are obviously part of is the kind of thing that makes an app feel like a database.
  if (payers[0]!.profile_id === meId) return 'You paid';
  const name = members.find((m) => m.profile_id === payers[0]!.profile_id)?.display_name;
  return `${name ?? 'Someone'} paid`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  loading: { marginTop: 24 },
  // Margin on `style`, not `contentStyle`. contentStyle lands on the inner view inside
  // GlassSurface, so a margin there pads the content and leaves the card itself flush
  // against whatever is above it.
  summarySpacing: { marginTop: 22 },
  summary: { padding: 20, gap: 14 },
  summaryLabel: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  summaryAmount: { fontFamily: font.semibold, fontSize: 34, color: color.textHighlight },
  settledRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settledText: { flex: 1, fontFamily: font.light, fontSize: 14, color: color.textMuted },
  breakdown: { gap: 10, marginTop: 2 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  memberName: { flex: 1, fontFamily: font.regular, fontSize: 14.5, color: color.textSecondary },
  pending: { fontFamily: font.light, fontSize: 12, color: color.textGhost },
  memberAmount: { fontFamily: font.medium, fontSize: 14.5 },
  settleButton: { marginTop: 6 },
  sectionHeader: {
    marginTop: 30,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
  sectionMeta: { fontFamily: font.light, fontSize: 12, color: color.textGhost },
  list: { gap: 11 },
  fab: { position: 'absolute', right: 24 },
  settingsButton: {
    paddingHorizontal: 6,
    minHeight: layout.touchTarget,
    justifyContent: 'center',
  },
  settingsLabel: { fontFamily: font.medium, fontSize: 14, color: color.creamWarm },
});
