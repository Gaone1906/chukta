import { formatAmount, money } from '@chukta/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { GlassButton, GlassSurface, Sheet, Toast, color, font, layout, radius } from '@/design';
import { useSession } from '@/features/auth/session';
import { ScreenHeader } from '@/features/expenses/ScreenHeader';
import { PersonPickRow } from '@/features/expenses/PickRow';
import { SearchField } from '@/features/expenses/SearchField';
import { EmptyState } from '@/features/home/EmptyState';
import { RowSkeleton } from '@/features/home/RowSkeleton';
import { EditFieldSheet } from '@/features/settings/EditFieldSheet';
import { Avatar } from '@/features/people/Avatar';
import {
  addGroupMembers,
  getGroupDetail,
  getHomeSummary,
  leaveGroup,
  removeGroupMember,
  renameGroup,
  type GroupMember,
} from '@/lib/api';
import { useOffline } from '@/lib/offline/OfflineProvider';
import { withPendingPeople } from '@/lib/offline/people';
import { newId } from '@/lib/offline/writes';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Group settings — rename, who is in it, and the way out.
 *
 * ---------------------------------------------------------------- why this screen exists
 *
 * `create_group` and `add_group_members` were the entire membership surface, and
 * `add_group_members` had **no call site anywhere in the app**. So a group was immutable the
 * moment it was made: a typo in the name was permanent, somebody added by mistake stayed, and
 * a flatmate who moved out could never leave. Migration 0034 added the writes; this is the door.
 *
 * ---------------------------------------------------------------- why these writes are NOT queued
 *
 * Everything that touches money goes through the outbox, because entering an expense has to
 * work on a train. These three deliberately do not, and it is not an oversight:
 *
 * - **Leaving and removing are refused when a balance is outstanding** (0034). That refusal is
 *   the *expected* outcome, not an edge case — and a queued write reports its refusal into the
 *   pending inbox minutes later, detached from the button that caused it. "Settle up first" is
 *   only useful said immediately, next to the thing it is about.
 * - All three are rare, deliberate, administrative acts. Nobody renames a group on a train.
 *
 * Same reasoning that already makes invite links and claim codes online-only.
 */
