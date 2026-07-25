import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import Svg, { Path } from 'react-native-svg';

import { GlassButton, GlassSurface, Toast, color, font, radius } from '@/design';
import { FOOTER_CLEARANCE, FooterBar } from '@/features/expenses/FooterBar';
import { PersonPickRow } from '@/features/expenses/PickRow';
import { SearchField } from '@/features/expenses/SearchField';
import { RowSkeleton } from '@/features/home/RowSkeleton';
import { BackChevron } from '@/features/onboarding/BackChevron';
import { createGroup, getHomeSummary, newMutationId, upsertContactProfile } from '@/lib/api';
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

  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: queryKeys.home(), queryFn: getHomeSummary });

  const term = search.trim().toLowerCase();
  const roster = useMemo(
    () => (data?.people ?? []).filter((p) => !term || p.display_name.toLowerCase().includes(term)),
    [data, term],
  );
  const canInvent = term.length > 1 && !roster.some((p) => p.display_name.toLowerCase() === term);

  const invent = useMutation({
    mutationFn: () => upsertContactProfile(search.trim()),
    onSuccess: (profileId) => {
      setMembers((prev) => (prev.includes(profileId) ? prev : [...prev, profileId]));
      setSearch('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.home() });
    },
    onError: (e: Error) => setToast(e.message),
  });

  // One idempotency key for this screen, generated once and held across every attempt. The
  // case it exists for: the server commits, the response is lost, the user taps Create again.
  // A fresh uuid per tap would make that a second group; the same uuid makes it a no-op that
  // returns the original result.
  const mutationId = useRef(newMutationId());

  const create = useMutation({
    mutationFn: () =>
      createGroup({ name: name.trim(), memberProfileIds: members }, mutationId.current),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.home() });
      router.replace(`/group/${result.group_id}`);
    },
    onError: (e: Error) => setToast(e.message),
  });

  const ready = name.trim().length > 0 && !create.isPending;

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
                meta={p.is_placeholder ? 'Not on Hisaab yet' : undefined}
                selected={members.includes(p.id)}
                onPress={() =>
                  setMembers((prev) =>
                    prev.includes(p.id) ? prev.filter((m) => m !== p.id) : [...prev, p.id],
                  )
                }
              />
            ))}

            {canInvent ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add ${search.trim()} as someone new`}
                disabled={invent.isPending}
                onPress={() => invent.mutate()}
              >
                <GlassSurface radius={radius.cardCompact} contentStyle={styles.inventRow}>
                  {invent.isPending ? (
                    <ActivityIndicator size="small" color={color.goldBright} />
                  ) : (
                    <Svg width={13} height={13} viewBox="0 0 12 12" fill="none">
                      <Path
                        d="M6 1.6v8.8M1.6 6h8.8"
                        stroke={color.creamWarm}
                        strokeWidth={1.6}
                        strokeLinecap="round"
                      />
                    </Svg>
                  )}
                  <Text style={styles.inventLabel} numberOfLines={1}>
                    Add &ldquo;{search.trim()}&rdquo; as someone new
                  </Text>
                </GlassSurface>
              </Pressable>
            ) : null}

            {roster.length === 0 && !canInvent ? (
              <Text style={styles.none}>
                Nobody to add yet. Type a name above — a group of one is fine too, you can add
                people later.
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>

      <FooterBar>
        <GlassButton
          label={create.isPending ? 'Creating…' : 'Create group'}
          variant="primary"
          disabled={!ready}
          onPress={() => create.mutate()}
        />
        <Text style={styles.picked} numberOfLines={1}>
          {members.length === 0
            ? 'Just you for now'
            : `You and ${members.length} ${members.length === 1 ? 'other' : 'others'}`}
        </Text>
      </FooterBar>

      <Toast message={toast} />
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
});
