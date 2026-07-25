import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { color, motion } from '../tokens';
import { useReduceMotion } from '../useReduceMotion';
import {
  RING_BLUR,
  RING_COUNT,
  RING_LAG,
  maxRadius,
  ringOpacity,
  veilDrift,
} from './rippleMath';

/**
 * The ripple, as a navigation transition.
 *
 * `RippleReveal` masks one screen over another, which needs both as React nodes. A router does
 * not hand you that — expo-router owns mounting, and the incoming screen does not exist until
 * the push happens. So the transition is inverted: a veil in the app's own ground colour
 * expands from the tap point over the CURRENT screen, the navigation happens behind it at the
 * moment the veil is opaque, and the veil dissolves onto whatever is now there.
 *
 * ---------------------------------------------------------------- why this was rewritten
 *
 * The first version was correct and looked terrible, for four reasons that had nothing to do
 * with the maths. Worth listing, because each is a trap that would be walked into again.
 *
 * **1. It re-rendered the entire app twice per navigation.** The tap origin lived in React
 * state, and this provider renders `{children}` — which is the whole expo-router Stack. So
 * `setOrigin(...)` at the start and `setOrigin(null)` at the end each reconciled every mounted
 * screen. Worse, the context value was a fresh object literal on every render, so every
 * component calling `useRippleNav()` re-rendered too. The dropped frame landed exactly when
 * the user was looking at it. **Nothing here touches React state during a transition now** —
 * the origin, the radius and the progress are all shared values, and the overlay stays
 * mounted.
 *
 * **2. It transformed the whole navigator.** A `scale` on the view wrapping every screen, to
 * get the design's 1.8% settle-back. On this app that subtree is full of glass: `GlassSurface`
 * resolves to Apple's Liquid Glass on iOS 26, and Home alone stacks a segmented control, five
 * or more rows and a FAB. Transforming their common ancestor asks the system to recomposite
 * every one of those materials on every frame of the transition. 1.8% of visual interest is
 * not worth that, so the settle-back moved onto the veil itself — see `veilDrift`, which buys
 * the same depth cue from one solid layer that was already animating.
 *
 * **3. The curve had spent itself in the first sixth of the phase.** See `waveEase`.
 *
 * **4. Two chained `withTiming`s with a `runOnJS` between them.** The second animation was
 * started from the first one's completion callback, so there was a handoff on the JS thread in
 * the middle of the transition. It is one `withSequence` now, which runs start to finish on
 * the UI thread, and the navigation fires from a `useAnimatedReaction` instead.
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

/*
 * The timeline, as fractions of `progress`.
 *
 *   0      → COVER      the wavefront travels; the veil reaches full coverage at COVER
 *   COVER  → HOLD_END   fully opaque. The navigation fires the instant COVER is crossed, and
 *                       this is all the time the incoming screen gets to mount before it can
 *                       be seen. The rings are still travelling through here — deliberately,
 *                       so the most expensive frames of the transition happen while there is
 *                       something moving to look at.
 *   HOLD_END → 1        the veil drifts outward and dissolves onto the screen now underneath.
 *
 * `progress` is driven by a `withSequence` whose segments carry their own easing, so the value
 * is already eased when a worklet reads it and the phases below are plain linear remaps.
 */
const COVER = 0.62;
const HOLD_END = 0.78;

/**
 * How the total is spent. The old split gave the expand half the budget and put the hard part
 * of the curve at the very start, so the only visible motion was over in about a tenth of a
 * second; most of the duration was an invisible veil holding and fading.
 */
const { expand: EXPAND_MS, hold: HOLD_MS, dissolve: DISSOLVE_MS } = motion.ripple;

/** The wavefront's shape. Gentler than the prototype's — see `waveEase` in rippleMath. */
const WAVE_EASING = Easing.bezier(0.16, 0.6, 0.22, 1);

