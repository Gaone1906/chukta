import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path, Text as SvgText } from 'react-native-svg';

import { color, font, motion, useReduceMotion } from '@/design';

export interface PaidStampProps {
  /** Printed under the wordmark. Already formatted — "27 JUL 2026". */
  date?: string;
  /**
   * Press it down, or render it already there.
   *
   * The stamp lands ONCE, on the tap. Reopening the expense afterwards shows it sitting there,
   * still — an animation that replays on every visit stops being a moment and becomes a tic.
   * The screen decides which by remembering whether it was the one that did the marking.
   */
  animate?: boolean;
  /** Overall width in points. The height follows the 252×104 artwork. */
  width?: number;
}

const ART_WIDTH = 252;
const ART_HEIGHT = 104;

/*
 * The two borders, drawn as bowed curves rather than rounded rects.
 *
 * The approved mockup got its pressed edge from an SVG filter chain — `feTurbulence` displacing
 * the border, then eating pinholes out of it. **That does not work here.** react-native-svg
 * 15.15.4 does not implement `feTurbulence` or `feDisplacementMap` on either native platform
 * (`lib/module/lib/util.js` warns and drops them), and `mottle` compositing `operator="out"`
 * against a turbulence source that produced nothing is a coin flip between "no effect" and "the
 * whole stamp disappears". Shipping a money screen on that would be a bad bet.
 *
 * So the irregularity is in the geometry instead: every edge bows by a point or two and no two
 * corners sit at the same radius, which is what makes it read as pressed rather than drawn. It
 * costs two path strings, needs no filter support, and looks the same on both platforms.
 */
const OUTER_BORDER =
  'M13.2 5.4 Q126 6.6 238.8 4.8 Q247.4 5.2 247.1 13.6 Q248.4 52 246.9 90.6 ' +
  'Q247.2 98.4 238.6 98.7 Q126 97.4 13.4 99.1 Q4.8 98.7 5.1 90.3 ' +
  'Q3.7 52 5.3 13.4 Q5 5.7 13.2 5.4 Z';
const INNER_BORDER =
  'M18 13.1 Q126 12.2 234 13.4 Q239.2 13.6 239 18.6 Q240 52 238.9 85.6 ' +
  'Q239.1 90.7 233.9 90.9 Q126 91.8 18.1 90.6 Q12.9 90.4 13.1 85.4 ' +
  'Q12.2 52 13.2 18.4 Q13 13.3 18 13.1 Z';

/**
 * "PAID IN FULL", pressed across the amount.
 *
 * ---------------------------------------------------------------- the motion is not new
 *
 * These are the seal's own keyframes, the same ones `design/components/Seal.tsx` ports from
 * design-reference/assets/hisaab-seal.js — 760ms, scale 1.5 → .965 → 1.014 → 1 with the
 * overshoot at 78%, and a halo expanding past it. Reusing them is the point: the app already has
 * one gesture that means "this is settled", and a second one invented here would read as a
 * different app. The piecewise interpolation below is lifted from Seal for the same reason —
 * two functions that are meant to produce identical motion should not be written twice.
 *
 * The blur in the original CSS keyframes is dropped, exactly as Seal drops it: React Native
 * cannot animate a blur cheaply, and at this speed the scale overshoot carries the impact alone.
 *
 * ---------------------------------------------------------------- why it sits on the amount
 *
 * Across the figure, not beside it. The stamp is a statement *about the money*, and the amount
 * is what anyone scanning the screen looks at first. The figures dim underneath rather than
 * disappearing — the number still matters, it just stops being a question.
 *
 * What stops it reading as a graphic rather than an impression is the border geometry — see the
 * note on OUTER_BORDER, and why the mockup's filter approach could not survive the crossing to
 * native.
 */
