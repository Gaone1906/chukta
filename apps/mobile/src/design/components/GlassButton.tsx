import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { color, font, motion, radius } from '../tokens';
import { GlassSurface } from './GlassSurface';

export interface GlassButtonProps {
  label: string;
  onPress?: () => void;
  /**
   * 'primary' is the gold-filled CTA, 'secondary' outlined glass, 'danger' the oxblood fill
   * for irreversible actions, and 'ghost' a quiet text-only button — which exists so that the
   * *safe* option beside a destructive one can be visually lighter without being hard to find.
   */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  /** Leading icon, vertically centred against the label. */
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function GlassButton({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  icon,
  style,
}: GlassButtonProps) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.018 }],
  }));

  const filled = variant === 'primary' || variant === 'danger';

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPressIn={() => {
          pressed.value = withTiming(1, { duration: motion.press.duration });
        }}
        onPressOut={() => {
          pressed.value = withTiming(0, { duration: motion.press.duration });
        }}
        onPress={onPress}
        style={disabled ? styles.disabled : undefined}
      >
        {filled ? (
          <View style={[styles.primary, variant === 'danger' ? styles.danger : null]}>
            {icon ? <View style={styles.icon}>{icon}</View> : null}
            <Text
              style={[
                styles.label,
                variant === 'danger' ? styles.labelDanger : styles.labelPrimary,
              ]}
            >
              {label}
            </Text>
          </View>
        ) : variant === 'ghost' ? (
          <View style={styles.ghost}>
            {icon ? <View style={styles.icon}>{icon}</View> : null}
            <Text style={[styles.label, styles.labelGhost]}>{label}</Text>
          </View>
        ) : (
          <GlassSurface radius={radius.pill} elevation="none" contentStyle={styles.secondary}>
            {icon ? <View style={styles.icon}>{icon}</View> : null}
            <Text style={styles.label}>{label}</Text>
          </GlassSurface>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  primary: {
    height: 54,
    // Horizontal padding matters only when the button sizes to its own content — every
    // full-width use hides its absence. Inline in a row, a label with no padding and a pill
    // radius collapses into an oval barely wider than the text.
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(184,150,60,0.85)',
    backgroundColor: 'rgba(184,150,60,0.30)',
  },
  secondary: {
    height: 54,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  danger: { borderColor: color.oweBorder, backgroundColor: color.oweFill },
  ghost: {
    height: 50,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  icon: { alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: font.medium, fontSize: 16, color: color.cream, letterSpacing: 0.1 },
  labelPrimary: { color: color.creamWarm },
  labelDanger: { color: color.creamRose },
  labelGhost: { fontFamily: font.regular, color: color.textMuted },
  disabled: { opacity: 0.35 },
});
