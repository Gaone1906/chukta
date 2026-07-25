import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton, Toast, color, font } from '@/design';
import { useSession } from '@/features/auth/session';
import { DateSheet, describeDate } from '@/features/expenses/DateSheet';
import { AmountField, DisclosureRow, TextField } from '@/features/expenses/fields';
import { FOOTER_CLEARANCE, FooterBar } from '@/features/expenses/FooterBar';
import { PayerSheet, type Participant } from '@/features/expenses/PayerSheet';
import { SplitEditor } from '@/features/expenses/SplitEditor';
import { useExpenseForm } from '@/features/expenses/useExpenseForm';
import { Avatar } from '@/features/people/Avatar';
import { BackChevron } from '@/features/onboarding/BackChevron';
import { RowSkeleton } from '@/features/home/RowSkeleton';
import { createExpense, getGroupDetail, getHomeSummary, newMutationId } from '@/lib/api';
import { afterExpenseChange, queryKeys } from '@/lib/queryKeys';

/**
 * The expense form — one screen, three entry points.
 *
 * Ported from design-reference/screens/Hisaab Expense Form.dc.html, with everything below the
 * split tabs written rather than ported: the prototype has no editable per-person fields and
 * fabricates its distribution.
 *
 *   /expense/new?groupId=…            from a group — members pre-filled, group fixed
 *   /expense/new?withProfileIds=a,b   from the picker or a person — a one-off, namable
 *
 * Naming the optional group field promotes the participant set into a real group. Leaving it
 * blank keeps the expense a one-off, which is why `expenses.group_id` is nullable.
 */