export function RippleNavProvider({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();

  const progress = useSharedValue(0);
  /** 0 when idle, so the compositor can skip four full-screen layers entirely. */
  const active = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  /** How far the wavefront has to travel for THIS tap. */
  const reach = useSharedValue(0);

  const navigateRef = useRef<(() => void) | null>(null);
  const firedRef = useRef(false);

  const fireNavigation = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const navigate = navigateRef.current;
    navigateRef.current = null;
    navigate?.();
  }, []);

  /*
   * The circles are laid out ONCE, at the largest radius any tap could ever need — the screen's
   * own diagonal, which is the distance from one corner to the opposite one. Everything after
   * that is `translate` and `scale`.
   *
   * This is what lets the origin be a shared value. Size and position are layout properties and
   * cannot be driven from the UI thread, so a per-tap circle would mean a React render per tap;
   * a fixed circle that is merely moved and scaled needs none.
   */
  const span = Math.sqrt(width * width + height * height);
  const diameter = span * 2;

  const rippleTo = useCallback(
    (from: { x: number; y: number }, navigate: () => void) => {
      if (reduceMotion) {
        navigate();
        return;
      }

      navigateRef.current = navigate;
      firedRef.current = false;

      // `.set()` rather than `.value =`: a bare assignment reads as a mutation on the render
      // path, and this runs from an onPress handler.
      originX.set(from.x);
      originY.set(from.y);
      reach.set(maxRadius(width, height, from.x, from.y));
      active.set(1);
      progress.set(0);

      progress.set(
        withSequence(
          withTiming(COVER, { duration: EXPAND_MS, easing: WAVE_EASING }),
          withTiming(HOLD_END, { duration: HOLD_MS, easing: Easing.linear }),
          withTiming(1, { duration: DISSOLVE_MS, easing: Easing.out(Easing.quad) }, (done) => {
            // A UI-thread callback, not `runOnJS`: putting the overlay away is just two shared
            // values, and there is no React state left to clear.
            if (done) active.set(0);
          }),
        ),
      );
    },
    [active, height, originX, originY, progress, reach, reduceMotion, width],
  );

  const rippleFrom = useCallback(
    (event: GestureResponderEvent, navigate: () => void) => {
      const { pageX, pageY } = event.nativeEvent;
      rippleTo({ x: pageX, y: pageY }, navigate);
    },
    [rippleTo],
  );

  /*
   * Push the moment the veil finishes covering the screen — not earlier, or the swap shows in
   * the corners the wavefront has not reached yet.
   *
   * A reaction rather than an animation callback. The old code started the dissolve *inside*
   * the expand's completion callback, which meant a JS hop sat between two animations in the
   * middle of the transition. Here the animation is one uninterrupted sequence on the UI
   * thread and this merely observes it going past.
   */
  useAnimatedReaction(
    () => progress.value,
    (current, previous) => {
      if (previous !== null && previous < COVER && current >= COVER) {
        runOnJS(fireNavigation)();
      }
    },
  );

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: active.value,
  }));

  const veilStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const wave = Math.min(1, p / COVER);
    const dissolve = p <= HOLD_END ? 0 : (p - HOLD_END) / (1 - HOLD_END);

    // `reach / span` is what the wavefront needs for THIS origin; a tap in the middle of the
    // screen has less ground to cover than one in a corner, and the circle is laid out for the
    // worst case.
    const scale = (wave * reach.value * veilDrift(dissolve)) / span;

    return {
      transform: [
        { translateX: originX.value - span },
        { translateY: originY.value - span },
        // A floor, so the very first frame is not a zero-size layer the compositor may skip.
        { scale: Math.max(0.0001, scale) },
      ],
      opacity: 1 - dissolve,
    };
  });

  return (
    <RippleNavContext.Provider value={useMemo(() => ({ rippleTo, rippleFrom }), [rippleTo, rippleFrom])}>
      {/*
        * A plain View. It used to be an `Animated.View` carrying the settle-back transform,
        * which is what made every glass surface in the app recomposite on every frame.
        */}
      <View style={styles.root}>{children}</View>

      {/*
        * Always mounted, and invisible until it is needed. Mounting it per transition was a
        * React render of the whole tree at exactly the wrong moment; at `opacity: 0` these four
        * layers cost nothing to skip.
        *
        * zIndex is load-bearing rather than defensive: sibling order alone stopped being enough
        * once anything in the tree carried a transform, and this has to stay above the screen
        * it is covering.
        */}
      <Animated.View pointerEvents="none" style={[styles.overlay, overlayStyle]}>
        <Animated.View
          style={[styles.veil, { width: diameter, height: diameter, borderRadius: span }, veilStyle]}
        />
        {Array.from({ length: RING_COUNT }, (_, i) => (
          <Ring
            key={i}
            index={i}
            progress={progress}
            reach={reach}
            span={span}
            diameter={diameter}
            originX={originX}
            originY={originY}
          />
        ))}
      </Animated.View>
    </RippleNavContext.Provider>
  );
}

/**
 * One trailing ring.
 *
 * The rings are the only part of the wavefront that can actually be seen — the veil is the
 * exact colour the screens already sit on, which is what hides the seam and also what makes it
 * invisible. So they are given the whole timeline rather than just the expand: they keep
 * travelling through the hold, which is the window in which the incoming screen mounts. That
 * is the expensive part of the transition, and it is much better spent watching something move
 * than watching a static opaque rectangle.
 */
function Ring({
  index,
  progress,
  reach,
  span,
  diameter,
  originX,
  originY,
}: {
  index: number;
  progress: SharedValue<number>;
  reach: SharedValue<number>;
  span: number;
  diameter: number;
  originX: SharedValue<number>;
  originY: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    // Mapped across the expand AND the hold, so the ring arrives as the dissolve begins.
    const travel = Math.min(1, progress.value / HOLD_END);
    const lagged = travel - index * RING_LAG;
    const radius = Math.max(0, lagged) * reach.value;

    return {
      transform: [
        { translateX: originX.value - span },
        { translateY: originY.value - span },
        { scale: Math.max(0.0001, radius / span) },
      ],
      opacity: lagged <= 0 ? 0 : ringOpacity(travel, index),
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          /*
           * The prototype draws a 1px stroke and blurs it by RING_BLUR px. React Native cannot
           * blur a view cheaply, so the blur is traded for width: a 1px line blurred by `b`
           * covers roughly `1 + 2b` px, just with soft edges instead of hard ones.
           */
          borderWidth: 1 + RING_BLUR[index]! * 2,
          width: diameter,
          height: diameter,
          borderRadius: span,
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

/** Total wall-clock time of one transition. Exported so the kitchen sink can say so. */
export const RIPPLE_TOTAL_MS = EXPAND_MS + HOLD_MS + DISSOLVE_MS;

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, elevation: 10 },
  // `color.veil` is almost, but deliberately not exactly, `bgBase` — see the token.
  veil: { position: 'absolute', backgroundColor: color.veil },
  ring: { position: 'absolute', borderColor: color.rippleRing },
});
