import { Image } from 'expo-image';
import { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { color, font, motion } from '../tokens';
import { useReduceMotion } from '../useReduceMotion';

const STAMP = require('../../../assets/brand/chukta-stamp.png');

export type SealState = 'loading' | 'settled' | 'animate';

export interface SealProps {
  size?: number;
  /** 'animate' spins, then stamps. 'loading' spins forever. 'settled' is the resting mark. */
  state?: SealState;
  /** Spinner caption. Empty string hides it. */
  label?: string;
  /** Fires when the stamp lands. */
  onSettled?: () => void;
}

/**
 * The wax-seal mark: a gold spinner that resolves into the stamp landing.
 *
 * Keyframes are lifted exactly from design-reference/assets/hisaab-seal.js —
 *   stamp: 760ms cubic-bezier(.2,.85,.25,1), scale 1.5 → .965 → 1.014 → 1,
 *          rotate -9° → 1.5° → -.6° → 0, opacity 0 → 1
 *   halo:  900ms ease-out, scale .7 → 1.5, opacity 0 → .55 → 0, concurrent
 *
 * The blur component of the original keyframes is dropped: React Native cannot animate a
 * blur on a view cheaply, and at this speed the scale overshoot carries the impact on its own.
 *
 * Reserved for branding moments — onboarding, the completion screen, About. It is deliberately
 * NOT the settled indicator on list rows; that is the plain checkmark badge.
 */
export function Seal({ size = 158, state = 'animate', label = 'Sealing your ledger', onSettled }: SealProps) {
  const reduceMotion = useReduceMotion();

  const spin = useSharedValue(0);
  const progress = useSharedValue(state === 'settled' ? 1 : 0);
  const halo = useSharedValue(0);

  const ringSize = Math.round(size * 0.66);
  // Derived from props only — reading progress.value during render would not be reactive.
  // The spinner and caption fade themselves out as the stamp lands.
  const showSpinner = state !== 'settled' && !reduceMotion;

  const finish = useCallback(() => onSettled?.(), [onSettled]);

  useEffect(() => {
    if (state === 'settled' || reduceMotion) {
      progress.value = 1;
      if (state !== 'loading') finish();
      return;
    }

    spin.value = withRepeat(withTiming(1, { duration: motion.seal.spinner, easing: Easing.linear }), -1);

    if (state === 'animate') {
      const stamp = Easing.bezier(0.2, 0.85, 0.25, 1);
      progress.value = withDelay(
        motion.seal.holdBeforeStamp,
        withTiming(1, { duration: motion.seal.stamp, easing: stamp }, (done) => {
          if (done) runOnJS(finish)();
        }),
      );
      halo.value = withDelay(
        motion.seal.holdBeforeStamp,
        withTiming(1, { duration: motion.seal.halo, easing: Easing.out(Easing.ease) }),
      );
    }

    return () => {
      cancelAnimation(spin);
      cancelAnimation(progress);
      cancelAnimation(halo);
    };
  }, [state, reduceMotion, spin, progress, halo, finish]);

  const spinnerStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  /** Opacity only — the caption must not inherit the spinner's rotation. */
  const fadeOutStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  const stampStyle = useAnimatedStyle(() => {
    const p = progress.value;
    // Piecewise to reproduce the overshoot: 1.5 → .965 by 55%, up to 1.014 at 78%, home at 1.
    const scale =
      p < 0.55 ? 1.5 + (0.965 - 1.5) * (p / 0.55)
      : p < 0.78 ? 0.965 + (1.014 - 0.965) * ((p - 0.55) / 0.23)
      : 1.014 + (1 - 1.014) * ((p - 0.78) / 0.22);
    const rotate =
      p < 0.55 ? -9 + (1.5 + 9) * (p / 0.55)
      : p < 0.78 ? 1.5 + (-0.6 - 1.5) * ((p - 0.55) / 0.23)
      : -0.6 + 0.6 * ((p - 0.78) / 0.22);
    return {
      opacity: Math.min(1, p / 0.55),
      transform: [{ scale }, { rotate: `${rotate}deg` }],
    };
  });

  const haloStyle = useAnimatedStyle(() => ({
    opacity: halo.value < 0.4 ? (halo.value / 0.4) * 0.55 : 0.55 * (1 - (halo.value - 0.4) / 0.6),
    transform: [{ scale: 0.7 + halo.value * 0.8 }],
  }));

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {showSpinner ? (
          <>
            <View
              style={[
                styles.track,
                { width: ringSize, height: ringSize, borderRadius: ringSize / 2 },
              ]}
            />
            <Animated.View
              style={[
                styles.arc,
                { width: ringSize, height: ringSize, borderRadius: ringSize / 2 },
                spinnerStyle,
              ]}
            />
          </>
        ) : null}

        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              width: Math.round(size * 0.95),
              height: Math.round(size * 0.95),
              borderRadius: Math.round(size * 0.95) / 2,
            },
            haloStyle,
          ]}
        />

        <Animated.View style={[StyleSheet.absoluteFill, stampStyle]}>
          <Image
            source={STAMP}
            style={{ width: size, height: size }}
            contentFit="contain"
            accessibilityLabel="Chukta seal"
          />
        </Animated.View>
      </View>

      {showSpinner && label ? (
        <Animated.Text style={[styles.caption, { marginTop: Math.round(size * 0.19) }, fadeOutStyle]}>
          {label}
        </Animated.Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  arc: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderTopColor: color.goldBright,
    borderRightColor: 'rgba(184,150,60,0.45)',
  },
  halo: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(184,150,60,0.55)',
  },
  caption: {
    fontFamily: font.light,
    fontSize: 14,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
});
