import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton, Toast, color, font } from '@/design';
import { useSession } from '@/features/auth/session';
import { ConflictSheet } from '@/features/expenses/ConflictSheet';
import { DateSheet, describeDate } from '@/features/expenses/DateSheet';
import { AmountField, DisclosureRow, TextField } from '@/features/expenses/fields';
import { FOOTER_CLEARANCE, FooterBar } from '@/features/expenses/FooterBar';
import { PayerSheet, type Participant } from '@/features/expenses/PayerSheet';
import { ScreenHeader } from '@/features/expenses/ScreenHeader';
import { SplitEditor } from '@/features/expenses/SplitEditor';
import { useExpenseForm } from '@/features/expenses/useExpenseForm';
import { EmptyState } from '@/features/home/EmptyState';
import { RowSkeleton } from '@/features/home/RowSkeleton';
import { getExpenseDetail, getGroupDetail, newMutationId, updateExpense } from '@/lib/api';
import { afterExpenseChange, queryKeys } from '@/lib/queryKeys';

/**
 * Editing an expense.
 *
 * The same form as `new`, seeded from the server and saved with `expected_revision`. That
 * revision is the whole point: two people editing the same expense from two phones is
 * routine, and the write refuses rather than clobbers — see ConflictSheet for what the user
 * sees when it does.
 *
 * A separate route rather than a mode on `new` because the two differ in what they may
 * change: an edit cannot move an expense between groups or promote it into a new one, since
 * both would rewrite balances for people who are not on this screen.
 */
export default function EditExpense() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [dateOpen, setDateOpen] = useState(false);
  const [payerOpen, setPayerOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const mutationId = useRef(newMutationId());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.expense(id!),
    queryFn: () => getExpenseDetail(id!),
    enabled: Boolean(id),
  });

  const groupId = data?.expense.group_id ?? null;

  // A group expense can add anyone already in the group, so the roster is the group's members
  // rather than only the people currently on the expense.
  const groupQuery = useQuery({
    queryKey: queryKeys.group(groupId!),
    queryFn: () => getGroupDetail(groupId!),
    enabled: Boolean(groupId),
  });

  const participants: Participant[] = useMemo(() => {
    const name = (pid: string, fallback: string) => (pid === profile?.id ? 'You' : fallback);

    if (groupId && groupQuery.data) {
      return groupQuery.data.members.map((m) => ({
        id: m.profile_id,
        name: name(m.profile_id, m.display_name),
        avatarUrl: m.avatar_url,
      }));
    }

    // Union of payers and splits: someone can have paid without owing a share.
    const seen = new Map<string, Participant>();
    for (const s of data?.splits ?? []) {
      seen.set(s.profile_id, {
        id: s.profile_id,
        name: name(s.profile_id, s.display_name),
        avatarUrl: s.avatar_url,
      });
    }
    for (const p of data?.payers ?? []) {
      if (!seen.has(p.profile_id)) {
        seen.set(p.profile_id, {
          id: p.profile_id,
          name: name(p.profile_id, p.display_name),
          avatarUrl: p.avatar_url,
        });
      }
    }
    return [...seen.values()];
  }, [data, groupId, groupQuery.data, profile]);

  const seed = useMemo(
    () =>
      data
        ? {
            description: data.expense.description,
            amountMinor: data.expense.amount_minor,
            spentOn: data.expense.spent_on,
            splitType: data.expense.split_type,
            payers: data.payers.map((p) => ({
              profileId: p.profile_id,
              paidAmountMinor: p.paid_amount_minor,
            })),
            splits: data.splits.map((s) => ({
              profileId: s.profile_id,
              shareAmountMinor: s.share_amount_minor,
              weight: s.weight,
            })),
          }
        : undefined,
    [data],
  );

  // Keyed on the loaded expense so the form is constructed once the seed exists rather than
  // being reset into it afterwards — hooks cannot re-initialise their own state.
  if (error) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 14, paddingHorizontal: 22 }]}>
        <ScreenHeader title="Edit" />
        <EmptyState
          title="Couldn't load this expense"
          body={(error as Error).message}
          actionLabel="Try again"
          onAction={() => void refetch()}
        />
      </View>
    );
  }

  if (isLoading || !data || !seed || participants.length === 0) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 14, paddingHorizontal: 22 }]}>
        <ScreenHeader title="Edit" />
        <View style={styles.loading}>
          <RowSkeleton count={3} />
        </View>
      </View>
    );
  }

  return (
    <EditForm
      key={`${data.expense.id}:${data.expense.revision}`}
      expenseId={id!}
      revision={data.expense.revision}
      groupId={groupId}
      groupName={data.expense.group_name}
      participants={participants}
      meId={profile?.id ?? null}
      seed={seed}
      mutationIdRef={mutationId}
      onSaved={async () => {
        await Promise.all(
          afterExpenseChange(groupId).map((key) =>
            queryClient.invalidateQueries({ queryKey: key }),
          ),
        );
        router.back();
      }}
      onError={setToast}
      dateOpen={dateOpen}
      setDateOpen={setDateOpen}
      payerOpen={payerOpen}
      setPayerOpen={setPayerOpen}
      toast={toast}
      onReloadAfterConflict={async () => {
        // A conflict means our revision is stale. Refetch, and the key above rebuilds the form
        // against the server's version rather than leaving the user editing a ghost.
        mutationId.current = newMutationId();
        await refetch();
      }}
      insetTop={insets.top + 14}
      insetBottom={insets.bottom}
    />
  );
}

