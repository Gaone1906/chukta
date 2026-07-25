import { formatAmount, money } from '@hisaab/core';
import { StyleSheet, Text, View } from 'react-native';

import { GlassButton, Sheet, color, font } from '@/design';
import { isConflict } from '@/lib/errors';
import { describeDate } from './DateSheet';

/**
 * What a `P0409` looks like to the user.
 *
 * Editing money is the one place where an automatic merge is unacceptable: if two people
 * changed the same expense, silently keeping "the latest" quietly rewrites someone's record of
 * what they paid. So the server refuses the write, hands back its current snapshot, and this
 * sheet shows what changed underneath — the only two ways out are to take the server's version
 * or to re-enter the edit against it.
 *
 * The `deleted` case is separate and simpler: delete beats edit, always. There is nothing to
 * merge into an expense that no longer exists.
 */
export function ConflictSheet({
  error,
  onClose,
  onReload,
}: {
  error: unknown;
  onClose: () => void;
  onReload: () => void | Promise<void>;
}) {
  if (!isConflict(error)) return null;

  const snapshot = error.serverSnapshot as
    | { expense?: Record<string, unknown>; deleted?: boolean }
    | null;
  const server = snapshot?.expense ?? null;

  return (
    <Sheet
      visible
      onClose={onClose}
      title={error.wasDeleted ? 'Someone deleted this' : 'Someone else edited this'}
      subtitle={
        error.wasDeleted
          ? 'It is gone, so there is nothing to save your change onto.'
          : 'Your change was not saved, so nothing of theirs was overwritten.'
      }
      footer={
        <GlassButton
          label={error.wasDeleted ? 'Go back' : 'Load their version'}
          variant="primary"
          onPress={() => void onReload()}
        />
      }
    >
      {server ? (
        <View style={styles.card}>
          <Text style={styles.label}>What it says now</Text>
          <Field name="Description" value={String(server.description ?? '—')} />
          <Field
            name="Amount"
            value={
              server.amount_minor != null
                ? formatAmount(money(BigInt(String(server.amount_minor)), 'INR'))
                : '—'
            }
          />
          <Field
            name="Date"
            value={server.spent_on ? describeDate(String(server.spent_on)) : '—'}
          />
          <Field name="Revision" value={String(server.revision ?? '—')} />
        </View>
      ) : (
        <Text style={styles.fallback}>
          The server did not say what changed. Reload and take another look before editing again.
        </Text>
      )}
    </Sheet>
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

const styles = StyleSheet.create({
  card: { gap: 10 },
  label: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
  field: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 14 },
  fieldName: { fontFamily: font.light, fontSize: 13.5, color: color.textMuted },
  fieldValue: { flex: 1, textAlign: 'right', fontFamily: font.medium, fontSize: 14.5, color: color.cream },
  fallback: { fontFamily: font.light, fontSize: 14, lineHeight: 21, color: color.textMuted },
});
