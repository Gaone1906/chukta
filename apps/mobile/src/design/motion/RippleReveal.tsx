import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useBlurTarget } from '../blurTarget';
import { ANDROID_BLUR_METHOD, getGlassBackend } from '../glassConfig';
import { motion } from '../tokens';
import { useReduceMotion } from '../useReduceMotion';
import {
  RING_BLUR,
  RING_COUNT,
  maxRadius,
  outgoingScale,
  ringOpacity,
  ringRadius,
  rippleEase,
} from './rippleMath';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

export interface RippleRevealProps {
  /** The screen being covered. Stays mounted underneath and blurs back. */
  from: ReactNode;
  /** The screen being revealed through the expanding circle. */
  to: ReactNode;
  /** Tap point in window coordinates. */
  origin: { x: number; y: number };
  onDone?: () => void;
  durationMs?: number;
}

/**
 * The app's screen-change transition: a circular reveal easing out from the tap point, three
 * trailing gold rings riding the wavefront, and the outgoing screen blurring and easing back
 * so it reads as dissolving under water rather than sliding away.
 *
 * Implemented as a mask + Reanimated rather than a Metal/Skia shader. The design doc is
 * explicit about this: a real water distortion looks better but is a much heavier,
 * platform-gated build, and the circular reveal reads as "ripple" in spirit for a fraction of
 * the cost.
 *
 * The outgoing blur is a BlurView whose `intensity` is animated through `animatedProps` — you
 * cannot cheaply blur a live view in React Native, but you can animate a blur layer sitting
 * on top of one.
 */
export function RippleReveal({ from, to, origin, onDone, durationMs = motion.ripple.duration }: RippleRevealProps) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const blurTarget = useBlurTarget();
  const progress = useSharedValue(0);

  // Must respect the same backend switch as GlassSurface. Rendering a BlurView here regardless
  // is what crashed the emulator: the glass had already degraded to the opaque fallback, but
  // the transition kept blurring anyway.
  const canBlur = getGlassBackend() !== 'fallback';

  const rMax = maxRadius(width, height, origin.x, origin.y);

  useEffect(() => {
    if (reduceMotion) {
      // Instant swap, no rings — matches the prototype's reduced-motion path.
      progress.value = 1;
      onDone?.();
      return;
    }
    progress.value = withTiming(1, { duration: durationMs, easing: Easing.linear }, (done) => {
      if (done && onDone) runOnJS(onDone)();
    });
  }, [durationMs, onDone, progress, reduceMotion]);

  const maskStyle = useAnimatedStyle(() => {
    const p = rippleEase(progress.value);
    const r = Math.max(1, p * rMax);
    return {
      width: r * 2,
      height: r * 2,
      borderRadius: r,
      left: origin.x - r,
      top: origin.y - r,
    };
  });

  const outgoingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: outgoingScale(rippleEase(progress.value)) }],
  }));

  const outgoingBlurProps = useAnimatedProps(() => ({
    // 0 -> ~8 maps expo-blur's scale onto the prototype's 3.2px CSS blur.
    intensity: rippleEase(progress.value) * 8,
  }));

  /** Stand-in for the blur when blur is unavailable: the old screen dims as it recedes. */
  const outgoingScrimStyle = useAnimatedStyle(() => ({
    opacity: rippleEase(progress.value) * 0.35,
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, outgoingStyle]}>
        {from}
        {reduceMotion ? null : canBlur ? (
          <AnimatedBlurView
            pointerEvents="none"
            tint="dark"
            blurMethod={ANDROID_BLUR_METHOD}
            blurTarget={blurTarget}
            animatedProps={outgoingBlurProps}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.scrim, outgoingScrimStyle]}
          />
        )}
      </Animated.View>

      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={
          <View style={styles.maskCanvas}>
            <Animated.View style={[styles.maskCircle, maskStyle]} />
          </View>
        }
      >
        {to}
      </MaskedView>

      {!reduceMotion
        ? Array.from({ length: RING_COUNT }, (_, i) => (
            <TrailingRing key={i} index={i} progress={progress} rMax={rMax} origin={origin} />
          ))
        : null}
    </View>
  );
}

function TrailingRing({
  index,
  progress,
  rMax,
  origin,
}: {
  index: number;
  progress: SharedValue<number>;
  rMax: number;
  origin: { x: number; y: number };
}) {
  const style = useAnimatedStyle(() => {
    const raw = progress.value;
    const r = ringRadius(rippleEase(raw), rMax, index);
    return {
      width: r * 2,
      height: r * 2,
      borderRadius: r,
      left: origin.x - r,
      top: origin.y - r,
      opacity: ringOpacity(raw, index),
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        // A real per-ring blur would need one blur layer each; the graduated opacity plus a
        // hairline border reads the same at this speed for a fraction of the cost.
        { borderWidth: 1 + RING_BLUR[index]! * 0.25 },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  maskCanvas: { flex: 1, backgroundColor: 'transparent' },
  scrim: { backgroundColor: '#0A0405' },
  maskCircle: { position: 'absolute', backgroundColor: '#000' },
  ring: { position: 'absolute', borderColor: 'rgba(184,150,60,0.55)' },
});
