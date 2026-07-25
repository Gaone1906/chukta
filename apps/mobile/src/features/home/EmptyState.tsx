import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { GlassButton, color, font } from '@/design';

export interface EmptyStateProps {
  title: string;
  body: string;
  actionLabel?: string;
  /** Takes the press event so the action can ripple from the button. */
  onAction?: (event: GestureResponderEvent) => void;
}

/**
 * The design set contains ZERO empty states — not one, across all twenty prototype files.
 * A brand-new account had no designed experience at all, so these are written rather than
 * ported.
 *
 * Voice follows the design doc: dry, plain, a little funny, never apologetic and never
 * guilt-driven. "Nothing here yet" with a sad-face illustration would be both.
 */
export function EmptyState({ title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {actionLabel && onAction ? (
        <GlassButton label={actionLabel} variant="primary" onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingVertical: 56, paddingHorizontal: 8, alignItems: 'center' },
  title: { fontFamily: font.display, fontSize: 26, color: color.cream, textAlign: 'center' },
  body: {
    marginTop: 10,
    maxWidth: 280,
    textAlign: 'center',
    fontFamily: font.light,
    fontSize: 14.5,
    lineHeight: 21,
    color: color.textMuted,
  },
  action: { marginTop: 26, minWidth: 220 },
});
