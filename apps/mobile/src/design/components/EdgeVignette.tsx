import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBlurTarget } from '../blurTarget';
import { ANDROID_BLUR_METHOD, getGlassBackend } from '../glassConfig';
import { vignette } from '../tokens';

/**
 * The soft edge where scrolling content meets the status bar, the Dynamic Island, or the
 * pinned footer.
 *
 * ---------------------------------------------------------------- what this is fixing
 *
 * Every screen is a bare `ScrollView` with `paddingTop: insets.top + 14` and nothing over it,
 * so a row scrolls up under the island and stays perfectly sharp — text at full contrast
 * passing behind an opaque black cutout. It reads as content the app forgot to finish.
 *
 * ---------------------------------------------------------------- why it is built this way
 *
 * Apple ships exactly this natively as of iOS 26 (`UIScrollEdgeEffect`, SwiftUI's
 * `.scrollEdgeEffectStyle`): content is blurred AND dimmed where it meets a system bar. That
 * would have been the right answer, and step 0 was checking whether we could reach it —
 * `expo-glass-effect`, `expo-router` and `react-native-screens` were all searched, and none of
 * them surface it. Same shape as the Reanimated transition API that RNS 4.26 ships and
 * expo-router does not expose. So it is hand-rolled, and it follows what the native effect
 * does: blur and dim together, never one alone.
 *
 * **The trap, which is worth stating because the obvious build is the wrong one.** One
 * `BlurView` under a gradient mask does not work. It blurs *uniformly* and then fades in
 * OPACITY, so the result is a rectangle of evenly-frosted glass whose edge you can see — a fog
 * patch, not focus dissolving. Every pixel inside it is blurred by the same amount.
 *
 * What is wanted is a blur whose RADIUS ramps, which RN cannot express directly. So it is
 * approximated geometrically: N blur layers stacked, each masked to a band reaching a little
 * less far from the edge than the last. A `UIVisualEffectView` samples everything rendered
 * behind it, siblings included, so the layers compound — near the edge all N overlap, at the
 * far side only the first does, and in between the count falls off smoothly. Per-layer
 * intensity stays LOW and constant precisely because they multiply; turning it up is the wrong
 * knob and produces the fog patch again.
 *
 * ---------------------------------------------------------------- Android
 *
 * Deliberately a single gradient, no blur. `getGlassBackend()` already returns `fallback`
 * there, and expo-blur on Android needs a `blurTarget` and pays real cost per surface — N
 * stacked blurs is precisely what that switch exists to prevent. The scrim alone still reads
 * as intentional, which is the same conclusion `glassConfig` reached about glass panels.
 *
 * ---------------------------------------------------------------- measured, on a screen that scrolls
 *
 * This was built but never judged against scrolling text, which is the only thing it exists
 * for. Measured on the picker (iPhone 17 Pro, iOS 26.5) with "Goa, finally" scrolled under the
 * island and "Sunday football" left sharp below the band — same weight, same face, same card,
 * so the only variable is the vignette. `detail` is the mean absolute luminance difference
 * between horizontally-adjacent pixels, which is a blur proxy: sharp glyph edges score high,
 * smeared ones score low.
 *
 *     title  in band   detail  0.60   lum  45      title  below   detail  21-25   lum 145
 *     meta   in band   detail  1.2    lum  45      meta   below   detail  9.6     lum  67
 *
 * ~35x less high-frequency detail on the title and a third of the luminance. The `meta` row
 * sits deeper into the ramp and is softened less, which is the ramp working rather than a
 * shortfall. Sampling straight down the band showed luminance rising monotonically with no
 * plateaus, so the six layers are not banding — the artefact this build was chosen to avoid.
 *
 * **The tokens were left alone.** The temptation after measuring is to adjust something to show
 * for it; there was nothing wrong to adjust.
 *
 * ---------------------------------------------------------------- why only the top edge is mounted
 *
 * `edge="bottom"` works and is deliberately not mounted anywhere. Screens with a pinned action
 * already fade their own bottom — `FooterBar` draws an SVG gradient for exactly this — and
 * doubling them would darken that corner twice. Home has no footer, so its bottom edge is bare
 * once there are enough groups to scroll; that is a live gap rather than a settled decision,
 * and the thing to check first is the FAB, whose lower ~3pt would fall inside a default-height
 * bottom band.
 */
export function EdgeVignette({
  edge = 'top',
  height,
  layers = vignette.layers,
  intensity = vignette.intensity,
}: {
  edge?: 'top' | 'bottom';
  /** Defaults to the safe-area inset for this edge plus `vignette.overhang`. */
  height?: number;
  layers?: number;
  intensity?: number;
}) {
  const insets = useSafeAreaInsets();
  const blurTarget = useBlurTarget();
  const backend = getGlassBackend();

  const inset = edge === 'top' ? insets.top : insets.bottom;
  const span = height ?? inset + vignette.overhang;

  // A screen with no inset on this edge has nothing to protect content from.
  if (span <= 0) return null;

  const box = [
    styles.box,
    edge === 'top' ? styles.top : styles.bottom,
    { height: span },
  ];

  /*
   * Mask direction. `start`/`end` are in unit coordinates, so flipping them is the whole
   * difference between the two edges — the stop maths below stays in "distance from the edge"
   * and never has to know which edge it is.
   */
  const from = edge === 'top' ? { x: 0, y: 0 } : { x: 0, y: 1 };
  const to = edge === 'top' ? { x: 0, y: 1 } : { x: 0, y: 0 };

  // The dim half of the effect, and on the fallback path the whole of it.
  const tint = (
    <LinearGradient
      start={from}
      end={to}
      colors={[vignette.tintStrong, vignette.tintMid, vignette.tintNone]}
      locations={[0, 0.55, 1]}
      style={StyleSheet.absoluteFill}
    />
  );

  if (backend === 'fallback') {
    return (
      <View pointerEvents="none" style={box}>
        {tint}
      </View>
    );
  }

  return (
    <View pointerEvents="none" style={box}>
      {Array.from({ length: layers }, (_, i) => {
        /*
         * How far this layer reaches from the edge, as a fraction of `span`.
         *
         * Layer 0 covers the whole band; each subsequent one stops shorter. The exponent
         * clusters the stops toward the edge, so the count of overlapping layers falls off
         * fast where the eye is looking and slowly where it would otherwise band.
         */
        const reach = Math.pow((layers - i) / layers, vignette.curve);

        return (
          <MaskedView
            key={i}
            style={StyleSheet.absoluteFill}
            maskElement={
              <LinearGradient
                start={from}
                end={to}
                // Opaque for the inner part of this layer's reach, then a soft ramp to nothing.
                // A hard stop here is what puts a visible line across the blur.
                colors={['#000', '#000', 'transparent']}
                locations={[0, reach * vignette.softness, reach]}
                style={StyleSheet.absoluteFill}
              />
            }
          >
            <BlurView
              intensity={intensity}
              tint="dark"
              blurReductionFactor={4}
              experimentalBlurMethod={ANDROID_BLUR_METHOD}
              blurTarget={blurTarget}
              style={StyleSheet.absoluteFill}
            />
          </MaskedView>
        );
      })}
      {tint}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Above the screen's own content, below the ripple veil — which is a sibling of the whole
    // navigator and carries its own zIndex. See RippleNav.
    zIndex: 5,
  },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
