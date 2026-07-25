import { formatAmount, money } from '@hisaab/core';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FAB, GlassButton, GlassSurface, SettledBadge, Toast, color, font, radius } from '@/design';
import { BackChevron } from '@/features/onboarding/BackChevron';
import { EmptyState } from '@/features/home/EmptyState';
import { RowSkeleton } from '@/features/home/RowSkeleton';
import { ExpenseRow } from '@/features/expenses/ExpenseRow';
import { Avatar } from '@/features/people/Avatar';
import { getPersonDetail } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Person detail — the combined balance with one person across every group they share with
 * you, plus the expenses behind it.
 *
 * Ported from design-reference/screens/Hisaab Person.dc.html.
 *
 * `net_minor` follows the same convention as everywhere else: POSITIVE means they owe you.
 * The RPC has already flipped the pair-ledger sign to the caller's point of view, so nothing
 * here needs to know which of the two profile ids sorted lower.
 */
export default function PersonDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [toast, setToast] = useState<string | null>(null);

  const { data, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: queryKeys.person(id!),
    queryFn: () => getPersonDetail(id!),
    enabled: Boolean(id),
  });

  const ping = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  };

  const net = data?.net_minor ?? 0n;
  const name = data?.person.display_name ?? 'Person';
  const groupCount = data?.by_group.filter((g) => g.group_id !== null).length ?? 0;

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
        {/* Back and avatar share a row; the name gets its own line beneath, because a
            38px display face and a 44px button on one row wrap badly at long names. */}
        <View style={styles.topRow}>
          <BackChevron onPress={() => router.back()} />
          <Avatar
            name={name}
            url={data?.person.avatar_url}
            tone={net > 0n ? 'gold' : net < 0n ? 'oxblood' : 'plain'}
          />
        </View>

        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {data ? (
            <Text style={styles.nameMeta}>
              {groupCount > 0
                ? `${groupCount} shared ${groupCount === 1 ? 'group' : 'groups'}`
                : 'One-off expenses'}
            </Text>
          ) : null}
        </View>

        {error ? (
          <EmptyState
            title="Couldn't load this person"
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
            <GlassSurface radius={radius.panel} elevation="glass" contentStyle={styles.summary}>
              <View style={styles.summaryTop}>
                <View style={styles.summaryLeft}>
                  <Text style={styles.summaryLabel}>
                    {net > 0n
                      ? `${firstName(name)} owes you`
                      : net < 0n
                        ? `You owe ${firstName(name)}`
                        : 'All square'}
                  </Text>

                  {net === 0n ? (
                    <View style={styles.settledRow}>
                      <SettledBadge />
                      <Text style={styles.settledText}>Nothing outstanding between you two.</Text>
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.amountChip,
                        {
                          borderColor: net > 0n ? color.owedBorder : color.oweBorder,
                          backgroundColor: net > 0n ? color.owedFill : color.oweFill,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.amount,
                          { color: net > 0n ? color.creamWarm : color.creamRose },
                        ]}
                      >
                        {formatAmount(money(net, 'INR'), { signed: false })}
                      </Text>
                    </View>
                  )}
                </View>

                {net !== 0n ? (
                  <GlassButton
                    label="Settle up"
                    variant="primary"
                    onPress={() => ping('Settle up arrives in Phase 6.')}
                    style={styles.settleButton}
                  />
                ) : null}
              </View>

              {/* Per-group breakdown. get_person_detail omits groups that net to zero, so a
                  fully settled shared group simply is not listed rather than shown greyed. */}
              {data.by_group.length > 0 ? (
                <View style={styles.breakdown}>
                  {data.by_group.map((g) => (
                    <View key={g.group_id ?? 'one-off'} style={styles.breakdownRow}>
                      <Text style={styles.breakdownName} numberOfLines={1}>
                        {g.group_name ?? 'One-off expenses'}
                      </Text>
                      <Text
                        style={[
                          styles.breakdownAmount,
                          { color: g.net_minor > 0n ? color.creamWarm : color.creamRose },
                        ]}
                      >
                        {formatAmount(money(g.net_minor, 'INR'), { signed: false })}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </GlassSurface>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Between you two</Text>
              <Text style={styles.sectionMeta}>Newest first</Text>
            </View>

            {data.expenses.length === 0 ? (
              <EmptyState
                title="Nothing shared yet"
                body={`You and ${firstName(name)} have no expenses between you. Add one and it shows up here.`}
                actionLabel="Add an expense"
                onAction={() => router.push({ pathname: '/expense/new', params: { withProfileIds: id! } })}
              />
            ) : (
              <View style={styles.list}>
                {data.expenses.map((e) => (
                  <ExpenseRow
                    key={e.id}
                    description={e.description}
                    amountMinor={e.amount_minor}
                    myShareMinor={e.my_share_minor}
                    groupName={e.group_name}
                    meta={`${firstName(name)}'s share ${formatAmount(money(e.their_share_minor, 'INR'), { signed: false })}`}
                    onPress={() => router.push(`/expense/${e.id}`)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <FAB
        style={[styles.fab, { bottom: insets.bottom + 30 }]}
        accessibilityLabel={`Add an expense with ${name}`}
        onPress={() =>
          router.push({ pathname: '/expense/new', params: { withProfileIds: id! } })
        }
      />

      <Toast message={toast} />
    </View>
  );
}

/** "Priya Sharma owes you" is stiff; "Priya owes you" is how anyone would actually say it. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nameRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 14,
  },
  name: { flex: 1, fontFamily: font.display, fontSize: 34, color: color.cream },
  nameMeta: { fontFamily: font.light, fontSize: 12.5, color: color.textFaint },
  loading: { marginTop: 24 },
  summary: { marginTop: 16, padding: 20, gap: 14 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  summaryLeft: { flex: 1, gap: 7 },
  summaryLabel: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  amountChip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  amount: { fontFamily: font.semibold, fontSize: 25 },
  settledRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settledText: { flex: 1, fontFamily: font.light, fontSize: 13.5, color: color.textMuted },
  settleButton: { flex: 0 },
  breakdown: {
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.09)',
    gap: 5,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  breakdownName: { flex: 1, fontFamily: font.light, fontSize: 12.5, color: color.textMuted },
  breakdownAmount: { fontFamily: font.medium, fontSize: 12.5 },
  sectionHeader: {
    marginTop: 20,
    marginBottom: 11,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
  sectionMeta: { fontFamily: font.light, fontSize: 12, color: color.textGhost },
  list: { gap: 11 },
  fab: { position: 'absolute', right: 24 },
});
