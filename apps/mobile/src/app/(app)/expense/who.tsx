import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { GlassButton, GlassSurface, color, font, radius, useRippleNav } from '@/design';
import { EmptyState } from '@/features/home/EmptyState';
import { RowSkeleton } from '@/features/home/RowSkeleton';
import { FOOTER_CLEARANCE, FooterBar } from '@/features/expenses/FooterBar';
import { GroupPickRow, PersonPickRow } from '@/features/expenses/PickRow';
import { SearchField } from '@/features/expenses/SearchField';
import { BackChevron } from '@/features/onboarding/BackChevron';
import { AddPersonSheet } from '@/features/people/AddPersonSheet';
import { getHomeSummary } from '@/lib/api';
import { useOffline } from '@/lib/offline/OfflineProvider';
import { withPendingPeople } from '@/lib/offline/people';
import { queryKeys } from '@/lib/queryKeys';

/**
 * "Who's this with?" — step 1 of the two-step add-expense flow from the Home FAB.
 *
 * Ported from design-reference/screens/Hisaab Add Expense.dc.html (frame 1).
 *
 * Picking a group and picking loose people are mutually exclusive: an expense either belongs
 * to a group or it does not, and letting both be selected would make the next screen guess.
 * Selecting one clears the other rather than disabling it, which is less to explain.
 */
