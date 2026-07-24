import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { color, font, motion, radius } from '../tokens';
import { GlassSurface } from './GlassSurface';

export interface ToastProps {
  message: string | null;
  /** Anchor to the top of the screen instead of above the tab bar. */
  position?: 'top' | 'bottom';
}

/**
 * The prototypes' universal feedback element. In the design files every one of these said
 * "demo only"; here it is the real thing — errors, confirmations, undo prompts.
 */
export function Toast({ message, position = 'top' }: ToastProps) {
  if (!message) return null;

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      entering={FadeInDown.duration(motion.toast.duration)}
      exiting={FadeOut.duration(motion.fade.duration)}
      style={[styles.wrap, position === 'top' ? styles.top : styles.bottom]}
      pointerEvents="none"
    >
      <GlassSurface radius={16} active elevation="glass" contentStyle={styles.content}>
        <Text style={styles.text}>{message}</Text>
      </GlassSurface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 24, right: 24, zIndex: 60 },
  top: { top: 118 },
  bottom: { bottom: 118 },
  content: { paddingVertical: 13, paddingHorizontal: 16, borderRadius: radius.card },
  text: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: color.cream,
    textAlign: 'center',
  },
});
