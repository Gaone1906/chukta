import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { color, font, radius } from '@/design';

import { useOffline } from './OfflineProvider';

/**
 * The quiet part of "works offline".
 *
 * Deliberately not a blocking state, a modal, or a red bar across the top. Adding an expense at
 * a restaurant table with no signal is the core use case rather than an edge case, and an app
 * that makes a fuss about it is telling the user something has gone wrong when nothing has.
 *
 * So it says one of three things and otherwise is not there at all:
 *
 *   - **Offline** — nothing queued. Purely informational, explains why nothing is refreshing.
 *   - **N waiting to sync** — writes are queued and will go on their own. No action needed,
 *     and none offered; the count exists so "did that save?" has an answer.
 *   - **Needs you** — a write came back with a conflict or a refusal. This one is tappable,
 *     and it is the only state that is, because it is the only one where the app genuinely
 *     cannot proceed without a decision.
 *
 * It sits above the tab-less bottom edge and passes touches through everywhere it is not
 * drawn, so it never eats a tap meant for the FAB.
 */
export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { connectivity, counts } = useOffline();

  const needsAttention = counts.conflict + counts.failed;
  const offline = !connectivity.isConnected;

  // The screen that exists to resolve these should not advertise them.
  if (pathname === '/pending') return null;
  if (!offline && counts.pending === 0 && needsAttention === 0) return null;

  const tappable = needsAttention > 0;

  const label = needsAttention
    ? needsAttention === 1
      ? '1 change needs you'
      : `${needsAttention} changes need you`
    : counts.pending
      ? counts.pending === 1
        ? '1 change waiting to sync'
        : `${counts.pending} changes waiting to sync`
      : 'Offline — everything here still works';

  return (
    <View pointerEvents="box-none" style={[styles.root, { paddingBottom: insets.bottom + 18 }]}>
      <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOutDown.duration(180)}>
        <Pressable
          accessibilityRole={tappable ? 'button' : 'text'}
          disabled={!tappable}
          onPress={() => router.push('/pending')}
          style={({ pressed }) => [
            styles.pill,
            needsAttention ? styles.pillAttention : null,
            pressed && tappable ? styles.pressed : null,
          ]}
        >
          {offline && !needsAttention ? <CloudOff /> : <Dot attention={needsAttention > 0} />}
          <Text style={[styles.label, needsAttention ? styles.labelAttention : null]}>
            {label}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** A queue that is simply working reads as motion-less gold; one that is stuck reads oxblood. */
function Dot({ attention }: { attention: boolean }) {
  return <View style={[styles.dot, attention ? styles.dotAttention : null]} />;
}

function CloudOff() {
  return (
    <Svg width={13} height={13} viewBox="0 0 14 14" fill="none">
      <Path
        d="M3.4 10.6h6.2a2.4 2.4 0 0 0 .4-4.77A3.4 3.4 0 0 0 4.2 4.6M1.4 1.4l11.2 11.2"
        stroke={color.textMuted}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    // Above the screens, below nothing else. A transformed view can outrank a later sibling,
    // and the ripple gives the navigator a transform — so this has to say so explicitly.
    zIndex: 20,
    elevation: 20,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 15,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: color.glassFallbackRaised,
  },
  pillAttention: { borderColor: color.oweBorder, backgroundColor: color.oweFill },
  pressed: { opacity: 0.75 },
  label: { fontFamily: font.regular, fontSize: 12.5, color: color.textSecondary },
  labelAttention: { color: color.creamRose },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.goldLeaf },
  dotAttention: { backgroundColor: color.creamRose },
});
