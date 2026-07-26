import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { GlassSurface, color, font, radius, useReduceMotion, useRippleNav } from '@/design';
import { useSession } from '@/features/auth/session';
import { Avatar } from '@/features/people/Avatar';

/**
 * The sidebar — everything behind the profile button.
 * Ported from design-reference/screens/Hisaab Sidebar.dc.html.
 *
 * A drawer rather than a route, because it slides *over* what you were looking at and leaves
 * it visible through the scrim. Routing to it would mean unmounting Home, and the whole point
 * of the design is that Home stays there.
 *
 * The swipe-to-close in the prototype is real behaviour and is ported with it, including the
 * 45px threshold. What is not ported is its "open" default: this opens on demand.
 */

/** How far left you have to drag before letting go closes it. From the prototype. */
const CLOSE_THRESHOLD = 45;
const OPEN_MS = 380;
const CLOSE_MS = 300;

export function Sidebar({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  // Mounting the drawer only while it is open keeps the profile query and the gesture handler
  // off Home entirely when it is shut.
  if (!visible) return null;
  return <SidebarBody onClose={onClose} />;
}

function SidebarBody({ onClose }: { onClose: () => void }) {
  const { width } = useWindowDimensions();
  const drawerWidth = width * 0.8;
  const reduceMotion = useReduceMotion();

  // 0 = fully off-screen left, 1 = open. One value drives both the slide and the scrim, so
  // they can never disagree about how open the drawer is.
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.set(withTiming(1, { duration: reduceMotion ? 0 : OPEN_MS }));
  }, [progress, reduceMotion]);

  const close = () => {
    progress.set(
      withTiming(0, { duration: reduceMotion ? 0 : CLOSE_MS }, (finished) => {
        if (finished) runOnJS(onClose)();
      }),
    );
  };

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={close}>
      <SidebarContent
        progress={progress}
        drawerWidth={drawerWidth}
        onClose={close}
        onCloseImmediately={onClose}
      />
    </Modal>
  );
}

