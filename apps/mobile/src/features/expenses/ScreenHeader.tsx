import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { color, font } from '@/design';
import { BackChevron } from '@/features/onboarding/BackChevron';

/** Back chevron, title and an optional trailing action. Shared by the detail screens. */
export function ScreenHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <BackChevron onPress={() => router.back()} />
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  titles: { flex: 1, gap: 2 },
  title: { fontFamily: font.display, fontSize: 27, color: color.cream },
  subtitle: { fontFamily: font.light, fontSize: 13, color: color.textMuted },
});
