import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ANDROID_BLUR_METHOD, getGlassBackend } from '../glassConfig';
import { blur as blurToken, color, radius as radiusToken, shadow } from '../tokens';

export interface GlassSurfaceProps {
  children?: ReactNode;
  /** Corner radius. Defaults to the standard card radius. */
  radius?: number;
  /** Blur strength. Ignored by the fallback backend. */
  intensity?: number;
  /** Slightly brighter fill, for surfaces that sit on top of other glass. */
  raised?: boolean;
  /** Gold border instead of the neutral one — used for active/selected states. */
  active?: boolean;
  /** Drop the border entirely. */
  borderless?: boolean;
  /** Depth shadow beneath the surface. Defaults to the row shadow. */
  elevation?: keyof typeof shadow | 'none';
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * The material every card, pill, row and sheet is built from.
 *
 * Three backends, chosen by `glassConfig`. The inner top-edge highlight is what sells the
 * material as having thickness — without it the surfaces read as flat translucent rectangles
 * rather than glass, which is most of the difference between this and a generic dark theme.
 */
export function GlassSurface({
  children,
  radius = radiusToken.card,
  intensity = blurToken.card,
  raised = false,
  active = false,
  borderless = false,
  elevation = 'row',
  style,
  contentStyle,
}: GlassSurfaceProps) {
  const backend = getGlassBackend();

  const shell: StyleProp<ViewStyle> = [
    styles.shell,
    { borderRadius: radius },
    elevation !== 'none' && shadow[elevation],
    !borderless && {
      borderWidth: 1,
      borderColor: active ? color.glassBorderActive : color.glassBorder,
    },
    style,
  ];

  const fill = raised ? color.glassFill : color.glassFill;
  const opaqueFill = raised ? color.glassFallbackRaised : color.glassFallback;

  return (
    <View style={shell}>
      {backend === 'fallback' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: opaqueFill }]} />
      ) : backend === 'liquid' ? (
        // Apple's native Liquid Glass (iOS 26+) — precisely the material the design doc names.
        // NOTE: unverified on a device; there is no iOS toolchain on this machine yet, so this
        // branch is written from the API contract. Check it before Phase 4 ships on iOS.
        <GlassView
          glassEffectStyle="regular"
          colorScheme="dark"
          tintColor={fill}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <>
          <BlurView
            intensity={intensity}
            tint="dark"
            experimentalBlurMethod={ANDROID_BLUR_METHOD}
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
        </>
      )}

      {/* Inner highlight along the top edge — the thing that reads as material thickness. */}
      <View
        pointerEvents="none"
        style={[styles.topHighlight, { borderTopLeftRadius: radius, borderTopRightRadius: radius }]}
      />

      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  content: {
    position: 'relative',
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: color.glassHighlight,
  },
});
