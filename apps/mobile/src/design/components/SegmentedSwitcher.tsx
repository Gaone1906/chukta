import { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { color, font, motion, radius } from '../tokens';
import { GlassSurface } from './GlassSurface';

export interface SegmentedSwitcherProps<T extends string> {
  options: readonly [{ value: T; label: string }, { value: T; label: string }];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Two labels in one glass pill with a gold thumb that slides between them.
 * Curve and duration are from the prototype: cubic-bezier(.35, 0, .2, 1) over 340ms.
 */
export function SegmentedSwitcher<T extends string>({
  options,
  value,
  onChange,
}: SegmentedSwitcherProps<T>) {
  const [width, setWidth] = useState(0);
  const index = options.findIndex((o) => o.value === value);
  const thumbWidth = width > 0 ? (width - PADDING * 2) / 2 : 0;

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: withTiming(index * thumbWidth, {
          duration: motion.segmented.duration,
          easing: Easing.bezier(0.35, 0, 0.2, 1),
        }),
      },
    ],
  }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <GlassSurface radius={radius.pill} elevation="row" style={styles.shell} contentStyle={styles.content}>
      <View style={styles.track} onLayout={onLayout}>
        {thumbWidth > 0 ? (
          <Animated.View style={[styles.thumb, { width: thumbWidth }, thumbStyle]} />
        ) : null}

        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              style={styles.segment}
              onPress={() => onChange(option.value)}
            >
              <Text style={[styles.label, active ? styles.labelActive : null]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </GlassSurface>
  );
}

const PADDING = 5;

const styles = StyleSheet.create({
  shell: { height: 48 },
  content: { flex: 1 },
  track: { flex: 1, flexDirection: 'row', padding: PADDING },
  thumb: {
    position: 'absolute',
    top: PADDING,
    bottom: PADDING,
    left: PADDING,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(184,150,60,0.55)',
    backgroundColor: 'rgba(184,150,60,0.18)',
  },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: {
    fontFamily: font.medium,
    fontSize: 15,
    letterSpacing: 0.3,
    color: color.textMuted,
  },
  labelActive: { color: color.creamWarm },
});