export function PaidStamp({ date, animate = false, width = 252 }: PaidStampProps) {
  const reduceMotion = useReduceMotion();
  const height = Math.round((width / ART_WIDTH) * ART_HEIGHT);

  // Starts landed unless this render is the one doing the pressing.
  const progress = useSharedValue(animate && !reduceMotion ? 0 : 1);
  const halo = useSharedValue(animate && !reduceMotion ? 0 : 1);

  useEffect(() => {
    if (!animate || reduceMotion) {
      progress.value = 1;
      halo.value = 1;
      return;
    }

    progress.value = withTiming(1, {
      duration: motion.seal.stamp,
      easing: Easing.bezier(0.2, 0.85, 0.25, 1),
    });
    halo.value = withTiming(1, {
      duration: motion.seal.halo,
      easing: Easing.out(Easing.ease),
    });

    return () => {
      cancelAnimation(progress);
      cancelAnimation(halo);
    };
  }, [animate, reduceMotion, progress, halo]);

  const stampStyle = useAnimatedStyle(() => {
    const p = progress.value;
    // Piecewise, to reproduce the overshoot: 1.5 → .965 by 55%, up to 1.014 at 78%, home at 1.
    const scale =
      p < 0.55
        ? 1.5 + (0.965 - 1.5) * (p / 0.55)
        : p < 0.78
          ? 0.965 + (1.014 - 0.965) * ((p - 0.55) / 0.23)
          : 1.014 + (1 - 1.014) * ((p - 0.78) / 0.22);
    // The artwork already sits at -13°; this is the wobble the press adds on top of it.
    const wobble =
      p < 0.55
        ? -9 + (1.5 + 9) * (p / 0.55)
        : p < 0.78
          ? 1.5 + (-0.6 - 1.5) * ((p - 0.55) / 0.23)
          : -0.6 + 0.6 * ((p - 0.78) / 0.22);
    return {
      opacity: Math.min(1, p / 0.55),
      transform: [{ rotate: `${-13 + wobble}deg` }, { scale }],
    };
  });

  const haloStyle = useAnimatedStyle(() => {
    const h = halo.value;
    return {
      opacity: h >= 1 ? 0 : h < 0.4 ? (h / 0.4) * 0.55 : 0.55 * (1 - (h - 0.4) / 0.6),
      transform: [{ rotate: '-13deg' }, { scale: 0.7 + h * 0.8 }],
    };
  });

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View
        style={[
          styles.halo,
          { width: width * 0.99, height: height * 1.08, borderRadius: 12 },
          haloStyle,
        ]}
      />

      <Animated.View
        accessibilityRole="image"
        accessibilityLabel={date ? `Paid in full, ${date}` : 'Paid in full'}
        style={stampStyle}
      >
        <Svg width={width} height={height} viewBox={`0 0 ${ART_WIDTH} ${ART_HEIGHT}`}>
          <Path
            d={OUTER_BORDER}
            fill="none"
            stroke={color.goldLeaf}
            strokeWidth={3}
            strokeLinejoin="round"
            opacity={0.92}
          />
          <Path
            d={INNER_BORDER}
            fill="none"
            stroke={color.goldLeaf}
            strokeWidth={1}
            strokeLinejoin="round"
            opacity={0.55}
          />
          <SvgText
            x={126}
            y={52}
            fill={color.goldBright}
            textAnchor="middle"
            fontFamily={font.display}
            fontSize={27}
            letterSpacing={1.6}
          >
            PAID IN FULL
          </SvgText>
          {date ? (
            <SvgText
              x={126}
              y={76}
              fill={color.goldLeaf}
              textAnchor="middle"
              fontFamily={font.medium}
              fontSize={10}
              letterSpacing={3.4}
              opacity={0.8}
            >
              {date}
            </SvgText>
          ) : null}
        </Svg>
      </Animated.View>
    </View>
  );
}

/** "27 JUL 2026" from an ISO timestamp. Uppercase, because the stamp is set in caps. */
export function stampDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(184,150,60,0.55)' },
});