export default function WhoPicker() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { rippleFrom } = useRippleNav();

  const [search, setSearch] = useState('');
  const [addingPerson, setAddingPerson] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const offline = useOffline();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.home(),
    queryFn: getHomeSummary,
  });

  const term = search.trim().toLowerCase();
  const groups = useMemo(
    () => (data?.groups ?? []).filter((g) => !term || g.name.toLowerCase().includes(term)),
    [data, term],
  );
  const folks = useMemo(
    () =>
      withPendingPeople(data?.people ?? [], offline.pendingPeople, offline.effects).filter(
        (p) => !term || p.display_name.toLowerCase().includes(term),
      ),
    [data, term, offline.pendingPeople, offline.effects],
  );

  // Whoever the sheet creates is ticked immediately — the tap that added them is also the tap
  // that picked them, which is what someone adding a friend in order to split with them meant.
  const onPersonAdded = (profileId: string) => {
    setGroupId(null);
    setPeople((prev) => (prev.includes(profileId) ? prev : [...prev, profileId]));
    setSearch('');
    void queryClient.invalidateQueries({ queryKey: queryKeys.home() });
  };

  const togglePerson = (id: string) => {
    setGroupId(null);
    setPeople((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };

  const pickGroup = (id: string) => {
    setPeople([]);
    setGroupId((prev) => (prev === id ? null : id));
  };

  const selectedGroup = data?.groups.find((g) => g.id === groupId) ?? null;
  const picked = selectedGroup
    ? selectedGroup.name
    : people.length === 0
      ? 'Nobody picked yet'
      : `${people.length} ${people.length === 1 ? 'person' : 'people'}`;
  const ready = Boolean(groupId) || people.length > 0;

  const advance = (event: GestureResponderEvent) => {
    if (!ready) return;
    // `fromPicker` tells the form how to unwind after a successful save. The stack here is
    // Home -> picker -> form, so a single back() would drop the user back onto this screen
    // with their old selection still ticked, one step into a flow they just finished.
    rippleFrom(event, () =>
      router.push({
        pathname: '/expense/new',
        params: groupId
          ? { groupId, fromPicker: '1' }
          : { withProfileIds: people.join(','), fromPicker: '1' },
      }),
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + FOOTER_CLEARANCE },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <BackChevron onPress={() => router.back()} />

        <View style={styles.titles}>
          <Text style={styles.eyebrow}>Step 1 of 2</Text>
          <Text style={styles.title}>Who&rsquo;s this with?</Text>
        </View>

        <View style={styles.search}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Search groups or people"
          />
        </View>

        {error && !data ? (
          <EmptyState
            title="Couldn't load your people"
            body={(error as Error).message}
            actionLabel="Try again"
            onAction={() => void refetch()}
          />
        ) : isLoading ? (
          <View style={styles.section}>
            <RowSkeleton count={4} />
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Your groups</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create a new group"
                  hitSlop={8}
                  onPress={(e) => rippleFrom(e, () => router.push('/expense/new-group'))}
                  style={styles.newGroup}
                >
                  <Svg width={11} height={11} viewBox="0 0 12 12" fill="none">
                    <Path
                      d="M6 1.6v8.8M1.6 6h8.8"
                      stroke={color.creamWarm}
                      strokeWidth={1.6}
                      strokeLinecap="round"
                    />
                  </Svg>
                  <Text style={styles.newGroupLabel}>New group</Text>
                </Pressable>
              </View>

              {groups.length === 0 ? (
                <Text style={styles.none}>
                  {term ? 'No group by that name.' : 'No groups yet — pick people instead.'}
                </Text>
              ) : (
                <View style={styles.list}>
                  {groups.map((g) => (
                    <GroupPickRow
                      key={g.id}
                      name={g.name}
                      meta={`${g.member_count} ${g.member_count === 1 ? 'member' : 'members'}`}
                      selected={groupId === g.id}
                      onPress={() => pickGroup(g.id)}
                    />
                  ))}
                </View>
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Or pick people</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add someone who is not on Hisaab"
                  hitSlop={8}
                  onPress={() => setAddingPerson(true)}
                  style={styles.newGroup}
                >
                  <Svg width={11} height={11} viewBox="0 0 12 12" fill="none">
                    <Path
                      d="M6 1.6v8.8M1.6 6h8.8"
                      stroke={color.creamWarm}
                      strokeWidth={1.6}
                      strokeLinecap="round"
                    />
                  </Svg>
                  <Text style={styles.newGroupLabel}>Add someone</Text>
                </Pressable>
              </View>

              <View style={styles.list}>
                {folks.map((p) => (
                  <PersonPickRow
                    key={p.id}
                    name={p.display_name}
                    avatarUrl={p.avatar_url}
                    meta={p.is_placeholder ? 'Not on Hisaab yet' : undefined}
                    selected={people.includes(p.id)}
                    onPress={() => togglePerson(p.id)}
                  />
                ))}

                {/* Always the last row, never conditional on what has been typed. The old
                    version only appeared once you had typed a name matching nobody — a real
                    capability with no visible door, which is exactly how it went unnoticed. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add someone who is not on Hisaab"
                  onPress={() => setAddingPerson(true)}
                >
                  <GlassSurface radius={radius.cardCompact} contentStyle={styles.inventRow}>
                    <Svg width={13} height={13} viewBox="0 0 12 12" fill="none">
                      <Path
                        d="M6 1.6v8.8M1.6 6h8.8"
                        stroke={color.creamWarm}
                        strokeWidth={1.6}
                        strokeLinecap="round"
                      />
                    </Svg>
                    <Text style={styles.inventLabel} numberOfLines={1}>
                      {term ? `Add “${search.trim()}” as someone new` : 'Add someone new'}
                    </Text>
                  </GlassSurface>
                </Pressable>

                {folks.length === 0 ? (
                  <Text style={styles.none}>
                    Nobody here yet — add someone above. They don&rsquo;t need the app for you to
                    start splitting with them.
                  </Text>
                ) : null}
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* The primary action stays pinned rather than sitting at the end of a long list —
          the list can be dozens of people and the button is the point of the screen. */}
      <FooterBar>
        <GlassButton label="Continue" variant="primary" disabled={!ready} onPress={advance} />
        <Text style={styles.picked} numberOfLines={1}>
          {picked}
        </Text>
      </FooterBar>

      <AddPersonSheet
        visible={addingPerson}
        onClose={() => setAddingPerson(false)}
        onAdded={onPersonAdded}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  titles: { marginTop: 14, gap: 4 },
  eyebrow: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  title: { fontFamily: font.display, fontSize: 32, color: color.cream },
  search: { marginTop: 16 },
  section: { marginTop: 24 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
  newGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  newGroupLabel: { fontFamily: font.medium, fontSize: 13, color: color.creamWarm },
  list: { marginTop: 11, gap: 9 },
  none: { marginTop: 12, fontFamily: font.light, fontSize: 13.5, color: color.textMuted },
  inventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  inventLabel: { flex: 1, fontFamily: font.medium, fontSize: 14.5, color: color.creamWarm },
  picked: {
    textAlign: 'center',
    fontFamily: font.light,
    fontSize: 12.5,
    color: color.textFaint,
  },
});
