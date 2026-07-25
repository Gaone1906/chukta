import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
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
}

const RippleNavContext = createContext<RippleNavState | null>(null);

const EXPAND_FRACTION = 0.55;

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

      // The push happens while the veil is fully opaque, so the stack swap is never seen.
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

  const rMax = origin ? maxRadius(width, height, origin.x, origin.y) : 0;

  const veilStyle = useAnimatedStyle(() => {
    // Expand phase drives the radius; dissolve phase drives the opacity.
    const expand = Math.min(1, progress.value / EXPAND_FRACTION);
    const dissolve = Math.max(0, (progress.value - EXPAND_FRACTION) / (1 - EXPAND_FRACTION));
    const r = Math.max(1, rippleEase(expand) * rMax);
    return {
      width: r * 2,
      height: r * 2,
      borderRadius: r,
      left: (origin?.x ?? 0) - r,
      top: (origin?.y ?? 0) - r,
      opacity: 1 - dissolve,
    };
  });

  return (
    <RippleNavContext.Provider value={{ rippleTo }}>
      {children}

      {origin ? (
        <View pointerEvents="none" style={styles.overlay}>
          <Animated.View style={[styles.veil, veilStyle]} />
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
  const style = useAnimatedStyle(() => {
    const expand = Math.min(1, progress.value / EXPAND_FRACTION);
    const r = ringRadius(rippleEase(expand), rMax, index);
    const dissolve = Math.max(0, (progress.value - EXPAND_FRACTION) / (1 - EXPAND_FRACTION));
    return {
      width: r * 2,
      height: r * 2,
      borderRadius: r,
      left: origin.x - r,
      top: origin.y - r,
      opacity: ringOpacity(expand, index) * (1 - dissolve),
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ring, { borderWidth: 1 + RING_BLUR[index]! * 0.25 }, style]}
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
    }
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  veil: { position: 'absolute', backgroundColor: color.bgBase },
  ring: { position: 'absolute', borderColor: 'rgba(184,150,60,0.55)' },
});
