import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { GlassButton, GlassSurface, Toast, color, font, radius, useRippleNav } from '@/design';
import { FOOTER_CLEARANCE, FooterBar } from '@/features/expenses/FooterBar';
import { PersonPickRow } from '@/features/expenses/PickRow';
import { SearchField } from '@/features/expenses/SearchField';
import { RowSkeleton } from '@/features/home/RowSkeleton';
import { BackChevron } from '@/features/onboarding/BackChevron';
import { AddPersonSheet } from '@/features/people/AddPersonSheet';
import { getHomeSummary } from '@/lib/api';
import { useOffline } from '@/lib/offline/OfflineProvider';
import { withPendingPeople } from '@/lib/offline/people';
import { queueCreateGroup } from '@/lib/offline/writes';
import { queryKeys } from '@/lib/queryKeys';

/**
 * "+ New group" — creating a group before there is anything to put in it.
 *
 * In the design this lives as a `view === 'create'` sub-state inside the picker file. It is
 * its own route here: it has its own back behaviour, its own primary action and its own way of
 * failing, and folding all of that into the picker's state machine buys nothing.
 *
 * The main path to a group is still the expense form's optional "name this group" field. This
 * is the escape hatch for people who want the group to exist first.
 */
export default function NewGroup() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { rippleFrom } = useRippleNav();
  const offline = useOffline();

  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [addingPerson, setAddingPerson] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.home(),
    queryFn: getHomeSummary,
  });

  const term = search.trim().toLowerCase();
  const roster = useMemo(
    () =>
      withPendingPeople(data?.people ?? [], offline.pendingPeople, offline.effects).filter(
        (p) => !term || p.display_name.toLowerCase().includes(term),
      ),
    [data, term, offline.pendingPeople, offline.effects],
  );
  // Whoever the sheet creates joins the group straight away — you opened it in order to put
  // them in, so making you find and tick them afterwards would be a step for nothing.
  const onPersonAdded = (profileId: string) => {
    setMembers((prev) => (prev.includes(profileId) ? prev : [...prev, profileId]));
    setSearch('');
    void queryClient.invalidateQueries({ queryKey: queryKeys.home() });
  };

  /*
   * The group exists the moment you tap Create.
   *
   * Previously this waited for the server, because the route it navigates to is built from the
   * returned group id — so with no signal the button spun and then failed. `create_group` has
   * accepted a client-supplied id since 0016 and simply was never given one; now the id is
   * minted here, the write is queued, and the navigation happens in the same frame.
   *
   * The idempotency key moves with it, from a ref on this screen into the outbox row. Same
   * guarantee, longer life: the ref died when the screen unmounted, and the queue can outlive
   * the screen by hours.
   */
  const create = (event: GestureResponderEvent) => {
    try {
      const groupId = queueCreateGroup({ name: name.trim(), memberProfileIds: members });
      offline.refresh();
      offline.sync();
      void queryClient.invalidateQueries({ queryKey: queryKeys.home() });
      rippleFrom(event, () => router.replace(`/group/${groupId}`));
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const ready = name.trim().length > 0;

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
        <BackChevron onPress={() => router.back()} />

        <View style={styles.titles}>
          <Text style={styles.eyebrow}>New group</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Name this group"
            placeholderTextColor={color.textGhost}
            autoFocus
            maxLength={60}
            accessibilityLabel="Group name"
            style={styles.nameInput}
          />
          <View style={styles.rule} />
        </View>

        <View style={styles.search}>
          <SearchField value={search} onChangeText={setSearch} placeholder="Search people" />
        </View>

        <Text style={styles.sectionTitle}>Who&rsquo;s in it</Text>

        {isLoading ? (
          <View style={styles.list}>
            <RowSkeleton count={4} />
          </View>
        ) : (
          <View style={styles.list}>
            {roster.map((p) => (
              <PersonPickRow
                key={p.id}
                name={p.display_name}
                avatarUrl={p.avatar_url}
                meta={p.is_placeholder ? 'Not on Chukta yet' : undefined}
                selected={members.includes(p.id)}
                onPress={() =>
                  setMembers((prev) =>
                    prev.includes(p.id) ? prev.filter((m) => m !== p.id) : [...prev, p.id],
                  )
                }
              />
            ))}

            {/* Always the last row. Previously this only appeared once you had typed a name
                matching nobody, so there was no visible way to add a person at all. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add someone who is not on Chukta"
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

            {/*
              * A roster that FAILED is not an empty roster, and the difference matters: "nobody
              * to add yet" would quietly tell somebody with twenty friends that they have none.
              *
              * Unlike the expense form, this does not take over the screen. Naming a group is
              * the only thing actually required here, and a group of one is legitimate — so the
              * screen stays usable and the list says why it is short.
              */}
            {error && !data ? (
              <Pressable accessibilityRole="button" onPress={() => void refetch()}>
                <Text style={styles.none}>
                  Couldn&rsquo;t load your people. Tap to try again — you can still name the
                  group and add them later.
                </Text>
              </Pressable>
            ) : roster.length === 0 ? (
              <Text style={styles.none}>
                Nobody to add yet — a group of one is fine, you can add people later.
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>

      <FooterBar>
        <GlassButton
          label="Create group"
          variant="primary"
          disabled={!ready}
          onPress={create}
        />
        <Text style={[styles.picked, !name.trim() ? styles.pickedPrompt : null]} numberOfLines={1}>
          {!name.trim()
            ? 'Give the group a name to continue'
            : members.length === 0
              ? 'Just you for now'
              : `You and ${members.length} ${members.length === 1 ? 'other' : 'others'}`}
        </Text>
      </FooterBar>

      <AddPersonSheet
        visible={addingPerson}
        onClose={() => setAddingPerson(false)}
        onAdded={onPersonAdded}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  titles: { marginTop: 14 },
  eyebrow: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  nameInput: {
    marginTop: 6,
    padding: 0,
    fontFamily: font.display,
    fontSize: 32,
    color: color.cream,
  },
  rule: { marginTop: 8, height: 1, backgroundColor: color.glassBorder },
  search: { marginTop: 22 },
  sectionTitle: {
    marginTop: 24,
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
  list: { marginTop: 11, gap: 9 },
  none: { fontFamily: font.light, fontSize: 13.5, lineHeight: 20, color: color.textMuted },
  inventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  inventLabel: { flex: 1, fontFamily: font.medium, fontSize: 14.5, color: color.creamWarm },
  picked: { textAlign: 'center', fontFamily: font.light, fontSize: 12.5, color: color.textFaint },
  // Gold, because it is the reason the button above it is dead — it has to be read, not
  // skimmed past as a caption.
  pickedPrompt: { fontFamily: font.regular, color: color.textHighlight },
});