function SidebarContent({
  progress,
  drawerWidth,
  onClose,
  onCloseImmediately,
}: {
  progress: SharedValue<number>;
  drawerWidth: number;
  onClose: () => void;
  onCloseImmediately: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, signOut } = useSession();
  const { rippleFrom } = useRippleNav();

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.get(), [0, 1], [-drawerWidth - 24, 0]) }],
  }));

  // Horizontal drag that follows the finger, then decides on release. `activeOffsetX` keeps a
  // vertical scroll inside the drawer from being stolen by the pan.
  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onChange((e) => {
      const next = progress.get() + e.changeX / drawerWidth;
      progress.set(Math.min(1, Math.max(0, next)));
    })
    .onEnd((e) => {
      const draggedLeft = (1 - progress.get()) * drawerWidth;
      // Either far enough or fast enough — a quick flick should not have to travel 45px.
      if (draggedLeft > CLOSE_THRESHOLD || e.velocityX < -600) {
        progress.set(withTiming(0, { duration: CLOSE_MS }, (f) => f && runOnJS(onCloseImmediately)()));
      } else {
        progress.set(withTiming(1, { duration: 200 }));
      }
    });

  /*
   * Close the drawer, then ripple from the row that was tapped.
   *
   * The order is forced by the drawer being a Modal: on iOS a modal is a separate window above
   * everything, including the ripple overlay, so a veil started while it is still up would be
   * hidden behind it. Closing first is not a compromise — the prototype's own ripple demo uses
   * the sidebar's Settings row as its origin, so a wavefront starting where the drawer was is
   * the designed behaviour rather than a workaround.
   *
   * Both state updates land in the same commit, so the drawer never disappears a frame early.
   */
  const go = (event: GestureResponderEvent, path: string) => {
    onCloseImmediately();
    rippleFrom(event, () => router.push(path as never));
  };

  const version = Constants.expoConfig?.version ?? '0.0.0';

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          style={styles.scrim}
          onPress={onClose}
        />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.drawerHost, { width: drawerWidth }, drawerStyle]}>
          <GlassSurface
            radius={0}
            raised
            elevation="glass"
            style={styles.drawer}
            contentStyle={[
              styles.drawerBody,
              { paddingTop: insets.top + 26, paddingBottom: insets.bottom + 18 },
            ]}
          >
            <View style={styles.identity}>
              <Avatar
                name={profile?.display_name ?? 'You'}
                url={profile?.avatar_url ?? null}
                size={62}
                tone="oxblood"
              />
              <View style={styles.identityText}>
                <Text style={styles.name} numberOfLines={1}>
                  {profile?.display_name ?? 'You'}
                </Text>
                <Pressable accessibilityRole="button" onPress={(e) => go(e, '/settings')}>
                  <Text style={styles.editLink}>Edit profile</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.rule} />

            {/* The tip jar gets a treatment of its own — it is the only row asking for
                something rather than offering it, and burying it in the list would be
                either dishonest or useless. */}
            <Pressable
              accessibilityRole="button"
              onPress={(e) => go(e, '/tip')}
              style={({ pressed }) => [styles.tipRow, pressed ? styles.tipRowPressed : null]}
            >
              <Svg width={19} height={18} viewBox="0 0 19 18" fill="none">
                <Path
                  d="M9.5 16S1.8 11.6 1.8 6.6A4.3 4.3 0 0 1 9.5 4a4.3 4.3 0 0 1 7.7 2.6C17.2 11.6 9.5 16 9.5 16Z"
                  stroke={color.goldBright}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
              </Svg>
              <Text style={styles.tipLabel}>Tip jar</Text>
              <Text style={styles.tipMeta}>Support us!</Text>
            </Pressable>

            <View>
              <SidebarRow label="Settings" icon={<SettingsIcon />} onPress={(e) => go(e, '/settings')} />
              <SidebarRow label="Invite friends" icon={<InviteIcon />} onPress={(e) => go(e, '/invite')} />
              {/*
                * Next to Invite because they are two ends of the same act — one sends somebody a
                * way in, the other is the way in. Somebody told "get them to send you a code"
                * looks for it here, beside the row they were already shown.
                */}
              <SidebarRow label="Claim a person" icon={<ClaimIcon />} onPress={(e) => go(e, '/claim')} />
              <SidebarRow
                label="Help and feedback"
                icon={<HelpIcon />}
                onPress={(e) => go(e, '/help')}
              />
              <SidebarRow label="About Chukta" icon={<AboutIcon />} onPress={(e) => go(e, '/about')} />
            </View>

            <View style={styles.spacer} />

            <View style={styles.rule} />

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onCloseImmediately();
                void signOut();
              }}
              style={({ pressed }) => [styles.signOut, pressed ? styles.rowPressed : null]}
            >
              <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
                <Path
                  d="M7.2 15.6H3.6A1.6 1.6 0 0 1 2 14V4a1.6 1.6 0 0 1 1.6-1.6h3.6M11.6 12.2 15 9l-3.4-3.2M15 9H7.4"
                  stroke="rgba(255,255,255,.42)"
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <Text style={styles.signOutLabel}>Sign out</Text>
            </Pressable>

            {/* Read, never hardcoded — the prototype's "v1.0.3" disagrees with the About
                screen's, which is exactly what hardcoding a version gets you. */}
            <Text style={styles.version}>Chukta v{version}</Text>
          </GlassSurface>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function SidebarRow({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: (event: GestureResponderEvent) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      {icon}
      <Text style={styles.rowLabel}>{label}</Text>
      <Svg width={7} height={12} viewBox="0 0 7 12" fill="none">
        <Path
          d="M1.5 1l4 5-4 5"
          stroke="rgba(255,255,255,.28)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}

const ICON = 'rgba(244,237,228,.7)';

const SettingsIcon = () => (
  <Svg width={19} height={19} viewBox="0 0 20 20" fill="none">
    <Circle cx={10} cy={10} r={3} stroke={ICON} strokeWidth={1.4} />
    <Path
      d="M10 1.8v2.4M10 15.8v2.4M2.6 10H5m10 0h2.4M4.7 4.7l1.7 1.7m7.2 7.2 1.7 1.7M15.3 4.7l-1.7 1.7m-7.2 7.2-1.7 1.7"
      stroke={ICON}
      strokeWidth={1.4}
      strokeLinecap="round"
    />
  </Svg>
);

const InviteIcon = () => (
  <Svg width={20} height={18} viewBox="0 0 20 18" fill="none">
    <Circle cx={7.4} cy={5.6} r={3.4} stroke={ICON} strokeWidth={1.4} />
    <Path
      d="M1.6 16.2c0-2.9 2.6-4.8 5.8-4.8s5.8 1.9 5.8 4.8"
      stroke={ICON}
      strokeWidth={1.4}
      strokeLinecap="round"
    />
    <Path d="M16.4 4.6v5M13.9 7.1h5" stroke={color.goldBright} strokeWidth={1.4} strokeLinecap="round" />
  </Svg>
);

// A key. The gold bit is the bit that turns, which is the same emphasis the other icons give
// to whatever part of them is the verb.
const ClaimIcon = () => (
  <Svg width={20} height={18} viewBox="0 0 20 18" fill="none">
    <Circle cx={6.2} cy={9} r={3.6} stroke={ICON} strokeWidth={1.4} />
    <Path
      d="M9.8 9h8.4"
      stroke={color.goldBright}
      strokeWidth={1.4}
      strokeLinecap="round"
    />
    <Path
      d="M15.4 9v3.1M18.2 9v2.2"
      stroke={color.goldBright}
      strokeWidth={1.4}
      strokeLinecap="round"
    />
  </Svg>
);

const HelpIcon = () => (
  <Svg width={19} height={19} viewBox="0 0 20 20" fill="none">
    <Circle cx={10} cy={10} r={8.2} stroke={ICON} strokeWidth={1.4} />
    <Path
      d="M7.7 7.6a2.4 2.4 0 0 1 4.6.9c0 1.6-2.3 1.9-2.3 3.3"
      stroke={ICON}
      strokeWidth={1.4}
      strokeLinecap="round"
    />
    <Circle cx={10} cy={14.6} r={0.9} fill={ICON} />
  </Svg>
);

const AboutIcon = () => (
  <Svg width={19} height={19} viewBox="0 0 20 20" fill="none">
    <Rect x={2.4} y={2.4} width={15.2} height={15.2} rx={4} stroke={ICON} strokeWidth={1.4} />
    <Path d="M10 8.8v5.2" stroke={ICON} strokeWidth={1.4} strokeLinecap="round" />
    <Circle cx={10} cy={6.3} r={0.9} fill={ICON} />
  </Svg>
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrim: { flex: 1, backgroundColor: 'rgba(6,3,4,0.62)' },
  drawerHost: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  drawer: {
    flex: 1,
    // Only the right edge is rounded — the left is flush with the screen edge.
    borderTopRightRadius: radius.frame - 10,
    borderBottomRightRadius: radius.frame - 10,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomWidth: 0,
  },
  drawerBody: { flex: 1, paddingHorizontal: 20 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  identityText: { flex: 1, gap: 2 },
  name: { fontFamily: font.display, fontSize: 25, lineHeight: 30, color: color.cream },
  editLink: {
    alignSelf: 'flex-start',
    fontFamily: font.regular,
    fontSize: 13,
    color: color.goldBright,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(184,150,60,.45)',
  },
  rule: { height: 1, marginVertical: 14, backgroundColor: 'rgba(255,255,255,.1)' },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 6,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(184,150,60,.4)',
    backgroundColor: 'rgba(184,150,60,.12)',
  },
  tipRowPressed: { backgroundColor: 'rgba(184,150,60,.28)' },
  tipLabel: { flex: 1, fontFamily: font.medium, fontSize: 15.5, color: color.creamWarm },
  tipMeta: {
    fontFamily: font.regular,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: 'rgba(184,150,60,.85)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,.08)' },
  rowLabel: { flex: 1, fontFamily: font.regular, fontSize: 15.5, color: 'rgba(244,237,228,.9)' },
  spacer: { flex: 1, minHeight: 20 },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  signOutLabel: { fontFamily: font.regular, fontSize: 14.5, color: 'rgba(255,255,255,.42)' },
  version: {
    marginTop: 8,
    paddingLeft: 14,
    fontFamily: font.light,
    fontSize: 10.5,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,.2)',
  },
});
