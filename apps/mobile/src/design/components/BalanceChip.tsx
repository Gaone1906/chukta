import { formatAmount, spokenAmount, type Money } from '@chukta/core';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { color, font, radius } from '../tokens';

export interface BalanceChipProps {
  /** Positive means they owe you; negative means you owe them; zero renders the settled badge. */
  balance: Money;
  compact?: boolean;
  /** Hide the "YOU OWE" / "OWES YOU" caption. Always hidden when compact. */
  showCaption?: boolean;
}

/**
 * A pending amount, or — when the balance is zero — a gold checkmark badge.
 *
 * The settled badge is deliberately a plain checkmark and NOT the stamp mark. The stamp is
 * reserved for branding moments (onboarding, the completion screen, About); reusing it as a
 * recurring list indicator would dilute it into wallpaper.
 */
export function BalanceChip({ balance, compact = false, showCaption = true }: BalanceChipProps) {
  if (balance.minor === 0n) return <SettledBadge compact={compact} />;

  const youOwe = balance.minor < 0n;
  /*
   * `spokenAmount`, not `formatAmount`. The visible text is "₹1,22,000.50"; what a screen
   * reader makes of that glyph, the lakh grouping and the bare decimal point varies by reader
   * and language setting. On the screen where somebody is deciding who owes what, that is not
   * a detail worth leaving to chance — see packages/core/src/format.ts.
   */
  const positive = { ...balance, minor: youOwe ? -balance.minor : balance.minor };
  /** What is drawn: "₹1,420". */
  const shown = formatAmount(positive);
  /** What is announced: "1,420 rupees". Same number, different audience. */
  const spoken = spokenAmount(positive);

  return (
    // Labelled as a whole so a screen reader says "You owe ₹1,420" rather than reading a bare
    // number followed by a disconnected caption.
    <View
      accessible
      accessibilityLabel={`${youOwe ? 'You owe' : 'Owes you'} ${spoken}`}
      style={styles.wrap}
    >
      <View
        style={[
          styles.chip,
          compact ? styles.chipCompact : null,
          {
            borderColor: youOwe ? color.oweBorder : color.owedBorder,
            backgroundColor: youOwe ? color.oweFill : color.owedFill,
          },
        ]}
      >
        {/*
          * Capped, and only this one element.
          *
          * At the largest accessibility text size the chip grew in step with everything else
          * and, being in a row with a `flex: 1` name beside it, took the width the name needed
          * — "Flat 302" rendered as "F..". The amount is already the most prominent thing in
          * the row at 15pt semibold on a filled pill, so it is the element that can afford to
          * stop growing first. The name, which was the casualty, is left uncapped.
          *
          * 1.4 rather than 1.0: capping it outright would leave the amount visibly smaller
          * than the text around it at large sizes, which reads as a bug rather than a choice.
          * The screen-reader label is unaffected either way — it is a string, not a layout.
          */}
        <Text
          maxFontSizeMultiplier={1.4}
          style={[
            styles.amount,
            compact ? styles.amountCompact : null,
            { color: youOwe ? color.creamRose : color.creamWarm },
          ]}
        >
          {shown}
        </Text>
      </View>

      {showCaption && !compact ? (
        <Text style={styles.caption}>{youOwe ? 'You owe' : 'Owes you'}</Text>
      ) : null}
    </View>
  );
}

export function SettledBadge({ compact = false }: { compact?: boolean }) {
  const size = compact ? 26 : 30;
  return (
    <View
      accessible
      accessibilityLabel="Settled"
      style={[
        styles.settled,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Svg width={14} height={11} viewBox="0 0 14 11" fill="none">
        <Path
          d="M1.4 5.6l3.6 3.6L12.6 1.6"
          stroke={color.goldBright}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end' },
  chip: {
    borderWidth: 1,
    borderRadius: radius.chip,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  chipCompact: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 11 },
  amount: { fontFamily: font.semibold, fontSize: 15 },
  amountCompact: { fontSize: 13 },
  caption: {
    marginTop: 4,
    fontFamily: font.light,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  settled: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(184,150,60,0.6)',
    backgroundColor: 'rgba(184,150,60,0.16)',
  },
});
