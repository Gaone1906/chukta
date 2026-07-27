import { money } from '@chukta/core';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { FAB, Row, SegmentedSwitcher, color, space, useRippleNav } from '@/design';
import { EmptyState } from '@/features/home/EmptyState';
import { RowSkeleton } from '@/features/home/RowSkeleton';
import { initials } from '@/features/people/Avatar';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { getHomeSummary } from '@/lib/api';
import { deltaFor } from '@/lib/offline/effects';
import { useOffline } from '@/lib/offline/OfflineProvider';
import { queryKeys } from '@/lib/queryKeys';

const WORDMARK = require('../../../assets/brand/chukta-mark.png');

/**
 * Home — the hub.
 * Ported from design-reference/screens/Hisaab Home.dc.html.
 *
 * Both tabs and every balance arrive in ONE round trip (`get_home_summary`). The obvious
 * alternative — a query per list plus one per balance — is a request waterfall on the screen
 * users open most.
 */
export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { rippleTo, rippleFrom } = useRippleNav();
  const [tab, setTab] = useState<'groups' | 'people'>('groups');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { effects, pendingPeople } = useOffline();

  const { data, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: queryKeys.home(),
    queryFn: getHomeSummary,
  });

  /*
   * The server's numbers, plus whatever is still sitting in the outbox.
   *
   * This is what makes an expense entered with no signal actually *do* something. The cached
   * figure is the last thing the server said and stays untouched; the overlay on top of it is
   * the sum of every queued write's effect, computed when that write was made by the same
   * `resolvePairwise` the server uses. When the queue drains and the refetch lands, the
   * overlay empties and the server's own figure is what remains — so this is a temporary
   * amendment to the truth, never a second copy of it.
   */
  const groups = useMemo(
    () =>
      (data?.groups ?? []).map((g) => ({
        ...g,
        net_minor: g.net_minor + deltaFor(effects, 'group', g.id),
      })),
    [data?.groups, effects],
  );

  const people = useMemo(() => {
    const known = (data?.people ?? []).map((p) => ({
      ...p,
      net_minor: p.net_minor + deltaFor(effects, 'person', p.id),
    }));

    // Somebody named while offline is not in the summary yet — that list is the server's
    // answer, and the server has not been told. Showing them here is the same fix migration
    // 0022 made for the online case: a person you just created who is invisible to the app is
    // not a person you can split anything with.
    const seen = new Set(known.map((p) => p.id));
    const queued = pendingPeople
      .filter((p) => !seen.has(p.id))
      .map((p) => ({
        id: p.id,
        display_name: p.displayName,
        avatar_url: null,
        is_placeholder: true,
        shared_group_count: 0,
        net_minor: deltaFor(effects, 'person', p.id),
      }));

    return [...known, ...queued].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [data?.people, effects, pendingPeople]);

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
            colors={[color.goldLeaf]}
            progressBackgroundColor={color.bgBase}
          />
        }
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            style={styles.profileButton}
            onPress={() => setSidebarOpen(true)}
          >
            <Svg width={17} height={18} viewBox="0 0 17 18" fill="none">
              <Circle cx={8.5} cy={5.4} r={3.6} stroke="rgba(244,237,228,.85)" strokeWidth={1.4} />
              <Path
                d="M1.8 16.5c0-3.1 3-5.2 6.7-5.2s6.7 2.1 6.7 5.2"
                stroke="rgba(244,237,228,.85)"
                strokeWidth={1.4}
                strokeLinecap="round"
              />
            </Svg>
          </Pressable>

          <Image source={WORDMARK} style={styles.wordmark} contentFit="contain" />
        </View>

        <View style={styles.switcher}>
          <SegmentedSwitcher
            options={[
              { value: 'groups', label: 'Groups' },
              { value: 'people', label: 'People' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </View>

        <View style={styles.list}>
          {/*
            * `&& !data` is the whole of "works offline" on the read side, and it was missing.
            *
            * The persisted cache restores every screen's last server response, so with no
            * network there IS something to show — but the query still tries, still fails, and
            * still lands in `error`. Rendering `error` in preference to `data` meant a
            * perfectly good cached ledger was thrown away the moment a refetch failed, and the
            * user got a fetch stack trace where their groups had been. Found by pulling the
            * server out from under a running app; no test would have caught it, because both
            * halves were individually correct.
            *
            * An error state is for having nothing to show. A failed refresh of something we
            * already have is not that.
            */}
          {error && !data ? (
            <EmptyState
              title="Couldn't load your ledger"
              body={(error as Error).message}
              actionLabel="Try again"
              onAction={() => void refetch()}
            />
          ) : isLoading ? (
            <RowSkeleton />
          ) : tab === 'groups' ? (
            groups.length === 0 ? (
              <EmptyState
                title="No groups yet"
                body="A group is just a name and the people in it — a trip, a flat, a standing football booking. Add an expense and name it, and the group makes itself."
                actionLabel="Add an expense"
                onAction={(e) => rippleFrom(e, () => router.push('/expense/who'))}
              />
            ) : (
              groups.map((g) => (
                <Row
                  key={g.id}
                  name={g.name}
                  meta={`${g.member_count} ${g.member_count === 1 ? 'member' : 'members'}`}
                  balance={money(g.net_minor, g.currency)}
                  onPress={(at) => rippleTo(at, () => router.push(`/group/${g.id}`))}
                />
              ))
            )
          ) : people.length === 0 ? (
            <EmptyState
              title="Nobody here yet"
              body="People show up once you share an expense with them. You don't have to add anyone first."
              actionLabel="Add an expense"
              onAction={(e) => rippleFrom(e, () => router.push('/expense/who'))}
            />
          ) : (
            people.map((p) => (
              <Row
                key={p.id}
                name={p.display_name}
                meta={
                  p.shared_group_count > 0
                    ? `${p.shared_group_count} shared ${p.shared_group_count === 1 ? 'group' : 'groups'}`
                    : 'One-off expenses'
                }
                balance={money(p.net_minor, 'INR')}
                avatar={initials(p.display_name)}
                // Both, not either: the initials are the fallback the Row falls back TO when the
                // picture is absent or fails to load, so they are still needed when a URL exists.
                avatarUrl={p.avatar_url}
                avatarTone={p.net_minor > 0n ? 'gold' : p.net_minor < 0n ? 'oxblood' : 'plain'}
                onPress={(at) => rippleTo(at, () => router.push(`/person/${p.id}`))}
              />
            ))
          )}
        </View>
      </ScrollView>

      {/* Fades the list out behind the FAB rather than letting rows collide with it. */}
      <View pointerEvents="none" style={styles.fade} />

      <FAB
        style={[styles.fab, { bottom: insets.bottom + 30 }]}
        onPress={(at) => rippleTo(at, () => router.push('/expense/who'))}
      />

      <Sidebar visible={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  wordmark: { width: 124, height: 40, opacity: 0.92 },
  switcher: { marginTop: 20 },
  list: { marginTop: 18, gap: 11 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 140 },
  fab: { position: 'absolute', right: 24 },
  spacer: { height: space.xxl },
});
