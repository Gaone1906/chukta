import { Image } from 'expo-image';
import { useState } from 'react';
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
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
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

  /*
   * A picture, unless it fails — then the initials, which is what an empty circle should have
   * been all along.
   *
   * Provider avatars are external URLs (`lh3.googleusercontent.com` for Google) and they do go
   * dead: Google's start returning 403 once someone changes their picture. Without `onError`
   * this rendered a blank tinted circle for a person whose initials were right there.
   *
   * Keyed on the URL rather than a bare boolean so a person who updates their photo is retried
   * instead of being stuck on initials for the life of the component.
   */
  if (url && failedUrl !== url) {
    return (
      <View style={[styles.circle, frame]}>
        <Image
          source={{ uri: url }}
          style={[styles.image, { borderRadius: size / 2 }]}
          onError={() => setFailedUrl(url)}
        />
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