export default function GroupSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [removing, setRemoving] = useState<GroupMember | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const ping = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.group(id!),
    queryFn: () => getGroupDetail(id!),
    enabled: Boolean(id),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.group(id!) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.home() }),
    ]);
  };

  const me = data?.members.find((m) => m.profile_id === profile?.id) ?? null;
  const iAmOwner = me?.role === 'owner';

  const rename = useMutation({
    mutationFn: (name: string) => renameGroup(id!, name, newId()),
    onSuccess: async () => {
      setRenaming(false);
      await refresh();
    },
    onError: (e: Error) => {
      setRenaming(false);
      ping(e.message);
    },
  });

  const add = useMutation({
    mutationFn: (profileIds: string[]) => addGroupMembers(id!, profileIds, newId()),
    onSuccess: async (result) => {
      setAdding(false);
      await refresh();
      ping(result.added === 1 ? 'Added them.' : `Added ${result.added} people.`);
    },
    onError: (e: Error) => {
      setAdding(false);
      ping(e.message);
    },
  });

  const remove = useMutation({
    mutationFn: (member: GroupMember) => removeGroupMember(id!, member.profile_id, newId()),
    onSuccess: async () => {
      setRemoving(null);
      await refresh();
    },
    onError: (e: Error) => {
      setRemoving(null);
      ping(e.message);
    },
  });

  const leave = useMutation({
    mutationFn: () => leaveGroup(id!, newId()),
    onSuccess: async () => {
      setConfirmLeave(false);
      await refresh();
      // Unwind past the group screen too: the user is no longer in it, so going "back" to it
      // would land on a screen that now refuses to load.
      router.dismissTo('/');
    },
    onError: (e: Error) => {
      setConfirmLeave(false);
      ping(e.message);
    },
  });

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Group settings" subtitle={data?.group.name} />

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
            <GlassSurface radius={radius.card} elevation="glass" style={styles.block}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Rename this group, currently ${data.group.name}`}
                onPress={() => setRenaming(true)}
                style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
              >
                <Text style={styles.rowLabel}>Name</Text>
                <Text style={styles.rowValue} numberOfLines={1}>
                  {data.group.name}
                </Text>
                <Chevron />
              </Pressable>
            </GlassSurface>

            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>
                {data.members.length} {data.members.length === 1 ? 'member' : 'members'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add people to this group"
                hitSlop={8}
                onPress={() => setAdding(true)}
              >
                <Text style={styles.addLabel}>Add people</Text>
              </Pressable>
            </View>

            <View style={styles.members}>
              {data.members.map((m) => (
                <MemberRow
                  key={m.profile_id}
                  member={m}
                  isMe={m.profile_id === profile?.id}
                  /*
                   * The remove affordance is hidden rather than disabled when it would be
                   * refused — for a non-owner, and for yourself. Migration 0035 added `role`
                   * to `get_group_detail` precisely so this decision can be made here instead
                   * of by pressing a button and reading a 42501.
                   *
                   * A member who is mid-debt still shows the control: that refusal depends on
                   * live balances and carries a message worth reading ("settle up first"),
                   * which is different from an action the user simply may not perform.
                   */
                  canRemove={iAmOwner && m.profile_id !== profile?.id}
                  onRemove={() => setRemoving(m)}
                />
              ))}
            </View>

            <GlassButton
              label={leave.isPending ? 'Leaving…' : 'Leave this group'}
              variant="secondary"
              disabled={leave.isPending}
              onPress={() => setConfirmLeave(true)}
              style={styles.leave}
            />
            <Text style={styles.leaveHint}>
              You can only leave once you&rsquo;re square — anything you still owe or are owed
              here has to be settled first.
            </Text>
          </>
        )}
      </ScrollView>

      <EditFieldSheet
        visible={renaming}
        title="Group name"
        hint="What everyone sees this group called."
        initialValue={data?.group.name ?? ''}
        placeholder="Goa, finally"
        maxLength={60}
        saving={rename.isPending}
        autoCapitalize="sentences"
        validate={(v) => (v.trim().length === 0 ? 'Give it a name.' : null)}
        onClose={() => setRenaming(false)}
        onSave={(v) => rename.mutate(v.trim())}
      />

      <AddPeopleSheet
        visible={adding}
        alreadyIn={data?.members.map((m) => m.profile_id) ?? []}
        saving={add.isPending}
        onClose={() => setAdding(false)}
        onAdd={(ids) => add.mutate(ids)}
      />

      <Sheet
        visible={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.display_name ?? ''}?`}
        subtitle="They stay on every expense they were already part of — this only takes them off the group."
        footer={
          <View style={styles.actions}>
            <GlassButton
              label={remove.isPending ? 'Removing…' : 'Remove'}
              variant="primary"
              disabled={remove.isPending}
              onPress={() => removing && remove.mutate(removing)}
            />
            <GlassButton label="Keep them" variant="ghost" onPress={() => setRemoving(null)} />
          </View>
        }
      />

      <Sheet
        visible={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Leave this group?"
        subtitle="Expenses you were part of stay exactly as they are. You just stop seeing the group."
        footer={
          <View style={styles.actions}>
            <GlassButton
              label={leave.isPending ? 'Leaving…' : 'Leave'}
              variant="primary"
              disabled={leave.isPending}
              onPress={() => leave.mutate()}
            />
            <GlassButton label="Stay" variant="ghost" onPress={() => setConfirmLeave(false)} />
          </View>
        }
      />

      <Toast message={toast} />
    </View>
  );
}

