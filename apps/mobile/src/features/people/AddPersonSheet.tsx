import { useMutation } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { normalisePhone } from '@chukta/core';

import { GlassButton, Sheet, color, font } from '@/design';
import { inviteMessage, personalInviteUrl } from '@/features/invite/inviteLink';
import { createInviteLink } from '@/lib/api';
import { useOffline } from '@/lib/offline/OfflineProvider';
import { queueContactProfile } from '@/lib/offline/writes';
import { Avatar } from './Avatar';
import { ClaimCodeSheet } from './ClaimCodeSheet';
import { contactPickerAvailable, pickContact } from './pickContact';

/**
 * Add a person who is not on Chukta — and, if you want, send them the link.
 *
 * The thing worth understanding here: **you do not wait for anyone to join.** Naming someone
 * makes them a real participant immediately, so you can put them on expenses tonight and send
 * the link next week. When they eventually sign up, the placeholder is claimed in place and
 * every expense they were already part of is simply there — nothing migrates, nothing is
 * re-entered. That is what `profiles.id` being the universal identity is *for*, and until now
 * the only door to it was typing a name into a search box that happened to match nobody.
 *
 * A sheet rather than a route, deliberately: this is always opened from a screen that is
 * holding a selection — the picker's ticked people, the new-group member list — and navigating
 * away to a screen and back would either lose that selection or need state threaded between
 * routes to preserve it. The sheet closes and hands the new id straight back to `onAdded`.
 */
export function AddPersonSheet({
  visible,
  onClose,
  onAdded,
}: {
  visible: boolean;
  onClose: () => void;
  /** The new (or matched) profile id. Callers select them straight away. */
  onAdded: (profileId: string, displayName: string) => void;
}) {
  if (!visible) return null;
  return <AddPersonBody onClose={onClose} onAdded={onAdded} />;
}

