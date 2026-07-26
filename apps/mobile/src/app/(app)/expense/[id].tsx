import { formatAmount, money } from '@chukta/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { GlassButton, GlassSurface, Sheet, Toast, color, font, layout, radius, useRippleNav } from '@/design';
import { useSession } from '@/features/auth/session';
import { describeDate } from '@/features/expenses/DateSheet';
import { ScreenHeader } from '@/features/expenses/ScreenHeader';
import { EmptyState } from '@/features/home/EmptyState';
import { RowSkeleton } from '@/features/home/RowSkeleton';
import { ReceiptStrip } from '@/features/expenses/ReceiptStrip';
import { Avatar } from '@/features/people/Avatar';
import { getExpenseDetail, type ExpenseDetail } from '@/lib/api';
import { isConflict } from '@/lib/errors';
import { useOffline } from '@/lib/offline/OfflineProvider';
import {
  queueComment,
  queueDeleteExpense,
  queueRestoreExpense,
  shapeFromDetail,
} from '@/lib/offline/writes';
import { afterExpenseChange, queryKeys } from '@/lib/queryKeys';

const SPLIT_LABEL: Record<ExpenseDetail['expense']['split_type'], string> = {
  equal: 'Split equally',
  exact: 'Exact amounts',
  percentage: 'By percentage',
  shares: 'By shares',
  itemized: 'Itemised',
};

/**
 * Expense detail.
 *
 * No design exists for this screen — every expense row in the prototypes toasts "demo only",
 * which made it the biggest hole in the design set. Composed here from the Phase 1 primitives
 * so it still reads as the same app.
 *
 * Structure follows the questions people actually open an expense to answer, in order:
 * what was it and how much · who paid · what do I owe · why is my share that number · what did
 * anyone say about it · has it been changed since.
 */
