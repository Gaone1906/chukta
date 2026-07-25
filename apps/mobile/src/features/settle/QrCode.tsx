import createQr from 'qrcode-generator';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

/**
 * The fallback that always works.
 *
 * iOS has no `upi://` system handler and Android bank apps sometimes ignore the intent, so
 * every settle-up offers the same URI as a scannable code. Any UPI app reads it off the
 * screen, or off a screenshot sent to whoever is paying.
 *
 * Rendered as one SVG `Path` of rectangles rather than a grid of `Rect` elements: a version-6
 * code is 41×41, and ~1,700 native views is a visible stutter on the low-end Android the
 * design has to survive on.
 *
 * The quiet zone is not decoration — scanners need four modules of margin to find the
 * finder patterns, and codes that "sometimes don't scan" are usually missing it.
 */
export function QrCode({
  value,
  size = 220,
  quietZone = 4,
}: {
  value: string;
  size?: number;
  quietZone?: number;
}) {
  const { path, cells } = useMemo(() => {
    // Type 0 lets the library pick the smallest version that fits. 'M' recovers ~15% of a
    // damaged or partly-obscured code, which is the level UPI QRs conventionally use.
    const qr = createQr(0, 'M');
    qr.addData(value);
    qr.make();

    const count = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          d += `M${col + quietZone} ${row + quietZone}h1v1h-1z`;
        }
      }
    }
    return { path: d, cells: count + quietZone * 2 };
  }, [value, quietZone]);

  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${cells} ${cells}`}>
        {/* Light background is required, not stylistic: scanners expect dark-on-light, and
            this app is otherwise entirely dark. */}
        <Rect x={0} y={0} width={cells} height={cells} fill="#F4EDE4" />
        <Path d={path} fill="#0A0405" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'center',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F4EDE4',
  },
});