function AddPersonBody({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (profileId: string, displayName: string) => void;
}) {
  const offline = useOffline();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [showCode, setShowCode] = useState(false);

  /*
   * The person exists as soon as you tap Add.
   *
   * This is the most response-dependent write in the app — the returned id is handed straight
   * to `onAdded`, which ticks them into the selection behind the sheet, and from there it
   * flows into route params, an expense's payers and splits, and a group's member list. Which
   * is exactly why it could not work offline until `upsert_contact_profile` learned to accept
   * a client-supplied id (migration 0024).
   *
   * One consequence worth knowing about: if the email you typed already belongs to somebody,
   * the server hands back THEIR id rather than the one minted here, and the drainer rewrites
   * every queued write that referenced the invented one. The dedupe still wins — it just wins
   * later than it used to.
   */
  const create = () => {
    try {
      const trimmedEmail = email.trim().toLowerCase();
      const normalisedPhone = normalisePhone(phone);

      /*
       * Email wins when both are given.
       *
       * `upsert_contact_profile` takes ONE contact point, and email is the stronger identifier
       * here: it is the only one that can resolve to a real account, because nothing writes a
       * phone contact point for a signed-up user. Sending the phone instead would silently
       * downgrade the dedupe from "finds them" to "finds another placeholder".
       */
      const id = queueContactProfile(
        name.trim(),
        // Both normalised here because the RPC dedupes on `value_norm` exactly — an address
        // differing only in case, or a number written with different spacing, would otherwise
        // create a second identity for one person, which is what the unique index on live
        // contact points exists to prevent.
        trimmedEmail
          ? { kind: 'email', value: trimmedEmail }
          : normalisedPhone
            ? { kind: 'phone', value: normalisedPhone }
            : undefined,
      );
      const person = { id, name: name.trim() };
      setAdded(person);
      // Tell the caller immediately rather than on close: they get ticked in the list behind
      // the sheet, so the result of the tap is visible before any decision about the link.
      onAdded(person.id, person.name);
      offline.refresh();
      offline.sync();
      /*
       * Deliberately NOT invalidating the roster here.
       *
       * It used to, and it could only ever have made things worse: the server has not been told
       * about this person yet — `offline.sync()` is deferred a full transition — so the refetch
       * came back with a roster that predated them and cached it as fresh for a minute. The
       * moment the outbox row drained and disappeared, the person was in neither the roster nor
       * the queue, and the expense form showed them as "Someone".
       *
       * The invalidation now happens in `OfflineProvider`'s `runSync`, once the drain reports
       * `upsert_contact_profile` actually sent. Until then `offline.pendingPeople` covers them,
       * which is what it is for and what keeps this working with no signal at all.
       */
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  /*
   * Open the OS picker and prefill from the one contact chosen.
   *
   * Only fills what is empty, so a picker tap cannot silently wipe something already typed —
   * the user may have entered a name and be reaching for the number.
   */
  const chooseContact = async () => {
    try {
      const picked = await pickContact();
      if (picked === null) return;

      if (picked.name !== '' && name.trim() === '') setName(picked.name);
      if (picked.phone !== null && phone.trim() === '') setPhone(picked.phone);

      // Said out loud rather than swallowed: a contact whose number we could not parse would
      // otherwise look like the picker had half-worked for no visible reason.
      if (picked.phoneRejected) {
        setNote("Couldn't read that contact's number — type it in if you want it.");
      }
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  const invite = useMutation({
    mutationFn: async (mode: 'share' | 'copy') => {
      const link = await createInviteLink(added!.id);
      const url = personalInviteUrl(link.token);
      if (mode === 'copy') {
        await Clipboard.setStringAsync(url);
        return 'copied' as const;
      }
      await Share.share({ message: inviteMessage(url, added!.name) });
      return 'shared' as const;
    },
    onSuccess: (result) => {
      if (result === 'copied') setNote('Link copied.');
      else onClose();
    },
    onError: (e: Error) =>
      // The email matched somebody who already has an account, so `upsert_contact_profile`
      // handed back their real profile instead of making a placeholder. There is nothing to
      // claim — saying so is more use than the raw error.
      setNote(
        e.message.includes('already has an account')
          ? `${added?.name} is already on Chukta — nothing to invite them to. They're added.`
          : e.message,
      ),
  });

  const ready = name.trim().length > 1;

  if (added) {
    return (
      <Sheet
        visible
        onClose={onClose}
        title={added.name}
        subtitle="Added. Put them on expenses whenever you like."
        footer={
          <View style={styles.actions}>
            {/* The one part of this that genuinely needs a network. The token IS the link,
                so there is nothing to queue — it cannot be minted offline and shared later. */}
            <GlassButton
              label={
                !offline.connectivity.isConnected
                  ? 'Link needs a connection'
                  : invite.isPending
                    ? 'Preparing…'
                    : 'Send them the link'
              }
              variant="primary"
              disabled={invite.isPending || !offline.connectivity.isConnected}
              onPress={() => invite.mutate('share')}
            />
            <GlassButton label="Done" variant="ghost" onPress={onClose} />
          </View>
        }
      >
        <View style={styles.addedHead}>
          <Avatar name={added.name} size={54} />
          <Text style={styles.addedBody}>
            You don&rsquo;t have to send this now. Whenever {first(added.name)} signs up with
            this link, everything you&rsquo;ve already recorded together is waiting — same
            expenses, same balance, nothing to re-enter.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          disabled={invite.isPending}
          onPress={() => invite.mutate('copy')}
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
          <Text style={styles.copyLabel}>Copy the link instead</Text>
        </Pressable>

        {/*
          * The third way in, for when a link is the wrong shape: they are standing next to you,
          * or you are on the phone to them. Same merge at the other end, just eight characters
          * instead of a URL. Needs a connection for the same reason the link does — the code is
          * minted server-side and only its HMAC is stored.
          */}
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          disabled={!offline.connectivity.isConnected}
          onPress={() => setShowCode(true)}
          style={styles.copyRow}
        >
          <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
            <Circle cx={4.4} cy={7} r={2.6} stroke={color.textMuted} strokeWidth={1.3} />
            <Path
              d="M7 7h5.2M10.6 7v2.2"
              stroke={color.textMuted}
              strokeWidth={1.3}
              strokeLinecap="round"
            />
          </Svg>
          <Text style={styles.copyLabel}>
            {offline.connectivity.isConnected
              ? 'Read them a code instead'
              : 'A code needs a connection'}
          </Text>
        </Pressable>

        {note ? <Text style={styles.note}>{note}</Text> : null}

        <ClaimCodeSheet
          visible={showCode}
          profileId={added.id}
          displayName={added.name}
          onClose={() => setShowCode(false)}
        />
      </Sheet>
    );
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Add someone"
      subtitle="They don't need the app for you to start splitting with them."
      footer={
        <GlassButton
          label="Add them"
          variant="primary"
          disabled={!ready}
          onPress={create}
        />
      }
    >
      {/*
        * The picker fills the two fields below; it does not replace them. Everything is still
        * editable afterwards, and typing it all by hand remains a first-class path — the
        * picker is a shortcut past the typos, not a new requirement.
        */}
      {contactPickerAvailable() ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose from contacts"
          onPress={() => void chooseContact()}
          style={({ pressed }) => [styles.pickRow, pressed ? styles.pickPressed : null]}
        >
          <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
            <Circle cx={8} cy={5.6} r={2.8} stroke={color.goldBright} strokeWidth={1.3} />
            <Path
              d="M2.8 13.6c0-2.4 2.3-4 5.2-4s5.2 1.6 5.2 4"
              stroke={color.goldBright}
              strokeWidth={1.3}
              strokeLinecap="round"
            />
          </Svg>
          <Text style={styles.pickLabel}>Choose from contacts</Text>
        </Pressable>
      ) : null}

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Their name"
        placeholderTextColor={color.textGhost}
        autoFocus
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={80}
        accessibilityLabel="Their name"
        style={styles.input}
      />

      <View style={styles.labelRow}>
        <Text style={styles.label}>Their email</Text>
        <Text style={styles.optional}>Optional</Text>
      </View>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="priya@example.com"
        placeholderTextColor={color.textGhost}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        maxLength={254}
        accessibilityLabel="Their email, optional"
        style={styles.input}
      />
      {/* Worth the second field: it is what makes you and a friend inviting the same person
          land on one identity instead of two that need merging later, and what lets the app
          recognise them the moment they sign up with that address. */}
      <Text style={styles.hint}>
        Lets Chukta recognise them when they sign up, and stops two of you accidentally
        creating two of the same person.
      </Text>

      <View style={styles.labelRow}>
        <Text style={styles.label}>Their phone</Text>
        <Text style={styles.optional}>Optional</Text>
      </View>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="98765 43210"
        placeholderTextColor={color.textGhost}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="phone-pad"
        maxLength={20}
        accessibilityLabel="Their phone, optional"
        style={styles.input}
      />
      {/*
        * Deliberately NOT "find friends already on Chukta". Nothing writes a phone contact
        * point for a signed-up account — `set_my_phone` was the only thing that would have,
        * and phone was cut from v1 — so a number can only ever match a placeholder somebody
        * else made. That is still worth having, and it is all this claims.
        */}
      <Text style={styles.hint}>
        Same idea as the email: two of you adding them by the same number get one person, not
        two.
      </Text>

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </Sheet>
  );
}

const first = (full: string): string => full.trim().split(/\s+/)[0] ?? full;

const styles = StyleSheet.create({
  /*
   * A quiet row, not a button. The picker is a shortcut past typing, and giving it a filled
   * gold button would make it look like the primary way to add somebody — which it must not,
   * because typing a name is the path that needs no permission at all.
   */
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    marginBottom: 4,
  },
  pickPressed: { opacity: 0.6 },
  pickLabel: { fontFamily: font.medium, fontSize: 14, color: color.goldBright },

  input: {
    minHeight: 52,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
    fontFamily: font.regular,
    fontSize: 16,
    color: color.cream,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 8 },
  label: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  optional: {
    fontFamily: font.light,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
  hint: {
    marginTop: 8,
    fontFamily: font.light,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.textFaint,
  },
  note: { marginTop: 12, fontFamily: font.light, fontSize: 12.5, color: color.creamRose },
  addedHead: { alignItems: 'center', gap: 12, marginBottom: 16 },
  addedBody: {
    textAlign: 'center',
    fontFamily: font.light,
    fontSize: 14,
    lineHeight: 21,
    color: color.textSecondary,
  },
  copyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  copyLabel: { fontFamily: font.regular, fontSize: 13, color: color.textMuted },
  actions: { gap: 8 },
});
