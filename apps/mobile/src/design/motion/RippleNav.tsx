import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { color, motion } from '../tokens';
import { useReduceMotion } from '../useReduceMotion';
import { RING_BLUR, RING_COUNT, maxRadius, ringOpacity, ringRadius, rippleEase } from './rippleMath';

/**
 * The ripple, as a navigation transition.
 *
 * `RippleReveal` masks one screen over another, which needs both as React nodes. A router
 * does not hand you that — expo-router owns mounting, and the incoming screen does not exist
 * until the push happens. So the transition is inverted: a veil in the app's own ground colour
 * expands from the tap point over the CURRENT screen, the navigation happens behind it at the
 * moment the veil is opaque, and the veil dissolves onto whatever is now there.
 *
 * Same easing, same three trailing gold rings, same origin-from-the-fingertip. What changes is
 * which side of the wavefront the new screen is on — and since the veil is the colour the
 * screens already sit on, the seam is not visible.
 *
 * Reduced motion navigates immediately with no veil at all.
 */

interface RippleNavState {
  /** Navigate with the ripple playing from the tap point. */
  rippleTo: (origin: { x: number; y: number }, navigate: () => void) => void;
  /**
   * The same thing, taking the press event straight from an `onPress`.
   *
   * Exists so that any ordinary Pressable or GlassButton can ripple without its screen having
   * to measure anything: `pageX`/`pageY` are already relative to the root view, which is
   * exactly the coordinate space the veil overlay lives in.
   */
  rippleFrom: (event: GestureResponderEvent, navigate: () => void) => void;
}

const RippleNavContext = createContext<RippleNavState | null>(null);

/**
 * Three phases, as fractions of the total duration.
 *
 *   0        → EXPAND   the veil grows from the tap point until it covers the screen
 *   EXPAND   → HOLD     fully opaque; the navigation happens in here
 *   HOLD     → 1        the veil dissolves onto the screen that is now underneath
 *
 * The hold is the important one. Pushing a route and immediately fading the veil means the
 * veil goes translucent while the new screen is still mounting, and what shows through the
 * gap is the OLD screen — which reads as the transition stuttering.
 */
const EXPAND_FRACTION = 0.5;
const HOLD_FRACTION = 0.68;

