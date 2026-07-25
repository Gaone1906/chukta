import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { isTransitioning } from '../motion/transitionState';
import { color } from '../tokens';
import { useReduceMotion } from '../useReduceMotion';

/**
 * The oxblood radial glow plus four slowly drifting colour blobs that sit behind every glass
 * panel. Mounted once at the root, not per screen — the glass has nothing to refract without
 * it, and re-mounting it per screen would restart the drift on every navigation.
 *
 * Blobs are SVG radial gradients fading to transparent rather than blurred views: it looks the
 * same, costs a fraction as much, and does not fight the glass surfaces for blur budget.
 */

interface Blob {
  /** Fractions of screen width/height, so this scales across device sizes. */
  x: number;
  y: number;
  size: number;
  color: string;
  opacity: number;
  durationMs: number;
  dx: number;
  dy: number;
  scaleTo: number;
}

const BLOBS: Blob[] = [
  { x: -0.3, y: -0.18, size: 0.87, color: color.oxblood, opacity: 0.5, durationMs: 18000, dx: 14, dy: -18, scaleTo: 1.06 },
  { x: 0.68, y: 0.26, size: 0.77, color: color.goldLeaf, opacity: 0.26, durationMs: 22000, dx: -18, dy: 12, scaleTo: 1.04 },
  { x: -0.23, y: 0.72, size: 0.97, color: color.oxblood, opacity: 0.42, durationMs: 26000, dx: 14, dy: -18, scaleTo: 1.05 },
  { x: 0.62, y: 0.82, size: 0.64, color: color.goldLeaf, opacity: 0.2, durationMs: 30000, dx: -18, dy: 12, scaleTo: 1.03 },
];

function DriftingBlob({ blob, width, height, animate }: { blob: Blob; width: number; height: number; animate: boolean }) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (!animate) return;
    t.value = withRepeat(
      withTiming(1, { duration: blob.durationMs, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(t);
  }, [animate, blob.durationMs, t]);

  /*
   * Hold still while a screen transition is playing.
   *
   * These blobs sit BEHIND every glass surface in the app, so as long as they are moving the
   * blur backdrop is dirty on every frame and every `GlassSurface` on screen has to be
   * re-evaluated — including the ones on the screen that is mounting under the veil, which is
   * the most expensive moment in a navigation.
   *
   * They are also invisible for most of a transition, since the veil is covering them. So this
   * costs nothing to look at and gives the incoming screen the frame budget back. Entirely on
   * the UI thread: a reaction on a shared value, no render on either side.
   */
  useAnimatedReaction(
    () => isTransitioning.value,
    (paused, wasPaused) => {
      if (!animate || paused === wasPaused) return;

      if (paused) {
        cancelAnimation(t);
        return;
      }

      // Resumes from wherever it stopped rather than snapping back to the start; `reverse` on
      // withRepeat means the drift simply carries on in whichever direction it was going.
      t.set(
        withRepeat(
          withTiming(1, { duration: blob.durationMs, easing: Easing.inOut(Easing.ease) }),
          -1,
          true,
        ),
      );
    },
  );

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: t.value * blob.dx },
      { translateY: t.value * blob.dy },
      { scale: 1 + t.value * (blob.scaleTo - 1) },
    ],
  }));

  const size = blob.size * width;
  const id = `blob-${blob.x}-${blob.y}`;

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: blob.x * width, top: blob.y * height, width: size, height: size }, style]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={blob.color} stopOpacity={blob.opacity} />
            <Stop offset="55%" stopColor={blob.color} stopOpacity={blob.opacity * 0.45} />
            <Stop offset="100%" stopColor={blob.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

export function AmbientBackground() {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color.bgBase }]}>
      {/* Base radial glow: bright oxblood high on the screen, falling away to near-black. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="ambient" cx="50%" cy="18%" rx="120%" ry="76%">
            <Stop offset="0%" stopColor={color.glowInner} />
            <Stop offset="46%" stopColor={color.glowMid} />
            <Stop offset="100%" stopColor={color.glowOuter} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#ambient)" />
      </Svg>

      {BLOBS.map((blob, i) => (
        <DriftingBlob key={i} blob={blob} width={width} height={height} animate={!reduceMotion} />
      ))}
    </View>
  );
}