export default function NewExpense() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile } = useSession();

  const { groupId, withProfileIds, fromPicker } = useLocalSearchParams<{
    groupId?: string;
    withProfileIds?: string;
    fromPicker?: string;
  }>();

  const wantedIds = useMemo(
    () => (withProfileIds ? withProfileIds.split(',').filter(Boolean) : []),
    [withProfileIds],
  );

  // A group entry point reads the members; an ad-hoc one reads the names out of the home
  // summary, which is already in cache from whichever screen the FAB was tapped on.
  const groupQuery = useQuery({
    queryKey: queryKeys.group(groupId!),
    queryFn: () => getGroupDetail(groupId!),
    enabled: Boolean(groupId),
  });
  const homeQuery = useQuery({
    queryKey: queryKeys.home(),
    queryFn: getHomeSummary,
    enabled: !groupId,
  });

  const participants: Participant[] = useMemo(() => {
    // No profile yet means no list at all, rather than a list without you in it. Every entry
    // point puts the signed-in person on the expense, so half a roster is wrong rather than
    // incomplete — and the screen below waits for this the same way it waits for the query.
    if (!profile) return [];

    const me: Participant = {
      id: profile.id,
      name: 'You',
      avatarUrl: profile.avatar_url,
    };

    if (groupId) {
      const members = groupQuery.data?.members ?? [];
      return members.map((m) =>
        m.profile_id === profile.id
          ? me
          : { id: m.profile_id, name: m.display_name, avatarUrl: m.avatar_url },
      );
    }

    const known = homeQuery.data?.people ?? [];
    const others = wantedIds
      // The picker can hand back your own id; you are already `me`.
      .filter((id) => id !== profile.id)
      .map((id) => {
        const person = known.find((p) => p.id === id);
        return {
          id,
          name: person?.display_name ?? 'Someone',
          avatarUrl: person?.avatar_url ?? null,
        };
      });
    return [me, ...others];
  }, [groupId, groupQuery.data, homeQuery.data, wantedIds, profile]);

  const form = useExpenseForm(participants, profile?.id ?? null);

  const [dateOpen, setDateOpen] = useState(false);
  const [payerOpen, setPayerOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const mutationId = useRef(newMutationId());

  const save = useMutation({
    mutationFn: () =>
      createExpense(
        form.toDraft({
          groupId: groupId ?? null,
          newGroupMemberIds: groupId ? undefined : participants.map((p) => p.id),
        }),
        mutationId.current,
      ),
    onSuccess: async (result) => {
      await Promise.all(
        afterExpenseChange(result.group_id).map((key) =>
          queryClient.invalidateQueries({ queryKey: key }),
        ),
      );
      // Unwind the whole flow rather than pushing: a save is the end of it, and the screen
      // the user lands on must already show the balance that just moved.
      if (fromPicker === '1') {
        // Home -> picker -> form: unwind both, so Home is what they see.
        router.dismissTo('/');
      } else {
        // Group or person FAB: one step back is the screen the expense belongs to.
        router.back();
      }
    },
    onError: (e: Error) => setToast(e.message),
  });

  const loading = !profile || (groupId ? groupQuery.isLoading : homeQuery.isLoading);
  const payerLabel = describePayers(form.payers, participants);

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
        <View style={styles.topRow}>
          <BackChevron onPress={() => router.back()} />
          {/* The avatar stack is the answer to "who is this between" without a sentence. */}
          <View style={styles.stack}>
            {participants.slice(0, 4).map((p, i) => (
              <View key={p.id} style={[styles.stackItem, i > 0 ? styles.stackOverlap : null]}>
                <Avatar name={p.name} url={p.avatarUrl} size={34} tone="plain" />
              </View>
            ))}
            {participants.length > 4 ? (
              <Text style={styles.stackMore}>+{participants.length - 4}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.titles}>
          <Text style={styles.eyebrow}>
            {groupId ? 'New expense in' : participants.length > 2 ? 'New expense' : 'New expense with'}
          </Text>

          {groupId ? (
            <Text style={styles.heading} numberOfLines={1}>
              {groupQuery.data?.group.name ?? '…'}
            </Text>
          ) : participants.length === 2 ? (
            <Text style={styles.heading} numberOfLines={1}>
              {participants.find((p) => p.id !== profile?.id)?.name ?? 'Someone'}
            </Text>
          ) : null}

          {/* Only the ad-hoc entry point can name a group — a group expense already has one. */}
          {!groupId ? (
            <View style={styles.namable}>
              <TextInput
                value={form.groupName}
                onChangeText={form.setGroupName}
                placeholder="Name this group"
                placeholderTextColor={color.textGhost}
                maxLength={60}
                accessibilityLabel="Group name, optional"
                style={styles.groupNameInput}
              />
              <Text style={styles.nameHelp}>
                {form.groupName.trim()
                  ? `Keeps these ${participants.length} together as a group.`
                  : 'Optional — leave it blank and this stays a one-off.'}
              </Text>
            </View>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.loading}>
            <RowSkeleton count={3} />
          </View>
        ) : (
          <View style={styles.form}>
            <AmountField
              value={form.amountText}
              onChangeText={form.setAmountText}
              error={form.amountError}
            />

            <TextField
              value={form.description}
              onChangeText={form.setDescription}
              placeholder="What's this for?"
              maxLength={120}
            />

            <DisclosureRow
              label="Date"
              value={describeDate(form.spentOn)}
              onPress={() => setDateOpen(true)}
            />

            <DisclosureRow
              label="Who paid"
              value={payerLabel}
              onPress={() => {
                if (form.amountMinor <= 0n) {
                  setToast('Enter the amount first — payers are shares of it.');
                  return;
                }
                setPayerOpen(true);
              }}
            />

            {form.payerError ? <Text style={styles.fieldError}>{form.payerError}</Text> : null}

            <SplitEditor
              state={form.split}
              onChange={form.setSplit}
              participants={participants}
              totalMinor={form.amountMinor}
              shares={form.shares}
              error={form.splitError}
            />
          </View>
        )}
      </ScrollView>

      <FooterBar>
        {form.netZeroWarning ? (
          <Text style={styles.footerWarning}>{form.netZeroWarning}</Text>
        ) : null}
        <GlassButton
          label={save.isPending ? 'Saving…' : 'Save expense'}
          variant="primary"
          disabled={!form.ready || save.isPending}
          onPress={() => save.mutate()}
        />
      </FooterBar>

      <DateSheet
        visible={dateOpen}
        value={form.spentOn}
        onClose={() => setDateOpen(false)}
        onPick={form.setSpentOn}
      />

      <PayerSheet
        visible={payerOpen}
        onClose={() => setPayerOpen(false)}
        participants={participants}
        totalMinor={form.amountMinor}
        payers={form.payers}
        onChange={form.setPayers}
      />

      <Toast message={toast} />
    </KeyboardAvoidingView>
  );
}

function describePayers(
  payers: { profileId: string; paidAmountMinor: bigint }[],
  participants: Participant[],
): string {
  if (payers.length === 0) return 'Nobody yet';
  if (payers.length > 1) return `${payers.length} people`;
  return participants.find((p) => p.id === payers[0]!.profileId)?.name ?? 'Someone';
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stack: { flexDirection: 'row', alignItems: 'center' },
  stackItem: { borderRadius: 17 },
  stackOverlap: { marginLeft: -11 },
  stackMore: { marginLeft: 8, fontFamily: font.light, fontSize: 12.5, color: color.textFaint },
  titles: { marginTop: 16, gap: 4 },
  eyebrow: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  heading: { fontFamily: font.display, fontSize: 32, color: color.cream },
  namable: { marginTop: 4 },
  groupNameInput: {
    padding: 0,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: color.glassBorder,
    fontFamily: font.display,
    fontSize: 28,
    color: color.cream,
  },
  nameHelp: { marginTop: 7, fontFamily: font.light, fontSize: 12.5, color: color.textFaint },
  loading: { marginTop: 26 },
  form: { marginTop: 22, gap: 12 },
  fieldError: { fontFamily: font.light, fontSize: 12.5, color: color.creamRose },
  // Gold rather than rose: this is worth reading before pressing Save, but it is not an error
  // and the expense is allowed to be saved exactly as it stands.
  footerWarning: {
    fontFamily: font.light,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    color: color.textHighlight,
  },
});