export function RippleNavProvider({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();

  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const progress = useSharedValue(0);
  const navigateRef = useRef<(() => void) | null>(null);
  const firedRef = useRef(false);

  const fireNavigation = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    navigateRef.current?.();
  }, []);

  const clear = useCallback(() => {
    setOrigin(null);
    navigateRef.current = null;
  }, []);

  const rippleTo = useCallback(
    (from: { x: number; y: number }, navigate: () => void) => {
      if (reduceMotion) {
        navigate();
        return;
      }

      navigateRef.current = navigate;
      firedRef.current = false;
      setOrigin(from);

      // `.set()` rather than `.value =`: a bare assignment to a shared value reads as a
      // mutation on the render path, and this runs from an onPress handler.
      progress.set(0);

      // The push fires the moment the veil finishes covering the screen — not earlier, or the
      // swap shows in the corners the wavefront has not reached yet.
      progress.set(
        withTiming(
          EXPAND_FRACTION,
          { duration: motion.ripple.duration * EXPAND_FRACTION, easing: Easing.linear },
          (done) => {
            if (!done) return;
            runOnJS(fireNavigation)();
            progress.set(
              withTiming(
                1,
                {
                  duration: motion.ripple.duration * (1 - EXPAND_FRACTION),
                  easing: Easing.out(Easing.quad),
                },
                (finished) => {
                  if (finished) runOnJS(clear)();
                },
              ),
            );
          },
        ),
      );
    },
    [clear, fireNavigation, progress, reduceMotion],
  );

  const rippleFrom = useCallback(
    (event: GestureResponderEvent, navigate: () => void) => {
      const { pageX, pageY } = event.nativeEvent;
      rippleTo({ x: pageX, y: pageY }, navigate);
    },
    [rippleTo],
  );

  const rMax = origin ? maxRadius(width, height, origin.x, origin.y) : 0;

  /*
   * Scale, not size.
   *
   * This used to animate `width`, `height`, `borderRadius`, `left` and `top`. All five are
   * LAYOUT properties, so every frame of the ripple forced React Native to re-measure and
   * re-position the veil and all three rings — 60 layout passes a second, on top of whatever
   * the incoming screen is doing as it mounts. That is what the stutter was.
   *
   * The circle is now laid out ONCE at its final size, centred on the origin, and only its
   * `transform` and `opacity` move. Both are handled entirely on the UI thread by the
   * compositor with no layout at all, which is why this is smooth even while a screen mounts
   * behind it. The maths is unchanged — `rippleEase(expand)` is the same 1-(1-t)^2.6 curve,
   * just expressed as a scale factor rather than a radius.
   */
  const veilStyle = useAnimatedStyle(() => {
    const expand = Math.min(1, progress.value / EXPAND_FRACTION);
    // Opacity holds at 1 through the hold phase and only falls once the new screen has had a
    // beat to mount — otherwise the old screen shows through the gap.
    const dissolve = Math.max(0, (progress.value - HOLD_FRACTION) / (1 - HOLD_FRACTION));
    return {
      // A floor, so the very first frame is not a zero-size view the compositor may skip.
      transform: [{ scale: Math.max(0.001, rippleEase(expand)) }],
      opacity: 1 - dissolve,
    };
  });

  const circle = { width: rMax * 2, height: rMax * 2, borderRadius: rMax };
  const at = origin
    ? { left: (origin.x ?? 0) - rMax, top: (origin.y ?? 0) - rMax }
    : { left: 0, top: 0 };

  return (
    <RippleNavContext.Provider value={{ rippleTo, rippleFrom }}>
      <View style={styles.root}>{children}</View>

      {origin ? (
        <View pointerEvents="none" style={styles.overlay}>
          <Animated.View style={[styles.veil, circle, at, veilStyle]} />
          {Array.from({ length: RING_COUNT }, (_, i) => (
            <Ring key={i} index={i} progress={progress} rMax={rMax} origin={origin} />
          ))}
        </View>
      ) : null}
    </RippleNavContext.Provider>
  );
}

function Ring({
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
  // Same trick as the veil: laid out once at full size, moved only by transform. `ringRadius`
  // is divided back out to a scale factor so the trailing-by-9%-of-rMax maths is untouched.
  const style = useAnimatedStyle(() => {
    const expand = Math.min(1, progress.value / EXPAND_FRACTION);
    const scale = rMax > 0 ? ringRadius(rippleEase(expand), rMax, index) / rMax : 0;
    const dissolve = Math.max(0, (progress.value - HOLD_FRACTION) / (1 - HOLD_FRACTION));
    return {
      transform: [{ scale: Math.max(0.001, scale) }],
      opacity: ringOpacity(expand, index) * (1 - dissolve),
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          borderWidth: 1 + RING_BLUR[index]! * 0.25,
          width: rMax * 2,
          height: rMax * 2,
          borderRadius: rMax,
          left: origin.x - rMax,
          top: origin.y - rMax,
        },
        style,
      ]}
    />
  );
}

/**
 * Navigate with the ripple. Falls back to plain navigation outside a provider, so a screen
 * rendered in isolation (a test, the kitchen sink) still works.
 */
export function useRippleNav(): RippleNavState {
  return (
    useContext(RippleNavContext) ?? {
      rippleTo: (_origin, navigate) => navigate(),
      rippleFrom: (_event, navigate) => navigate(),
    }
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  veil: { position: 'absolute', backgroundColor: color.bgBase },
  ring: { position: 'absolute', borderColor: 'rgba(184,150,60,0.55)' },
});
