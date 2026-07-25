import { useMutation, useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { GlassButton, GlassSurface, Toast, color, font, radius } from '@/design';
import { ScreenHeader } from '@/features/expenses/ScreenHeader';
import { EmptyState } from '@/features/home/EmptyState';
import { RowSkeleton } from '@/features/home/RowSkeleton';
import {
  inviteMessage,
  personalInviteUrl,
  plainInviteUrl,
} from '@/features/invite/inviteLink';
import { AddPersonSheet } from '@/features/people/AddPersonSheet';
import { Avatar } from '@/features/people/Avatar';
import { createInviteLink, getHomeSummary, type HomePerson } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Invite friends.
 * Replaces design-reference/screens/Hisaab Add Friend.dc.html, which is built entirely around
 * the phone address book.
 *
 * **The whole contacts surface is gone, deliberately.** Reading the address book is a
 * review-sensitive permission on both stores, needs a privacy manifest and a Play data-safety
 * declaration, and uploads your friends' phone numbers to a server so it can tell you which of
 * them are already users. The share sheet does the same job with none of that: you pick who to
 * send it to in the app you were going to message them in anyway, and Hisaab never learns who
 * is in your contacts. See PROGRESS.md — no Contacts permission is requested anywhere.
 *
 * The design plan also called for a `pg_trgm` name search over everyone on Hisaab. Also
 * dropped: a fuzzy search over all users is a user-enumeration API. Finding a specific
 * existing person is already handled by the expense picker, which matches on an exact contact
 * point — you have to know their email, not guess at their name.
 */
export default function Invite() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<string | null>(null);
  const [addingPerson, setAddingPerson] = useState(false);

  const ping = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  };

  const homeQuery = useQuery({ queryKey: queryKeys.home(), queryFn: getHomeSummary });

  // Only people who have not signed up. Everyone else has nothing to be invited to.
  const waiting = (homeQuery.data?.people ?? []).filter((p) => p.is_placeholder);

  const sharePersonal = useMutation({
    mutationFn: async (person: HomePerson) => {
      const link = await createInviteLink(person.id);
      const url = personalInviteUrl(link.token);
      await Share.share({ message: inviteMessage(url, person.display_name) });
      return url;
    },
    onError: (e: Error) => ping(e.message),
  });

  const shareGeneral = async () => {
    try {
      await Share.share({ message: inviteMessage(plainInviteUrl()) });
    } catch (e) {
      ping((e as Error).message);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Invite friends" />

        <GlassSurface
          radius={radius.panel}
          elevation="glass"
          style={styles.heroSpacing}
          contentStyle={styles.hero}
        >
          <Text style={styles.heroBody}>
            Send anyone a link. It opens Hisaab if they have it, and the store if they
            don&rsquo;t — no phone numbers, and Hisaab never reads your contacts.
          </Text>

          <GlassButton label="Share a link" variant="primary" onPress={() => void shareGeneral()} />

          {/* Naming someone is the more useful of the two, because it does not depend on them
              acting: they become a participant now, and the link can follow whenever. */}
          <GlassButton
            label="Add someone by name"
            variant="secondary"
            onPress={() => setAddingPerson(true)}
          />

          <Pressable
            accessibilityRole="button"
            onPress={async () => {
              await Clipboard.setStringAsync(plainInviteUrl());
              ping('Link copied.');
            }}
            hitSlop={8}
            style={styles.copyRow}
          >
            <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
              <Path
                d="M4.6 4.6V2.4h7.2v7.2H9.6M2.2 4.6h7.2v7.2H2.2V4.6Z"
                stroke={color.textMuted}
                strokeWidth={1.3}
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={styles.copyLabel}>Copy link instead</Text>
          </Pressable>
        </GlassSurface>

        <Text style={styles.sectionTitle}>Waiting to join</Text>

        {homeQuery.isLoading ? (
          <RowSkeleton count={2} />
        ) : homeQuery.error && !homeQuery.data ? (
          <EmptyState
            title="Couldn't load your people"
            body={(homeQuery.error as Error).message}
            actionLabel="Try again"
            onAction={() => void homeQuery.refetch()}
          />
        ) : waiting.length === 0 ? (
          <Text style={styles.emptyNote}>
            Nobody. Everyone you share expenses with is already on Hisaab — people appear here
            once you add them to an expense before they&rsquo;ve signed up.
          </Text>
        ) : (
          <View style={styles.list}>
            <Text style={styles.listHint}>
              These people are on your expenses but have never opened the app. Their link
              carries their history, so signing up hands them everything already there rather
              than an empty account.
            </Text>

            {waiting.map((person) => (
              <GlassSurface key={person.id} radius={radius.cardCompact} contentStyle={styles.row}>
                <Avatar name={person.display_name} url={person.avatar_url} size={38} />
                <Text style={styles.rowName} numberOfLines={1}>
                  {person.display_name}
                </Text>
                {/* A compact pill rather than a GlassButton: the shared button is 54pt tall,
                    which in a 38pt avatar row dwarfs the person it belongs to. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Invite ${person.display_name}`}
                  disabled={sharePersonal.isPending}
                  onPress={() => sharePersonal.mutate(person)}
                  style={({ pressed }) => [styles.invitePill, pressed ? styles.invitePressed : null]}
                >
                  <Text style={styles.inviteLabel}>
                    {sharePersonal.isPending && sharePersonal.variables?.id === person.id
                      ? 'Sharing…'
                      : 'Invite'}
                  </Text>
                </Pressable>
              </GlassSurface>
            ))}
          </View>
        )}
      </ScrollView>

      <AddPersonSheet
        visible={addingPerson}
        onClose={() => setAddingPerson(false)}
        onAdded={() => void homeQuery.refetch()}
      />

      <Toast message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  // Margins belong on `style`; `contentStyle` lands inside the surface, where a margin only
  // pads the content and leaves the panel itself sitting flush against whatever is above.
  heroSpacing: { marginTop: 20 },
  hero: { padding: 20, gap: 16 },
  heroBody: { fontFamily: font.light, fontSize: 14.5, lineHeight: 21, color: color.textSecondary },
  copyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  copyLabel: { fontFamily: font.regular, fontSize: 13, color: color.textMuted },
  sectionTitle: {
    marginTop: 28,
    marginBottom: 12,
    paddingLeft: 4,
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  emptyNote: { fontFamily: font.light, fontSize: 14, lineHeight: 21, color: color.textFaint },
  list: { gap: 10 },
  listHint: {
    marginBottom: 4,
    fontFamily: font.light,
    fontSize: 12.5,
    lineHeight: 19,
    color: color.textFaint,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14 },
  rowName: { flex: 1, fontFamily: font.medium, fontSize: 15.5, color: color.cream },
  invitePill: {
    paddingHorizontal: 16,
    height: 34,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.owedBorder,
    backgroundColor: color.owedFill,
  },
  invitePressed: { backgroundColor: 'rgba(184,150,60,0.34)' },
  inviteLabel: { fontFamily: font.medium, fontSize: 13.5, color: color.creamWarm },
});
