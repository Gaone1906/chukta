import { formatAmount, money } from '@hisaab/core';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton, GlassSurface, color, font, radius } from '@/design';
import { ScreenHeader } from '@/features/expenses/ScreenHeader';
import { EmptyState } from '@/features/home/EmptyState';
import { requeue } from '@/lib/offline/drain';
import { useOffline } from '@/lib/offline/OfflineProvider';
import { discard, type OutboxRow } from '@/lib/offline/outbox';
import { newId } from '@/lib/offline/writes';

/**
 * The writes that need a person.
 *
 * A conflict used to be something that could only happen while you were looking at it. Phase 5
 * put a sheet on the edit and expense-detail screens, and it worked because the write and its
 * refusal were the same tap.
 *
 * The outbox breaks that. A change made on a train can be refused four hours later, on a
 * screen that has not existed since. So conflicts need somewhere to *wait*, and this is it —
 * an inbox rather than a sheet. The banner at the bottom of every screen is what points here.
 *
 * The rule the whole phase rests on is enforced by the options offered: **no auto-merge on
 * money.** There is no "combine them" button, because combining an amount somebody else
 * changed with one you changed produces a number neither of you entered.
 */
export default function Pending() {
  const insets = useSafeAreaInsets();
  const { unresolved, counts, refresh, sync } = useOffline();

  const act = (fn: () => void) => {
    fn();
    refresh();
    sync();
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Waiting to sync" />

        {unresolved.length === 0 ? (
          <EmptyState
            title={counts.pending ? 'Nothing needs you' : 'Everything is synced'}
            body={
              counts.pending
                ? `${counts.pending} change${counts.pending === 1 ? '' : 's'} still on the way. They will go on their own as soon as there is a connection.`
                : 'Every change you have made has reached the server.'
            }
          />
        ) : (
          <>
            <Text style={styles.intro}>
              These could not be saved. Nothing was overwritten and nothing was lost — they are
              sitting here exactly as you entered them, waiting on you.
            </Text>

            <View style={styles.list}>
              {unresolved.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  onKeepMine={() =>
                    act(() =>
                      requeue(row.id, newId(), row.payload, serverRevision(row.serverSnapshot)),
                    )
                  }
                  onDiscard={() => act(() => discard(row.id))}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({
  row,
  onKeepMine,
  onDiscard,
}: {
  row: OutboxRow;
  onKeepMine: () => void;
  onDiscard: () => void;
}) {
  const conflict = row.status === 'conflict';
  const server = serverExpense(row.serverSnapshot);
  const deleted = wasDeleted(row.serverSnapshot);

  return (
    <GlassSurface radius={radius.card} elevation="glass" contentStyle={styles.card}>
      <Text style={styles.what}>{describe(row)}</Text>

      <Text style={styles.why}>
        {deleted
          ? 'Somebody deleted this while your change was queued. There is nothing left to save it onto.'
          : conflict
            ? 'Somebody else changed this while your change was queued, so it was not applied — theirs is untouched.'
            : row.lastError}
      </Text>

      {server ? (
        <View style={styles.snapshot}>
          <Text style={styles.snapshotLabel}>What it says now</Text>
          <Field name="Description" value={String(server.description ?? '—')} />
          <Field
            name="Amount"
            value={
              server.amount_minor != null
                ? formatAmount(money(BigInt(String(server.amount_minor)), 'INR'))
                : '—'
            }
          />
        </View>
      ) : null}

      <View style={styles.actions}>
        {/* Retrying is only offered when there is something to retry against. A delete has
            already won — that is the rule, not a limitation. */}
        {!deleted ? (
          <GlassButton
            label={conflict ? 'Apply mine anyway' : 'Try again'}
            variant="secondary"
            onPress={onKeepMine}
          />
        ) : null}
        <GlassButton
          label={conflict ? 'Keep theirs, drop mine' : 'Discard my change'}
          variant="ghost"
          onPress={onDiscard}
        />
      </View>
    </GlassSurface>
  );
}

function Field({ name, value }: { name: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldName}>{name}</Text>
      <Text style={styles.fieldValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function describe(row: OutboxRow): string {
  const payload = row.payload as { description?: string; name?: string; displayName?: string };
  switch (row.op) {
    case 'create_expense':
      return `Adding “${payload.description ?? 'an expense'}”`;
    case 'update_expense':
      return `Editing “${payload.description ?? 'an expense'}”`;
    case 'delete_expense':
      return 'Deleting an expense';
    case 'add_comment':
      return 'Posting a comment';
    case 'record_settlement':
      return 'Recording a settlement';
    case 'create_group':
      return `Creating “${payload.name ?? 'a group'}”`;
    case 'upsert_contact_profile':
      return `Adding ${payload.displayName ?? 'someone'}`;
  }
}

function snapshotOf(raw: unknown): { expense?: Record<string, unknown>; deleted?: boolean } | null {
  return raw && typeof raw === 'object' ? (raw as { expense?: Record<string, unknown> }) : null;
}

function serverExpense(raw: unknown): Record<string, unknown> | null {
  return snapshotOf(raw)?.expense ?? null;
}

function wasDeleted(raw: unknown): boolean {
  return snapshotOf(raw)?.deleted === true;
}

function serverRevision(raw: unknown): number | null {
  const revision = serverExpense(raw)?.revision;
  return revision == null ? null : Number(revision);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  intro: {
    marginTop: 18,
    marginBottom: 18,
    fontFamily: font.light,
    fontSize: 14,
    lineHeight: 21,
    color: color.textSecondary,
  },
  list: { gap: 14 },
  card: { padding: 18, gap: 12 },
  what: { fontFamily: font.medium, fontSize: 16, color: color.cream },
  why: { fontFamily: font.light, fontSize: 13.5, lineHeight: 20, color: color.textMuted },
  snapshot: {
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,.08)',
  },
  snapshotLabel: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
  field: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 14 },
  fieldName: { fontFamily: font.light, fontSize: 13.5, color: color.textMuted },
  fieldValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: font.medium,
    fontSize: 14.5,
    color: color.cream,
  },
  actions: { gap: 10, marginTop: 4 },
});
