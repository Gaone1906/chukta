import type { Money } from '@chukta/core';
import { PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { color, font, motion, radius } from '../tokens';
import { BalanceChip } from './BalanceChip';
import { GlassSurface } from './GlassSurface';

export type AvatarTone = 'oxblood' | 'gold' | 'plain';

export interface RowProps {
  name: string;
  /** "6 members" · "2 shared groups" */
  meta?: string;
  balance?: Money;
  /** Initials shown in a circular avatar. Omit for group rows, which have no avatar. */
  avatar?: string;
  avatarTone?: AvatarTone;
  compact?: boolean;
  showChevron?: boolean;
  /**
   * Reports the tap point in window coordinates, like FAB does — the ripple transition
   * originates from wherever the finger landed, so the coordinate has to travel with the press
   * rather than be reconstructed from the row's layout afterwards.
   */
  onPress?: (event: { x: number; y: number }) => void;
}

const AVATAR_FILL: Record<AvatarTone, string> = {
  oxblood: 'rgba(122,40,51,0.35)',
  gold: 'rgba(184,150,60,0.24)',
  plain: 'rgba(255,255,255,0.10)',
};

/**
 * The glass list row used for both groups and people on Home, ported from
 * design-reference/assets/hisaab-row.js.
 *
 * A settled row shows the checkmark badge *instead of* the amount — not alongside it — and
 * drops the chevron, so a fully-settled list reads as calm rather than as a wall of numbers.
 */
export function Row({
  name,
  meta,
  balance,
  avatar,
  avatarTone = 'plain',
  compact = false,
  showChevron = true,
  onPress,
}: RowProps) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.01 }],
  }));

  /*
   * How much the OS has been asked to scale text by. 1 is the default; iOS's accessibility
   * sizes go past 3.
   *
   * Read per render rather than cached in a hook: it changes only when the user changes it in
   * Settings, at which point the whole app re-renders anyway, and `PixelRatio.getFontScale()`
   * is a synchronous property read rather than a bridge call.
   */
  const largeText = PixelRatio.getFontScale() >= 1.5;

  const settled = balance != null && balance.minor === 0n;
  const chevron = showChevron && !settled;
  const avatarSize = compact ? 36 : 42;

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={meta ? `${name}, ${meta}` : name}
        onPressIn={() => {
          pressed.value = withTiming(1, { duration: motion.press.duration });
        }}
        onPressOut={() => {
          pressed.value = withTiming(0, { duration: motion.press.duration });
        }}
        onPress={(e) => onPress?.({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
      >
        <GlassSurface radius={compact ? radius.cardCompact : radius.card}>
          <View
            style={[
              styles.inner,
              compact ? styles.innerCompact : null,
              largeText ? styles.innerStacked : null,
            ]}
          >
            {avatar ? (
              <View
                style={[
                  styles.avatar,
                  {
                    width: avatarSize,
                    height: avatarSize,
                    borderRadius: avatarSize / 2,
                    backgroundColor: AVATAR_FILL[avatarTone],
                  },
                ]}
              >
                <Text style={[styles.avatarText, compact ? styles.avatarTextCompact : null]}>
                  {avatar}
                </Text>
              </View>
            ) : null}

            <View style={styles.text}>
              {/*
                * `numberOfLines={1}` until the text is large, then unlimited.
                *
                * At the largest accessibility size a one-line cap turned "Flat 302" into "Fl…"
                * — the row simply has no horizontal room left once every element in it has
                * grown. Truncating a group's NAME is the worst thing this row can do, because
                * the name is the only thing that identifies which money it is about. Wrapping
                * is the honest trade: the row gets taller, which costs nothing but scrolling.
                */}
              <Text
                numberOfLines={largeText ? undefined : 1}
                style={[styles.name, compact ? styles.nameCompact : null]}
              >
                {name}
              </Text>
              {meta ? (
                <Text
                  numberOfLines={largeText ? undefined : 1}
                  style={[styles.meta, compact ? styles.metaCompact : null]}
                >
                  {meta}
                </Text>
              ) : null}
            </View>

            {balance ? <BalanceChip balance={balance} compact={compact} /> : null}

            {chevron && !largeText ? (
              <Svg width={7} height={12} viewBox="0 0 7 12" fill="none" style={styles.chevron}>
                <Path
                  d="M1.5 1l4 5-4 5"
                  stroke={color.textFaint}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            ) : null}
          </View>
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 16,
    paddingBottom: 16,
    paddingLeft: 18,
    paddingRight: 16,
  },
  /*
   * At large accessibility sizes the row stops being a row.
   *
   * Letting the name wrap was not enough: the text column is `flex: 1` against an avatar, a
   * balance chip and a chevron, so at AX5 it had so little width left that "Flat 302" wrapped
   * to "Fla / t / 302" — technically not truncated, and completely unreadable. Stacking gives
   * the name the full width of the card, which is the only way it gets to be one word.
   *
   * The chevron is dropped in this mode rather than stacked. It is decoration — the row is a
   * Pressable with `accessibilityRole="button"` and its own label, so nothing is lost — and a
   * lone arrow on its own line below the amount would read as another item.
   */
  innerStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 10 },
  innerCompact: { gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  avatarText: { fontFamily: font.medium, fontSize: 15, color: color.cream },
  avatarTextCompact: { fontSize: 13 },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: font.medium, fontSize: 16.5, color: color.cream, letterSpacing: 0.1 },
  nameCompact: { fontSize: 14.5 },
  meta: { fontFamily: font.light, fontSize: 13, color: color.textMuted },
  metaCompact: { fontSize: 11.5 },
  chevron: { marginLeft: 2 },
});
