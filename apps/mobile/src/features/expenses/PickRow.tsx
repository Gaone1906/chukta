import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { GlassSurface, color, font, radius } from '@/design';
import { Avatar } from '@/features/people/Avatar';

/** A group in the picker. Single-select, so it advances rather than ticking a box. */
export function GroupPickRow({
  name,
  meta,
  selected,
  onPress,
}: {
  name: string;
  meta: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${name}, ${meta}`}
      onPress={onPress}
    >
      <GlassSurface radius={radius.cardCompact} active={selected} contentStyle={styles.row}>
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        {selected ? (
          <Checkbox on />
        ) : (
          <Svg width={7} height={12} viewBox="0 0 7 12" fill="none">
            <Path
              d="M1.5 1l4 5-4 5"
              stroke="rgba(255,255,255,.3)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        )}
      </GlassSurface>
    </Pressable>
  );
}

/** A person in the picker. Multi-select, so it ticks a box and stays put. */
export function PersonPickRow({
  name,
  avatarUrl,
  meta,
  selected,
  disabled = false,
  onPress,
}: {
  name: string;
  avatarUrl?: string | null;
  meta?: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={name}
      disabled={disabled}
      onPress={onPress}
      style={disabled ? styles.disabled : undefined}
    >
      <GlassSurface radius={radius.cardCompact} active={selected} contentStyle={styles.row}>
        <Avatar name={name} url={avatarUrl} size={38} tone={selected ? 'gold' : 'plain'} />
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {meta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        <Checkbox on={selected} />
      </GlassSurface>
    </Pressable>
  );
}

function Checkbox({ on }: { on: boolean }) {
  return (
    <View
      style={[
        styles.box,
        on ? { borderColor: color.owedBorder, backgroundColor: color.owedFill } : null,
      ]}
    >
      {on ? (
        <Svg width={12} height={9} viewBox="0 0 14 11" fill="none">
          <Path
            d="M1.4 5.6l3.6 3.6L12.6 1.6"
            stroke={color.creamWarm}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 13,
    paddingLeft: 14,
    paddingRight: 16,
  },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: font.medium, fontSize: 15.5, color: color.cream },
  meta: { fontFamily: font.light, fontSize: 12.5, color: color.textMuted },
  box: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  disabled: { opacity: 0.45 },
});