function MemberRow({
  member,
  isMe,
  canRemove,
  onRemove,
}: {
  member: GroupMember;
  isMe: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const settled = member.net_minor === 0n;
  const owed = member.net_minor > 0n;

  return (
    <GlassSurface radius={radius.cardCompact} contentStyle={styles.member}>
      <Avatar name={member.display_name} url={member.avatar_url} size={36} tone="plain" />

      <View style={styles.memberText}>
        <Text style={styles.memberName} numberOfLines={1}>
          {isMe ? 'You' : member.display_name}
          {member.role === 'owner' ? <Text style={styles.ownerTag}>  owner</Text> : null}
        </Text>
        <Text style={styles.memberMeta} numberOfLines={1}>
          {member.is_placeholder
            ? 'Not on Chukta yet'
            : settled
              ? 'All square'
              : `${owed ? 'is owed' : 'owes'} ${formatAmount(
                  money(member.net_minor < 0n ? -member.net_minor : member.net_minor, 'INR'),
                )}`}
        </Text>
      </View>

      {canRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${member.display_name} from this group`}
          hitSlop={10}
          onPress={onRemove}
          style={styles.removeButton}
        >
          <Svg width={12} height={12} viewBox="0 0 12 12" fill="none">
            <Path
              d="M1.5 1.5l9 9M10.5 1.5l-9 9"
              stroke={color.textMuted}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          </Svg>
        </Pressable>
      ) : null}
    </GlassSurface>
  );
}

/**
 * Pick people already known to you and add them.
 *
 * Reuses the home summary rather than a directory search, for the same reason the expense
 * picker does: there is no people-search endpoint on purpose, because one would double as a
 * probe for who is on Chukta.
 */
function AddPeopleSheet({
  visible,
  alreadyIn,
  saving,
  onClose,
  onAdd,
}: {
  visible: boolean;
  alreadyIn: string[];
  saving: boolean;
  onClose: () => void;
  onAdd: (profileIds: string[]) => void;
}) {
  if (!visible) return null;
  return <AddPeopleBody alreadyIn={alreadyIn} saving={saving} onClose={onClose} onAdd={onAdd} />;
}

function AddPeopleBody({
  alreadyIn,
  saving,
  onClose,
  onAdd,
}: {
  alreadyIn: string[];
  saving: boolean;
  onClose: () => void;
  onAdd: (profileIds: string[]) => void;
}) {
  const offline = useOffline();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const { data } = useQuery({ queryKey: queryKeys.home(), queryFn: getHomeSummary });

  const term = search.trim().toLowerCase();
  const folks = useMemo(
    () =>
      withPendingPeople(data?.people ?? [], offline.pendingPeople, offline.effects)
        .filter((p) => !alreadyIn.includes(p.id))
        .filter((p) => !term || p.display_name.toLowerCase().includes(term)),
    [data, term, alreadyIn, offline.pendingPeople, offline.effects],
  );

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Add people"
      subtitle="Anyone you already share expenses with."
      footer={
        <GlassButton
          label={saving ? 'Adding…' : picked.length === 0 ? 'Pick someone' : `Add ${picked.length}`}
          variant="primary"
          disabled={saving || picked.length === 0}
          onPress={() => onAdd(picked)}
        />
      }
    >
      <View style={styles.search}>
        <SearchField value={search} onChangeText={setSearch} placeholder="Search people" />
      </View>

      {folks.length === 0 ? (
        <Text style={styles.none}>
          {term
            ? 'Nobody by that name.'
            : 'Everyone you know is already in this group. Add someone new from the expense picker first.'}
        </Text>
      ) : (
        <View style={styles.pickList}>
          {folks.map((p) => (
            <PersonPickRow
              key={p.id}
              name={p.display_name}
              avatarUrl={p.avatar_url}
              meta={p.is_placeholder ? 'Not on Chukta yet' : undefined}
              selected={picked.includes(p.id)}
              onPress={() =>
                setPicked((prev) =>
                  prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                )
              }
            />
          ))}
        </View>
      )}
    </Sheet>
  );
}

const Chevron = () => (
  <Svg width={7} height={12} viewBox="0 0 7 12" fill="none">
    <Path
      d="M1.5 1l4 5-4 5"
      stroke="rgba(255,255,255,.28)"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  loading: { marginTop: 20 },
  block: { marginTop: 18, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 17 },
  rowPressed: { backgroundColor: 'rgba(255,255,255,.06)' },
  rowLabel: { fontFamily: font.regular, fontSize: 15.5, color: 'rgba(244,237,228,.85)' },
  rowValue: { flex: 1, textAlign: 'right', fontFamily: font.light, fontSize: 15, color: color.textMuted },

  sectionHead: {
    marginTop: 26,
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
  addLabel: { fontFamily: font.medium, fontSize: 13, color: color.creamWarm },

  members: { marginTop: 11, gap: 9 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14 },
  memberText: { flex: 1, gap: 2 },
  memberName: { fontFamily: font.medium, fontSize: 15, color: color.cream },
  ownerTag: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  memberMeta: { fontFamily: font.light, fontSize: 12.5, color: color.textMuted },
  // Bounds, not padding: a 12pt glyph with `padding: 6` is a 24pt target, which is what a
  // scanner measures and what a shaky thumb has to hit.
  removeButton: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },

  leave: { marginTop: 30 },
  leaveHint: {
    marginTop: 10,
    textAlign: 'center',
    fontFamily: font.light,
    fontSize: 12.5,
    lineHeight: 19,
    color: color.textFaint,
  },

  search: { marginBottom: 14 },
  pickList: { gap: 9 },
  none: { fontFamily: font.light, fontSize: 13.5, lineHeight: 20, color: color.textMuted },
  actions: { gap: 8 },
});
