import { StyleSheet, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { GlassSurface, color, font, radius } from '@/design';

/**
 * The search box from the picker.
 *
 * All three search inputs in the design set are decorative — no `onChange` is bound anywhere.
 * This one filters for real.
 */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  autoFocus = false,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <GlassSurface radius={radius.pill} elevation="none" contentStyle={styles.row}>
      <Svg width={16} height={16} viewBox="0 0 18 18" fill="none">
        <Circle cx={7.6} cy={7.6} r={5.4} stroke="rgba(244,237,228,.55)" strokeWidth={1.4} />
        <Path
          d="M11.6 11.6 16 16"
          stroke="rgba(244,237,228,.55)"
          strokeWidth={1.4}
          strokeLinecap="round"
        />
      </Svg>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.textFaint}
        autoFocus={autoFocus}
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        style={styles.input}
      />
      {value.length > 0 ? (
        <View
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onTouchEnd={() => onChangeText('')}
          style={styles.clear}
        >
          <Svg width={11} height={11} viewBox="0 0 12 12" fill="none">
            <Path
              d="M1.5 1.5l9 9M10.5 1.5l-9 9"
              stroke={color.textMuted}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          </Svg>
        </View>
      ) : null}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, height: 46 },
  input: {
    flex: 1,
    padding: 0,
    fontFamily: font.regular,
    fontSize: 15,
    color: color.cream,
  },
  clear: { padding: 6, marginRight: -6 },
});
