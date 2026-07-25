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
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { color, motion } from '../tokens';
import { useReduceMotion } from '../useReduceMotion';
import { isTransitioning } from './transitionState';
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
 * **3. The curve had spent itself in the first sixth of the phase.** Twice — the replacement
 * bezier had the same fault as the curve it replaced, just less of it. See the note on the
 * three shared values below, which is the actual fix.
 *
 * **4. Two chained `withTiming`s with a `runOnJS` between them.** The second animation was
 * started from the first one's completion callback, so there was a handoff on the JS thread in
 * the middle of the transition. Nothing starts another animation now: all three run
 * independently from the same tap, and no phase waits on JS to begin.
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
 * How the total is spent. The old split gave the expand half the budget and put the hard part
 * of the curve at the very start, so the only visible motion was over in about a tenth of a
 * second; most of the duration was an invisible veil holding and fading.
 */
const { cover: COVER_MS, hold: HOLD_MS, dissolve: DISSOLVE_MS } = motion.ripple;

/** The rings travel across the cover AND the hold, arriving exactly as the dissolve starts. */
const TRAVEL_MS = COVER_MS + HOLD_MS;

export function RippleNavProvider({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();

  /*
   * ---------------------------------------------------------------- three values, not one
   *
   * The veil and the rings want OPPOSITE curves, and driving both from a single `progress` is
   * what made this stall. A filled disc covers area ∝ r², so the veil must ease out or its
   * coverage appears to accelerate into the corners. A thin ring is a travelling wavefront, so
   * it wants constant radial speed — linear. One value cannot be both, and the compromise
   * curve that was there served neither.
   *
   * The old value was also a `withSequence`, which meant a segment boundary sat in the middle
   * of the thing the eye was tracking. `Easing.bezier(0.16, 0.6, 0.22, 1)` has terminal slope
   * exactly zero (its second control point sits at y=1), so it arrived at the boundary stopped
   * dead — and the next segment was `Easing.linear`, which restarted at full speed. That step
   * was measured at ~74× across a single frame. It is the stall, and it is unfixable while the
   * two share a value.
   *
   * So: three values, ONE continuous segment each, no `withSequence` anywhere. Nothing the eye
   * follows crosses a boundary.
   */

  /** Veil coverage, 0→1 over `cover`. Eased out, because it is a filled disc. */
  const veil = useSharedValue(0);
  /** Ring travel, 0→1 over `cover + hold`. **Linear**, because they are wavefronts. */
  const wave = useSharedValue(0);
  /** The fade-out, 0→1 over `dissolve`, delayed until the rings have arrived. */
  const dissolve = useSharedValue(0);
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
      // Tells the ambient background to stop drifting for the duration — see transitionState.
      isTransitioning.set(true);

      veil.set(0);
      wave.set(0);
      dissolve.set(0);

      /*
       * The veil closes over the screen, and navigates the instant it is opaque.
       *
       * The push fires from this completion callback rather than the old `useAnimatedReaction`
       * watching a progress threshold. That reaction ran a comparison on EVERY frame of the
       * transition to detect one crossing; a callback fires once, at exactly the right moment,
       * and cannot miss the frame the threshold fell between.
       *
       * This is not the chained-animation trap the header warns about. Nothing is *started*
       * here — all three animations are already running. The only thing crossing to JS is the
       * navigation itself, which has to happen on JS regardless.
       */
      veil.set(
        withTiming(1, { duration: COVER_MS, easing: Easing.out(Easing.quad) }, (done) => {
          if (done) runOnJS(fireNavigation)();
        }),
      );

      // Linear, and one segment across cover+hold: the rings keep moving at a constant rate
      // straight through the moment the veil goes opaque, so there is no point at which the
      // only thing on screen is a motionless rectangle.
      wave.set(withTiming(1, { duration: TRAVEL_MS, easing: Easing.linear }));

      dissolve.set(
        withDelay(
          TRAVEL_MS,
          withTiming(1, { duration: DISSOLVE_MS, easing: Easing.out(Easing.quad) }, (done) => {
            // A UI-thread callback, not `runOnJS`: putting the overlay away is just shared
            // values, and there is no React state left to clear.
            if (done) {
              active.set(0);
              isTransitioning.set(false);
            }
          }),
        ),
      );
    },
    [active, dissolve, fireNavigation, height, originX, originY, reach, reduceMotion, veil, wave, width],
  );

  const rippleFrom = useCallback(
    (event: GestureResponderEvent, navigate: () => void) => {
      const { pageX, pageY } = event.nativeEvent;
      rippleTo({ x: pageX, y: pageY }, navigate);
    },
    [rippleTo],
  );

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: active.value,
  }));

  const veilStyle = useAnimatedStyle(() => {
    const d = dissolve.value;

    // `reach / span` is what the wavefront needs for THIS origin; a tap in the middle of the
    // screen has less ground to cover than one in a corner, and the circle is laid out for the
    // worst case.
    const scale = (veil.value * reach.value * veilDrift(d)) / span;

    return {
      transform: [
        { translateX: originX.value - span },
        { translateY: originY.value - span },
        // A floor, so the very first frame is not a zero-size layer the compositor may skip.
        { scale: Math.max(0.0001, scale) },
      ],
      opacity: 1 - d,
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
            wave={wave}
            dissolve={dissolve}
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
 * invisible. So they are given the whole timeline rather than just the cover: they keep
 * travelling through the hold, which is the window in which the incoming screen mounts. That
 * is the expensive part of the transition, and it is much better spent watching something move
 * than watching a static opaque rectangle.
 *
 * They move at CONSTANT speed, and that is the single most important thing about them. See
 * `ringRadius` in rippleMath for why a wavefront and a filled disc need opposite curves.
 */
function Ring({
  index,
  wave,
  dissolve,
  reach,
  span,
  diameter,
  originX,
  originY,
}: {
  index: number;
  wave: SharedValue<number>;
  dissolve: SharedValue<number>;
  reach: SharedValue<number>;
  span: number;
  diameter: number;
  originX: SharedValue<number>;
  originY: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    // `wave` is already linear across cover+hold, so this is the raw position — no easing is
    // applied on top. Each ring trails the leader by a fixed fraction of the total reach.
    const lagged = wave.value - index * RING_LAG;
    const radius = Math.max(0, lagged) * reach.value;

    return {
      transform: [
        { translateX: originX.value - span },
        { translateY: originY.value - span },
        { scale: Math.max(0.0001, radius / span) },
      ],
      // `lagged`, not the leading edge: each ring fades against where IT is. Multiplied by the
      // dissolve so all three leave with the veil however far along their own travel they got.
      opacity: lagged <= 0 ? 0 : ringOpacity(lagged, index) * (1 - dissolve.value),
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
export const RIPPLE_TOTAL_MS = COVER_MS + HOLD_MS + DISSOLVE_MS;

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, elevation: 10 },
  // `color.veil` is almost, but deliberately not exactly, `bgBase` — see the token.
  veil: { position: 'absolute', backgroundColor: color.veil },
  /*
   * `overflow: 'hidden'` is a performance property here, not a visual one — the ring has no
   * content to clip.
   *
   * React Native only maps a view onto CoreAnimation's native `layer.borderWidth` /
   * `borderColor` fast path when the view either has no sublayers or clips to its bounds.
   * Falling off it means the border is drawn into a CGImage on the main thread instead — and
   * these views are laid out at the screen's diagonal, so that is a bitmap thousands of pixels
   * square, rasterised three times, on the first frame of every transition.
   */
  ring: { position: 'absolute', borderColor: color.rippleRing, overflow: 'hidden' },
});
