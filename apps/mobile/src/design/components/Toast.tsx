import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { color, font, motion, radius } from '../tokens';
import { GlassSurface } from './GlassSurface';

export interface ToastProps {
  message: string | null;
  /** Anchor to the top of the screen instead of above the tab bar. */
  position?: 'top' | 'bottom';
  /**
   * Clear the message. Pass this and the toast dismisses itself after
   * `motion.toast.visibleFor`; omit it and the toast stays until the caller clears it.
   */
  onDismiss?: () => void;
}

/**
 * The prototypes' universal feedback element. In the design files every one of these said
 * "demo only"; here it is the real thing — errors, confirmations, undo prompts.
 *
 * ---------------------------------------------------------------- who dismisses it
 *
 * This component used to be purely presentational: it rendered whenever `message` was non-null
 * and had no opinion about when that stopped. Dismissal was therefore every caller's job, and
 * three of seventeen forgot — so "Enter the amount first" sat over the expense form until the
 * screen was left. `motion.toast.visibleFor` existed the whole time and nothing read it.
 *
 * Passing `onDismiss` moves that job here. It has to be a callback rather than internal state
 * because the message lives in the caller: hiding ourselves while the parent still held the
 * string would mean the SAME message could never be shown twice, since nothing would change to
 * trigger a re-render.
 *
 * The timer is keyed on `message`, so a second toast arriving mid-display gets its own full
 * duration rather than inheriting the remains of the first one's.
 */
export function Toast({ message, position = 'top', onDismiss }: ToastProps) {
  useEffect(() => {
    if (message === null || onDismiss === undefined) return;
    const timer = setTimeout(onDismiss, motion.toast.visibleFor);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

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
