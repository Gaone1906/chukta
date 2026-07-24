import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { color, motion, shadow } from '../tokens';

export interface FABProps {
  onPress?: (event: { x: number; y: number }) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const SIZE = 62;

/**
 * The circular gold-accented add button.
 *
 * `onPress` reports the tap point in window coordinates because the ripple transition
 * originates from wherever the finger landed — that is the whole point of the effect, so the
 * coordinate has to travel with the press rather than be guessed later.
 */
export function FAB({ onPress, accessibilityLabel = 'Add an expense', style }: FABProps) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.06 }],
  }));

  return (
    <Animated.View style={[styles.wrap, animatedStyle, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={8}
        onPressIn={() => {
          pressed.value = withTiming(1, { duration: motion.press.duration });
        }}
        onPressOut={() => {
          pressed.value = withTiming(0, { duration: motion.press.duration });
        }}
        onPress={(e) => onPress?.({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
      >
        <View style={styles.button}>
          <Svg width={20} height={20} viewBox="0 0 20 20" fill="none">
            <Path
              d="M10 2.6v14.8M2.6 10h14.8"
              stroke={color.creamWarm}
              strokeWidth={1.9}
              strokeLinecap="round"
            />
          </Svg>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...shadow.fab },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(184,150,60,0.6)',
    backgroundColor: 'rgba(184,150,60,0.28)',
  },
});
