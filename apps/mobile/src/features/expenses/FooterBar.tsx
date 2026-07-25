import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { color } from '@/design';

/**
 * The pinned primary action at the bottom of a scrolling form.
 *
 * The fade above it is not decoration: without it the list scrolls *through* the button and
 * the two become unreadable at exactly the moment the user is deciding whether to press it.
 * Home solves the same problem behind its FAB.
 *
 * Drawn as an SVG gradient rather than expo-linear-gradient because the glass backend already
 * degrades on Android and this must never be one more thing that can fail to render.
 */
export function FooterBar({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" style={styles.root}>
      <Svg
        pointerEvents="none"
        height={FADE_HEIGHT}
        width="100%"
        style={styles.fade}
        // Fixed aspect off so the gradient stretches to whatever width the screen is.
        preserveAspectRatio="none"
        viewBox="0 0 1 100"
      >
        <Defs>
          <LinearGradient id="footerFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color.bgBase} stopOpacity="0" />
            <Stop offset="0.4" stopColor={color.bgBase} stopOpacity="0.92" />
            <Stop offset="0.62" stopColor={color.bgBase} stopOpacity="1" />
            <Stop offset="1" stopColor={color.bgBase} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="1" height="100" fill="url(#footerFade)" />
      </Svg>

      <View style={[styles.content, { paddingBottom: insets.bottom + 18 }]}>{children}</View>
    </View>
  );
}

/** Bottom padding a scroll view needs so its last row can clear the bar. */
export const FOOTER_CLEARANCE = 170;

// Tall enough that the gradient is already fully opaque above the button. A fade that only
// reaches full opacity level with the button still lets a row read through it.
const FADE_HEIGHT = 210;

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  content: { paddingHorizontal: 22, gap: 8 },
});
