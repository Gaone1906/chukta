import { formatAmount, money, parseAmount, toAmountInput } from '@hisaab/core';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { GlassButton, GlassSurface, SegmentedSwitcher, Sheet, color, font, radius } from '@/design';
import { Avatar } from '@/features/people/Avatar';

export interface Participant {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export interface Payer {
  profileId: string;
  paidAmountMinor: bigint;
}

/**
 * "Who paid" — single payer by default, several with explicit amounts when needed.
 *
 * The design row toasts "demo only", so this is new. Multi-payer is not a nicety: it is how
 * one person covers the hotel and another the cab on the same receipt, and modelling it as two
 * separate expenses gets the balances right but the history wrong.
 *
 * The sheet edits a draft and only commits on Done — half-entered payer amounts must never
 * reach the form, where they would make the split preview flicker between invalid states.
 */
export function PayerSheet(props: {
  visible: boolean;
  onClose: () => void;
  participants: Participant[];
  totalMinor: bigint;
  payers: Payer[];
  onChange: (payers: Payer[]) => void;
}) {
  // The body is only mounted while the sheet is open, and its draft state is seeded from
  // props on mount. That is what makes Cancel actually discard — closing unmounts the draft
  // — and it avoids re-seeding through an effect, which would fire a second render every
  // time the sheet opens.
  if (!props.visible) return null;
  return <PayerSheetBody {...props} />;
}

function PayerSheetBody({
  onClose,
  participants,
  totalMinor,
  payers,
  onChange,
}: {
  visible: boolean;
  onClose: () => void;
  participants: Participant[];
  totalMinor: bigint;
  payers: Payer[];
  onChange: (payers: Payer[]) => void;
}) {
  const [mode, setMode] = useState<'single' | 'multiple'>(
    payers.length > 1 ? 'multiple' : 'single',
  );
  const [single, setSingle] = useState<string | null>(payers[0]?.profileId ?? null);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(payers.map((p) => [p.profileId, toAmountInput(p.paidAmountMinor, 'INR')])),
  );

  const entered = participants.reduce((sum, p) => {
    const parsed = parseAmount(amounts[p.id] ?? '', 'INR');
    return sum + (parsed && parsed > 0n ? parsed : 0n);
  }, 0n);
  const remainder = totalMinor - entered;

  const valid = mode === 'single' ? Boolean(single) : entered === totalMinor && totalMinor > 0n;

  const commit = () => {
    if (mode === 'single') {
      if (!single) return;
      onChange([{ profileId: single, paidAmountMinor: totalMinor }]);
    } else {
      onChange(
        participants
          .map((p) => ({
            profileId: p.id,
            paidAmountMinor: parseAmount(amounts[p.id] ?? '', 'INR') ?? 0n,
          }))
          .filter((p) => p.paidAmountMinor > 0n),
      );
    }
    onClose();
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Who paid?"
      subtitle={
        mode === 'multiple'
          ? remainder === 0n
            ? 'Adds up exactly.'
            : remainder > 0n
              ? `${formatAmount(money(remainder, 'INR'))} still unaccounted for.`
              : `${formatAmount(money(-remainder, 'INR'))} more than the total.`
          : undefined
      }
      footer={<GlassButton label="Done" variant="primary" disabled={!valid} onPress={commit} />}
    >
      <SegmentedSwitcher
        options={[
          { value: 'single', label: 'One person' },
          { value: 'multiple', label: 'Several' },
        ]}
        value={mode}
        onChange={setMode}
      />

      <View style={styles.list}>
        {participants.map((p) => {
          const chosen = mode === 'single' && single === p.id;
          return (
            <Pressable
              key={p.id}
              accessibilityRole={mode === 'single' ? 'radio' : undefined}
              accessibilityState={mode === 'single' ? { checked: chosen } : undefined}
              accessibilityLabel={p.name}
              disabled={mode === 'multiple'}
              onPress={() => setSingle(p.id)}
            >
              <GlassSurface radius={radius.cardCompact} active={chosen} contentStyle={styles.row}>
                <Avatar name={p.name} url={p.avatarUrl} size={36} tone={chosen ? 'gold' : 'plain'} />
                <Text style={styles.name} numberOfLines={1}>
                  {p.name}
                </Text>

                {mode === 'single' ? (
                  <Text style={[styles.trailing, chosen ? styles.trailingOn : null]}>
                    {chosen ? formatAmount(money(totalMinor, 'INR')) : ''}
                  </Text>
                ) : (
                  <View style={styles.amountBox}>
                    <Text style={styles.rupee}>₹</Text>
                    <TextInput
                      value={amounts[p.id] ?? ''}
                      onChangeText={(text) => setAmounts((prev) => ({ ...prev, [p.id]: text }))}
                      placeholder="0"
                      placeholderTextColor={color.textGhost}
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      accessibilityLabel={`Amount paid by ${p.name}`}
                      style={styles.amountInput}
                    />
                  </View>
                )}
              </GlassSurface>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 16, gap: 9 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  name: { flex: 1, fontFamily: font.medium, fontSize: 15, color: color.cream },
  trailing: { fontFamily: font.semibold, fontSize: 14.5, color: color.textFaint },
  trailingOn: { color: color.textHighlight },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 96,
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  rupee: { fontFamily: font.light, fontSize: 14, color: color.textFaint },
  amountInput: {
    flex: 1,
    padding: 0,
    textAlign: 'right',
    fontFamily: font.semibold,
    fontSize: 15,
    color: color.cream,
  },
});