function EditForm({
  expenseId,
  revision,
  groupId,
  groupName,
  participants,
  meId,
  seed,
  mutationIdRef,
  onSaved,
  onError,
  onReloadAfterConflict,
  dateOpen,
  setDateOpen,
  payerOpen,
  setPayerOpen,
  toast,
  insetTop,
  insetBottom,
}: {
  expenseId: string;
  revision: number;
  groupId: string | null;
  groupName: string | null;
  participants: Participant[];
  meId: string | null;
  seed: Parameters<typeof useExpenseForm>[2];
  mutationIdRef: { current: string };
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
  onReloadAfterConflict: () => Promise<void>;
  dateOpen: boolean;
  setDateOpen: (open: boolean) => void;
  payerOpen: boolean;
  setPayerOpen: (open: boolean) => void;
  toast: string | null;
  insetTop: number;
  insetBottom: number;
}) {
  const form = useExpenseForm(participants, meId, seed);

  const save = useMutation({
    mutationFn: () =>
      updateExpense(expenseId, form.toDraft({ groupId }), revision, mutationIdRef.current),
    onSuccess: onSaved,
    onError: (e: Error) => {
      // Conflicts get the diff sheet; everything else is a toast.
      if (e.name !== 'ConflictError') onError(e.message);
    },
  });

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insetTop, paddingBottom: insetBottom + FOOTER_CLEARANCE },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Edit expense" subtitle={groupName ?? 'One-off'} />

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
            value={
              form.payers.length > 1
                ? `${form.payers.length} people`
                : (participants.find((p) => p.id === form.payers[0]?.profileId)?.name ?? 'Nobody')
            }
            onPress={() => setPayerOpen(true)}
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
      </ScrollView>

      <FooterBar>
        {form.netZeroWarning ? (
          <Text style={styles.footerWarning}>{form.netZeroWarning}</Text>
        ) : null}
        <GlassButton
          label={save.isPending ? 'Saving…' : 'Save changes'}
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

      <ConflictSheet
        error={save.error}
        onClose={() => save.reset()}
        onReload={async () => {
          save.reset();
          await onReloadAfterConflict();
        }}
      />

      <Toast message={toast} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  loading: { marginTop: 26 },
  form: { marginTop: 22, gap: 12 },
  fieldError: { fontFamily: font.light, fontSize: 12.5, color: color.creamRose },
  // Gold rather than rose — a caution, not a rejection. Same treatment as the new-expense form.
  footerWarning: {
    fontFamily: font.light,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    color: color.textHighlight,
  },
});
