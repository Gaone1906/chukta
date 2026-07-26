import { formatAmount, money, type SplitType } from '@chukta/core';
import * as Crypto from 'expo-crypto';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { GlassSurface, color, font, layout, radius } from '@/design';
import { Avatar } from '@/features/people/Avatar';
import type { Participant } from './PayerSheet';
import type { DraftItem, SplitState } from './splitDraft';

const TABS: { value: SplitType; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'exact', label: 'Exact' },
  { value: 'percentage', label: 'Percent' },
  { value: 'shares', label: 'Shares' },
  { value: 'itemized', label: 'Itemised' },
];

/**
 * The split-type tabs and, under them, real per-person inputs.
 *
 * The prototype has no editable per-person fields at all — it renders a fabricated
 * distribution and toasts on every interaction — so everything below the tab strip is new UI
 * rather than a port.
 *
 * Every type edits the same participant set. Switching tabs never changes who is on the
 * expense, only how their shares are worked out, and each type remembers what was typed into
 * it so a look at another tab is not destructive.
 */
export function SplitEditor({
  state,
  onChange,
  participants,
  totalMinor,
  shares,
  error,
}: {
  state: SplitState;
  onChange: (next: SplitState) => void;
  participants: Participant[];
  totalMinor: bigint;
  shares: Map<string, bigint> | null;
  error: string | null;
}) {
  const isIn = (id: string) => !state.excluded.includes(id);
  const included = participants.filter((p) => isIn(p.id));

  const toggle = (id: string) =>
    onChange({
      ...state,
      excluded: isIn(id) ? [...state.excluded, id] : state.excluded.filter((x) => x !== id),
    });

  return (
    <View style={styles.root}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
      >
        {TABS.map((tab) => {
          const on = state.type === tab.value;
          return (
            <Pressable
              key={tab.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => onChange({ ...state, type: tab.value })}
              style={[styles.tab, on ? styles.tabOn : null]}
            >
              <Text style={[styles.tabLabel, on ? styles.tabLabelOn : null]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {state.type === 'itemized' ? (
        <ItemizedEditor state={state} onChange={onChange} participants={included} />
      ) : (
        <View style={styles.rows}>
          {participants.map((p) => (
            <ParticipantRow
              key={p.id}
              participant={p}
              state={state}
              onChange={onChange}
              included={isIn(p.id)}
              onToggle={() => toggle(p.id)}
              share={shares?.get(p.id) ?? null}
            />
          ))}
        </View>
      )}

      {/* Preview. Always rendered, even while invalid, so the numbers do not appear and
          disappear as the user types — only the amounts go quiet. */}
      <GlassSurface radius={radius.panel} elevation="glass" contentStyle={styles.preview}>
        <View style={styles.previewHeader}>
          <Text style={styles.previewTitle}>Split preview</Text>
          <Text style={[styles.previewNote, error ? styles.previewError : null]} numberOfLines={2}>
            {error ??
              (totalMinor <= 0n
                ? 'Enter an amount'
                : `${formatAmount(money(totalMinor, 'INR'))} between ${included.length}`)}
          </Text>
        </View>

        <View style={styles.previewRows}>
          {included.map((p) => (
            <View key={p.id} style={styles.previewRow}>
              <Avatar name={p.name} url={p.avatarUrl} size={30} tone="plain" />
              <Text style={styles.previewName} numberOfLines={1}>
                {p.name}
              </Text>
              <Text style={styles.previewAmount}>
                {shares?.has(p.id) ? formatAmount(money(shares.get(p.id)!, 'INR')) : '—'}
              </Text>
            </View>
          ))}
        </View>
      </GlassSurface>
    </View>
  );
}

function ParticipantRow({
  participant,
  state,
  onChange,
  included,
  onToggle,
  share,
}: {
  participant: Participant;
  state: SplitState;
  onChange: (next: SplitState) => void;
  included: boolean;
  onToggle: () => void;
  share: bigint | null;
}) {
  const setField = (field: 'exact' | 'percentage' | 'shares', value: string) =>
    onChange({ ...state, [field]: { ...state[field], [participant.id]: value } });

  return (
    <GlassSurface
      radius={radius.cardCompact}
      active={included}
      contentStyle={[styles.row, included ? null : styles.rowOut]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: included }}
        accessibilityLabel={`Include ${participant.name}`}
        hitSlop={6}
        onPress={onToggle}
        style={styles.rowLeft}
      >
        <Avatar
          name={participant.name}
          url={participant.avatarUrl}
          size={34}
          tone={included ? 'gold' : 'plain'}
        />
        <Text style={styles.rowName} numberOfLines={1}>
          {participant.name}
        </Text>
      </Pressable>

      {!included ? (
        <Text style={styles.rowOutLabel}>Not splitting</Text>
      ) : state.type === 'equal' ? (
        <Text style={styles.rowShare}>
          {share !== null ? formatAmount(money(share, 'INR')) : '—'}
        </Text>
      ) : state.type === 'exact' ? (
        <UnitInput
          prefix="₹"
          value={state.exact[participant.id] ?? ''}
          onChangeText={(t) => setField('exact', t)}
          label={`Amount for ${participant.name}`}
        />
      ) : state.type === 'percentage' ? (
        <UnitInput
          suffix="%"
          value={state.percentage[participant.id] ?? ''}
          onChangeText={(t) => setField('percentage', t)}
          label={`Percentage for ${participant.name}`}
        />
      ) : (
        <Stepper
          value={Number(state.shares[participant.id] ?? '1') || 1}
          onChange={(n) => setField('shares', String(n))}
          label={participant.name}
        />
      )}
    </GlassSurface>
  );
}

function UnitInput({
  value,
  onChangeText,
  label,
  prefix,
  suffix,
}: {
  value: string;
  onChangeText: (text: string) => void;
  label: string;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <View style={styles.unitBox}>
      {prefix ? <Text style={styles.unit}>{prefix}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="0"
        placeholderTextColor={color.textGhost}
        keyboardType="decimal-pad"
        inputMode="decimal"
        accessibilityLabel={label}
        style={styles.unitInput}
      />
      {suffix ? <Text style={styles.unit}>{suffix}</Text> : null}
    </View>
  );
}

function Stepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <View style={styles.stepper}>
      {/*
        * The Pressable is the 44pt target; the 30pt circle inside it is the appearance.
        * Decoupling them is what lets a deliberately small control still be aimable — growing
        * the circle to 44 would have changed a design the stepper was drawn against.
        */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`One fewer share for ${label}`}
        accessibilityState={{ disabled: value <= 1 }}
        disabled={value <= 1}
        onPress={() => onChange(Math.max(1, value - 1))}
        style={styles.stepTarget}
      >
        <View style={[styles.stepButton, value <= 1 ? styles.stepDisabled : null]}>
          <Svg width={11} height={2} viewBox="0 0 11 2" fill="none">
            <Path d="M0.8 1h9.4" stroke={color.creamWarm} strokeWidth={1.6} strokeLinecap="round" />
          </Svg>
        </View>
      </Pressable>

      <Text style={styles.stepValue}>{value}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`One more share for ${label}`}
        onPress={() => onChange(value + 1)}
        style={styles.stepTarget}
      >
        <View style={styles.stepButton}>
        <Svg width={11} height={11} viewBox="0 0 12 12" fill="none">
          <Path
            d="M6 1.6v8.8M1.6 6h8.8"
            stroke={color.creamWarm}
            strokeWidth={1.6}
              strokeLinecap="round"
            />
          </Svg>
        </View>
      </Pressable>
    </View>
  );
}

/**
 * Itemised: the receipt, line by line.
 *
 * Tax, tip and discount are separate line kinds rather than ordinary lines because they
 * behave differently — they spread across everyone in proportion to what each person's lines
 * came to, so the person who ordered the expensive thing carries more of the service charge.
 */
function ItemizedEditor({
  state,
  onChange,
  participants,
}: {
  state: SplitState;
  onChange: (next: SplitState) => void;
  participants: Participant[];
}) {
  const update = (id: string, patch: Partial<DraftItem>) =>
    onChange({
      ...state,
      items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });

  const add = (kind: DraftItem['kind']) =>
    onChange({
      ...state,
      items: [
        ...state.items,
        {
          id: Crypto.randomUUID(),
          description: '',
          amount: '',
          kind,
          // `participants` here is already the included set — see the caller.
          participants: kind === 'line' ? participants.map((p) => p.id) : [],
        },
      ],
    });

  return (
    <View style={styles.rows}>
      {state.items.map((item) => (
        <GlassSurface key={item.id} radius={radius.cardCompact} contentStyle={styles.item}>
          <View style={styles.itemTop}>
            <TextInput
              value={item.description}
              onChangeText={(text) => update(item.id, { description: text })}
              placeholder={item.kind === 'line' ? 'What was it?' : KIND_LABEL[item.kind]}
              placeholderTextColor={color.textFaint}
              accessibilityLabel="Line description"
              style={styles.itemDescription}
            />
            <UnitInput
              prefix="₹"
              value={item.amount}
              onChangeText={(text) => update(item.id, { amount: text })}
              label={`Amount for ${item.description || KIND_LABEL[item.kind]}`}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove this line"
              hitSlop={8}
              onPress={() =>
                onChange({ ...state, items: state.items.filter((i) => i.id !== item.id) })
              }
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
          </View>

          {item.kind === 'line' ? (
            <View style={styles.itemPeople}>
              {participants.map((p) => {
                const on = item.participants.includes(p.id);
                return (
                  <Pressable
                    key={p.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${p.name} shared this line`}
                    onPress={() =>
                      update(item.id, {
                        participants: on
                          ? item.participants.filter((x) => x !== p.id)
                          : [...item.participants, p.id],
                      })
                    }
                    style={[styles.chip, on ? styles.chipOn : null]}
                  >
                    <Text style={[styles.chipLabel, on ? styles.chipLabelOn : null]}>
                      {p.name.split(/\s+/)[0]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={styles.itemNote}>
              {item.kind === 'discount'
                ? 'Taken off everyone, in proportion to their lines.'
                : 'Spread across everyone, in proportion to their lines.'}
            </Text>
          )}
        </GlassSurface>
      ))}

      <View style={styles.addRow}>
        {(['line', 'tax', 'tip', 'discount'] as const).map((kind) => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            accessibilityLabel={`Add ${KIND_LABEL[kind]}`}
            onPress={() => add(kind)}
            style={styles.addButton}
          >
            <Text style={styles.addLabel}>+ {KIND_LABEL[kind]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const KIND_LABEL: Record<DraftItem['kind'], string> = {
  line: 'Item',
  tax: 'Tax',
  tip: 'Tip',
  discount: 'Discount',
};

const styles = StyleSheet.create({
  root: { gap: 14 },
  tabs: { gap: 8, paddingRight: 22 },
  tab: {
    paddingHorizontal: 15,
    height: 36,
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  tabOn: { borderColor: color.owedBorder, backgroundColor: color.owedFill },
  tabLabel: { fontFamily: font.regular, fontSize: 13.5, color: color.textSecondary },
  tabLabelOn: { fontFamily: font.semibold, color: color.creamWarm },
  rows: { gap: 9 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  rowOut: { opacity: 0.5 },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowName: { flex: 1, fontFamily: font.medium, fontSize: 15, color: color.cream },
  rowOutLabel: { fontFamily: font.light, fontSize: 12.5, color: color.textFaint },
  rowShare: { fontFamily: font.semibold, fontSize: 15.5, color: color.textHighlight },
  unitBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 92,
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  unit: { fontFamily: font.light, fontSize: 13.5, color: color.textFaint },
  unitInput: {
    flex: 1,
    padding: 0,
    textAlign: 'right',
    fontFamily: font.semibold,
    fontSize: 15,
    color: color.cream,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  /*
   * Bounds, decoupled from appearance: a 44pt Pressable centring the 30pt circle below.
   *
   * This is NOT free — the stepper grows from 98pt wide to 106, and because each circle is
   * centred in a wider box they sit about 4pt further apart than they were drawn. `gap` went
   * from 10 to 0 to claw most of that back. The row has flex room to absorb the remainder, and
   * 8pt of width is a fair price for two controls that were 30pt targets in a form about money.
   */
  stepTarget: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  stepDisabled: { opacity: 0.35 },
  stepValue: {
    minWidth: 18,
    textAlign: 'center',
    fontFamily: font.semibold,
    fontSize: 16,
    color: color.cream,
  },
  item: { padding: 13, gap: 10 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemDescription: {
    flex: 1,
    padding: 0,
    fontFamily: font.regular,
    fontSize: 14.5,
    color: color.cream,
  },
  itemPeople: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  itemNote: { fontFamily: font.light, fontSize: 12, color: color.textFaint },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.glassBorder,
  },
  chipOn: { borderColor: color.owedBorder, backgroundColor: color.owedFill },
  chipLabel: { fontFamily: font.regular, fontSize: 12.5, color: color.textMuted },
  chipLabelOn: { fontFamily: font.medium, color: color.creamWarm },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  addButton: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  addLabel: { fontFamily: font.medium, fontSize: 13, color: color.creamWarm },
  preview: { padding: 18, gap: 14 },
  previewHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  previewTitle: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  previewNote: { flex: 1, textAlign: 'right', fontFamily: font.light, fontSize: 12.5, color: color.textMuted },
  previewError: { color: color.creamRose },
  previewRows: { gap: 11 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  previewName: { flex: 1, fontFamily: font.regular, fontSize: 14.5, color: color.textSecondary },
  previewAmount: { fontFamily: font.semibold, fontSize: 15, color: color.textHighlight },
});
