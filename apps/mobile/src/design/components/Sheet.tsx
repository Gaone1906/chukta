import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, font, radius } from '../tokens';
import { GlassSurface } from './GlassSurface';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Optional line under the title — usually a running total or a constraint. */
  subtitle?: string;
  /** Pinned under the scrolling content: the confirm button, usually. */
  footer?: ReactNode;
  children?: ReactNode;
}

/**
 * A modal bottom sheet on a scrim.
 *
 * The design set has no sheet — every picker in the prototypes toasts "demo only" instead of
 * opening one — so this is written rather than ported, from the same glass primitives so it
 * still belongs to the same app.
 *
 * Deliberately a plain `Modal` rather than a gesture-driven sheet library: these are all
 * short, decision-shaped surfaces, and a drag-to-dismiss interaction on a form that holds
 * unsaved money input is a way to lose input by accident.
 */
export function Sheet({ visible, onClose, title, subtitle, footer, children }: SheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.scrim}
          onPress={onClose}
        />

        <GlassSurface
          radius={radius.sheet}
          elevation="glass"
          style={styles.sheet}
          contentStyle={[styles.body, { paddingBottom: insets.bottom + 18 }]}
        >
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5,2,3,0.72)' },
  // Only the top corners are rounded; the sheet is anchored to the bottom edge.
  sheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '86%' },
  body: { paddingTop: 10, paddingHorizontal: 20 },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  header: { marginTop: 14, gap: 3 },
  title: { fontFamily: font.display, fontSize: 25, color: color.cream },
  subtitle: { fontFamily: font.light, fontSize: 13, color: color.textMuted },
  scroll: { marginTop: 16 },
  scrollContent: { paddingBottom: 6 },
  footer: { marginTop: 14 },
});
