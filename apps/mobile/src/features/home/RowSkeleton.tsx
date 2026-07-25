import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { GlassSurface, radius } from '@/design';
import { useReduceMotion } from '@/design/useReduceMotion';

/**
 * Placeholder rows while a list loads.
 *
 * A spinner in the middle of an empty screen makes the app feel like it is starting from
 * nothing every time; ghost rows keep the shape of what is coming. Respects reduced motion by
 * holding a steady opacity rather than pulsing.
 */
export function RowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} index={i} />
      ))}
    </View>
  );
}

function SkeletonRow({ index }: { index: number }) {
  const pulse = useSharedValue(0.55);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value * 0.5 }));

  return (
    <GlassSurface radius={radius.card} elevation="row">
      <View style={styles.row}>
        <View style={styles.text}>
          <Animated.View style={[styles.barWide, style, { width: index % 2 ? '52%' : '68%' }]} />
          <Animated.View style={[styles.barNarrow, style]} />
        </View>
        <Animated.View style={[styles.chip, style]} />
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  list: { gap: 11 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 22,
    paddingLeft: 18,
    paddingRight: 16,
  },
  text: { flex: 1, gap: 8 },
  barWide: { height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.16)' },
  barNarrow: { width: '34%', height: 9, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.10)' },
  chip: { width: 74, height: 28, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.12)' },
});
