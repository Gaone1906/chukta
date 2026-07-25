import type { Money } from '@hisaab/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
          <View style={[styles.inner, compact ? styles.innerCompact : null]}>
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
              <Text
                numberOfLines={1}
                style={[styles.name, compact ? styles.nameCompact : null]}
              >
                {name}
              </Text>
              {meta ? (
                <Text numberOfLines={1} style={[styles.meta, compact ? styles.metaCompact : null]}>
                  {meta}
                </Text>
              ) : null}
            </View>

            {balance ? <BalanceChip balance={balance} compact={compact} /> : null}

            {chevron ? (
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