export default function ExpenseDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { rippleFrom } = useRippleNav();
  const queryClient = useQueryClient();
  const { profile } = useSession();
  const offline = useOffline();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [comment, setComment] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { data, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: queryKeys.expense(id!),
    queryFn: () => getExpenseDetail(id!),
    enabled: Boolean(id),
  });

  const invalidate = () =>
    Promise.all(
      afterExpenseChange(data?.expense.group_id).map((key) =>
        queryClient.invalidateQueries({ queryKey: key }),
      ),
    );

  /*
   * A comment was the one write in the app with no idempotency at all: it minted a fresh
   * mutation key inline on every call, so any retry would have posted it twice. That never
   * showed because nothing retried — an outbox retries by design, which is exactly the kind of
   * latent bug a queue turns into a real one. The key is now frozen in the row.
   */
  const post = (body: string) => {
    try {
      queueComment(id!, body);
      setComment('');
      offline.refresh();
      offline.sync();
      void queryClient.invalidateQueries({ queryKey: queryKeys.expense(id!) });
    } catch (err) {
      setToast((err as Error).message);
    }
  };

  /*
   * Deleting is queued like everything else, which moves where a conflict can surface.
   *
   * The refusal can arrive long after this screen is gone, so it lands in the pending inbox
   * (`/pending`) rather than in a sheet here — which is also why the sheet that used to live
   * here is gone. Same rule either way: **delete beats edit**, and nothing is merged.
   */
  const remove = () => {
    if (!data || !profile) return;
    try {
      queueDeleteExpense(
        profile.id,
        id!,
        shapeFromDetail(data),
        data.expense.revision,
      );
      setConfirmDelete(false);
      offline.refresh();
      offline.sync();
      void invalidate();
      router.back();
    } catch (err) {
      setConfirmDelete(false);
      if (!isConflict(err)) setToast((err as Error).message);
    }
  };

  /*
   * Restore, queued like every other write.
   *
   * Stays on this screen rather than navigating: the user is looking at the expense they just
   * brought back, and the banner above disappearing is the confirmation. `remove` goes back
   * because the thing it acted on is gone; this one's subject is still here.
   */
  const restore = () => {
    if (!data || !profile) return;
    setRestoring(true);
    try {
      queueRestoreExpense(profile.id, id!, shapeFromDetail(data));
      offline.refresh();
      offline.sync();
      void invalidate();
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setRestoring(false);
    }
  };

  const e = data?.expense;
  const net = data ? data.my_paid_minor - data.my_share_minor : 0n;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 90 },
        ]}
        keyboardShouldPersistTaps="handled"
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
          title={e?.description ?? 'Expense'}
          subtitle={e ? `${e.group_name ?? 'One-off'} · ${describeDate(e.spent_on)}` : undefined}
          action={
            e && !e.deleted_at ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit this expense"
                hitSlop={10}
                onPress={(ev) =>
                  rippleFrom(ev, () =>
                    router.push({ pathname: '/expense/edit', params: { id: id! } }),
                  )
                }
                style={styles.editButton}
              >
                <Text style={styles.editLabel}>Edit</Text>
              </Pressable>
            ) : undefined
          }
        />

        {error && !data ? (
          <EmptyState
            title="Couldn't load this expense"
            body={(error as Error).message}
            actionLabel="Try again"
            onAction={() => void refetch()}
          />
        ) : isLoading || !data || !e ? (
          <View style={styles.loading}>
            <RowSkeleton count={3} />
          </View>
        ) : (
          <>
            {e.deleted_at ? (
              <GlassSurface radius={radius.cardCompact} style={styles.deletedBannerSpacing} contentStyle={styles.deletedBanner}>
                <Text style={styles.deletedText}>
                  This expense was deleted. It no longer counts towards anyone&rsquo;s balance.
                </Text>
              </GlassSurface>
            ) : null}

            <GlassSurface radius={radius.panel} elevation="glass" style={styles.summarySpacing} contentStyle={styles.summary}>
              <Text style={styles.total}>{formatAmount(money(e.amount_minor, 'INR'))}</Text>
              <Text style={styles.splitType}>{SPLIT_LABEL[e.split_type]}</Text>

              <View style={styles.divider} />

              <View style={styles.netRow}>
                <Text style={styles.netLabel}>
                  {net > 0n ? "You're owed for this" : net < 0n ? 'You owe for this' : 'Your part'}
                </Text>
                <Text
                  style={[
                    styles.netAmount,
                    { color: net > 0n ? color.creamWarm : net < 0n ? color.creamRose : color.cream },
                  ]}
                >
                  {net === 0n
                    ? formatAmount(money(data.my_share_minor, 'INR'))
                    : formatAmount(money(net, 'INR'), { signed: false })}
                </Text>
              </View>
              <Text style={styles.netHelp}>
                You paid {formatAmount(money(data.my_paid_minor, 'INR'))} and your share is{' '}
                {formatAmount(money(data.my_share_minor, 'INR'))}.
              </Text>
            </GlassSurface>

            <Section title="Who paid">
              {data.payers.map((p) => (
                <PersonAmountRow
                  key={p.profile_id}
                  name={p.profile_id === profile?.id ? 'You' : p.display_name}
                  avatarUrl={p.avatar_url}
                  amount={p.paid_amount_minor}
                />
              ))}
            </Section>

            <Section title="How it splits">
              {data.splits.map((s) => (
                <PersonAmountRow
                  key={s.profile_id}
                  name={s.profile_id === profile?.id ? 'You' : s.display_name}
                  avatarUrl={s.avatar_url}
                  amount={s.share_amount_minor}
                  meta={
                    e.split_type === 'percentage' && s.weight != null
                      ? `${s.weight}%`
                      : e.split_type === 'shares' && s.weight != null
                        ? `${s.weight} ${s.weight === 1 ? 'share' : 'shares'}`
                        : undefined
                  }
                />
              ))}
            </Section>

            {data.items.length > 0 ? (
              <Section title="Lines">
                {data.items.map((item) => (
                  <GlassSurface key={item.id} radius={radius.cardCompact} contentStyle={styles.row}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {item.name}
                      {item.kind !== 'line' ? (
                        <Text style={styles.rowKind}> · {item.kind}</Text>
                      ) : null}
                    </Text>
                    <Text style={styles.rowAmount}>
                      {formatAmount(money(item.amount_minor, 'INR'))}
                    </Text>
                  </GlassSurface>
                ))}
              </Section>
            ) : null}

            {/* Above the comments, because a receipt is evidence about the expense and a
                comment is a conversation about it — the evidence should come first. */}
            <Section title="Receipts">
              <ReceiptStrip
                expenseId={id}
                groupId={data.expense.group_id}
                profileId={profile?.id ?? ''}
                receipts={data.receipts}
                canEdit={data.expense.deleted_at === null && Boolean(profile)}
                onError={setToast}
              />
              {data.receipts.length === 0 ? (
                <Text style={styles.quiet}>No receipt on this one.</Text>
              ) : null}
            </Section>

            <Section title="Comments">
              {data.comments.length === 0 ? (
                <Text style={styles.quiet}>Nothing said about this one yet.</Text>
              ) : (
                data.comments.map((c) => (
                  <View key={c.id} style={styles.comment}>
                    <Avatar name={c.display_name} url={c.avatar_url} size={30} tone="plain" />
                    <View style={styles.commentBody}>
                      <Text style={styles.commentAuthor}>
                        {c.author_profile_id === profile?.id ? 'You' : c.display_name}
                      </Text>
                      <Text style={styles.commentText}>{c.body}</Text>
                    </View>
                  </View>
                ))
              )}

              <GlassSurface radius={radius.pill} elevation="none" contentStyle={styles.composer}>
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder="Add a comment"
                  placeholderTextColor={color.textFaint}
                  maxLength={2000}
                  accessibilityLabel="Add a comment"
                  style={styles.composerInput}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Post comment"
                  hitSlop={8}
                  disabled={comment.trim().length === 0}
                  onPress={() => post(comment.trim())}
                  style={comment.trim().length === 0 ? styles.sendOff : undefined}
                >
                  <Svg width={17} height={15} viewBox="0 0 18 16" fill="none">
                    <Path
                      d="M1 8h15M10 2l6 6-6 6"
                      stroke={color.creamWarm}
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </Pressable>
              </GlassSurface>
            </Section>

            {data.history.length > 1 ? (
              <Section title="History">
                {data.history.map((h) => (
                  <View key={`${h.revision}-${h.action}`} style={styles.historyRow}>
                    <Text style={styles.historyText}>
                      {h.actor_profile_id === profile?.id ? 'You' : (h.display_name ?? 'Someone')}{' '}
                      {ACTION_VERB[h.action] ?? h.action} this
                    </Text>
                    <Text style={styles.historyMeta}>{describeDate(h.created_at.slice(0, 10))}</Text>
                  </View>
                ))}
              </Section>
            ) : null}

            {!e.deleted_at ? (
              <GlassButton
                label="Delete this expense"
                variant="secondary"
                onPress={() => setConfirmDelete(true)}
                style={styles.delete}
              />
            ) : (
              /*
               * The way back.
               *
               * `restore_expense` has existed on the server since Phase 3 and nothing in the app
               * ever called it, so deleting was one-way from the UI — on a screen where the
               * thing being deleted is somebody's money. No confirmation sheet: undoing a delete
               * is the safe direction, and putting a dialog in front of it would make recovering
               * from a mistake harder than making one.
               */
              <GlassButton
                label={restoring ? 'Putting it back…' : 'Restore this expense'}
                variant="primary"
                disabled={restoring}
                onPress={restore}
                style={styles.delete}
              />
            )}
          </>
        )}
      </ScrollView>

      <Sheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this expense?"
        subtitle="Everyone's balance moves back. It stays in the history, so this can be traced."
        footer={
          <View style={styles.confirmButtons}>
            <GlassButton
              label="Delete"
              variant="primary"

              onPress={remove}
            />
            <GlassButton
              label="Keep it"
              variant="secondary"
              onPress={() => setConfirmDelete(false)}
            />
          </View>
        }
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </KeyboardAvoidingView>
  );
}

