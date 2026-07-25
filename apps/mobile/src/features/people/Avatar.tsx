import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { color, font } from '@/design';

/** First letters of the first two words. "Priya Sharma" → "PS". */
export function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

/**
 * A person, as a circle.
 *
 * Falls back to initials rather than a generic silhouette: in a list of five people, five
 * identical silhouettes are worse than useless, whereas initials are actually distinguishing.
 */
export function Avatar({
  name,
  url,
  size = 48,
  tone = 'oxblood',
}: {
  name: string;
  url?: string | null;
  size?: number;
  tone?: 'oxblood' | 'gold' | 'plain';
}) {
  const palette =
    tone === 'gold'
      ? { border: color.owedBorder, fill: color.owedFill }
      : tone === 'plain'
        ? { border: color.glassBorder, fill: 'rgba(255,255,255,0.06)' }
        : { border: 'rgba(184,150,60,0.4)', fill: color.oweFill };

  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderColor: palette.border,
    backgroundColor: palette.fill,
  };

  if (url) {
    return (
      <View style={[styles.circle, frame]}>
        <Image source={{ uri: url }} style={[styles.image, { borderRadius: size / 2 }]} />
      </View>
    );
  }

  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={[styles.circle, frame]}>
      <Text style={[styles.initials, { fontSize: size * 0.35 }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  initials: { fontFamily: font.medium, color: color.cream, letterSpacing: 0.4 },
});