const ACTION_VERB: Record<string, string> = {
  created: 'added',
  updated: 'edited',
  deleted: 'deleted',
  restored: 'restored',
  merged_participants: 'merged people on',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function PersonAmountRow({
  name,
  avatarUrl,
  amount,
  meta,
}: {
  name: string;
  avatarUrl: string | null;
  amount: bigint;
  meta?: string;
}) {
  return (
    <GlassSurface radius={radius.cardCompact} contentStyle={styles.row}>
      <Avatar name={name} url={avatarUrl} size={32} tone="plain" />
      <Text style={styles.rowName} numberOfLines={1}>
        {name}
      </Text>
      {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
      <Text style={styles.rowAmount}>{formatAmount(money(amount, 'INR'))}</Text>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  editButton: {
    paddingHorizontal: 14,
    minHeight: layout.touchTarget,
    justifyContent: 'center',
  },
  editLabel: { fontFamily: font.medium, fontSize: 15, color: color.creamWarm },
  loading: { marginTop: 24 },
  // Margin on `style`, not `contentStyle`. contentStyle lands on the inner view inside
  // GlassSurface, so a margin there pads the content and leaves the card itself flush
  // against whatever is above it.
  deletedBannerSpacing: { marginTop: 18 },
  deletedBanner: { padding: 15 },
  deletedText: { fontFamily: font.light, fontSize: 13.5, lineHeight: 20, color: color.creamRose },
  summarySpacing: { marginTop: 20 },
  summary: { padding: 20, gap: 6 },
  total: { fontFamily: font.semibold, fontSize: 38, color: color.textHighlight },
  splitType: { fontFamily: font.light, fontSize: 13, color: color.textMuted },
  divider: { marginVertical: 12, height: 1, backgroundColor: 'rgba(255,255,255,0.09)' },
  netRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  netLabel: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  netAmount: { fontFamily: font.semibold, fontSize: 22 },
  netHelp: { marginTop: 4, fontFamily: font.light, fontSize: 12.5, color: color.textFaint },
  section: { marginTop: 26 },
  sectionTitle: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
  sectionBody: { marginTop: 11, gap: 9 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  rowName: { flex: 1, fontFamily: font.medium, fontSize: 15, color: color.cream },
  rowKind: { fontFamily: font.light, fontSize: 12.5, color: color.textFaint },
  rowMeta: { fontFamily: font.light, fontSize: 12.5, color: color.textFaint },
  rowAmount: { fontFamily: font.semibold, fontSize: 15, color: color.textHighlight },
  quiet: { fontFamily: font.light, fontSize: 13.5, color: color.textMuted },
  comment: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  commentBody: { flex: 1, gap: 2 },
  commentAuthor: { fontFamily: font.medium, fontSize: 13.5, color: color.cream },
  commentText: { fontFamily: font.light, fontSize: 14, lineHeight: 20, color: color.textSecondary },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, height: 46 },
  composerInput: { flex: 1, padding: 0, fontFamily: font.regular, fontSize: 14.5, color: color.cream },
  sendOff: { opacity: 0.35 },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  historyText: { flex: 1, fontFamily: font.light, fontSize: 13.5, color: color.textSecondary },
  historyMeta: { fontFamily: font.light, fontSize: 12.5, color: color.textGhost },
  delete: { marginTop: 30 },
  confirmButtons: { gap: 10 },
});
