import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Share, StyleSheet, Text } from 'react-native';

import { GlassButton, Sheet, color, font } from '@/design';
import { ClaimCodeSheet } from '@/features/people/ClaimCodeSheet';
import { createInviteLink } from '@/lib/api';

import { inviteMessage, personalInviteUrl } from './inviteLink';

/**
 * Pick how to hand a placeholder over — a link, or a code they type.
 *
 * ---------------------------------------------------------------- why this is a component
 *
 * Both halves already existed and only one was reachable. `create_claim_code` works for any
 * profile and `ClaimCodeSheet` was complete, but it was mounted solely inside `AddPersonSheet` —
 * so the code could only ever be seen in the seconds after creating someone. Add a person, miss
 * the prompt, and there was no second chance anywhere in the app.
 *
 * Extracted rather than written twice because it is now wanted from two places that ask the same
 * question — the invite list and a person's own screen. Two copies of a two-branch chooser is
 * exactly the shape that drifts: one gets a copy fix, the other does not, and the difference
 * shows up as "the code is worded differently depending on where you tap".
 *
 * ---------------------------------------------------------------- the two states
 *
 * `person` is who the chooser is open for; `codeFor` is who the code is showing for. They are
 * separate on purpose. Collapsing them would leave the chooser mounted underneath the code
 * sheet, so dismissing the code would drop the user back onto a question they had just answered.
 */
export interface InvitablePerson {
  id: string;
  display_name: string;
}

export function InviteMethodSheet({
  person,
  onClose,
  onError,
}: {
  /** Non-null opens the chooser. */
  person: InvitablePerson | null;
  onClose: () => void;
  /** Sharing can fail — the caller owns the toast, since both hosts already have one. */
  onError?: (message: string) => void;
}) {
  const [codeFor, setCodeFor] = useState<InvitablePerson | null>(null);

  const shareLink = useMutation({
    mutationFn: async (target: InvitablePerson) => {
      const link = await createInviteLink(target.id);
      await Share.share({
        message: inviteMessage(personalInviteUrl(link.token), target.display_name),
      });
    },
    onError: (e: Error) => onError?.(e.message),
  });

  return (
    <>
      {/*
        * A sheet rather than an Alert: each option needs a sentence. They differ in how long
        * they last and in whether the other person has to be next to you, and an Alert gives you
        * a title and two button labels to say that in.
        */}
      <Sheet
        visible={person !== null}
        onClose={onClose}
        title={person ? `Invite ${person.display_name}` : 'Invite'}
        subtitle="Either way, their history comes with them."
      >
        <GlassButton
          label="Send a link"
          variant="primary"
          onPress={() => {
            const target = person;
            onClose();
            if (target) shareLink.mutate(target);
          }}
        />
        <Text style={styles.note}>
          Opens your share sheet. The link lasts 90 days, so it works when they are not with you.
        </Text>

        <GlassButton
          label="Show a claim code"
          onPress={() => {
            setCodeFor(person);
            onClose();
          }}
          style={styles.spacing}
        />
        <Text style={styles.note}>
          A short code they type in themselves. Expires in 15 minutes — for when they are next to
          you, or on the phone.
        </Text>
      </Sheet>

      {codeFor ? (
        <ClaimCodeSheet
          visible
          profileId={codeFor.id}
          displayName={codeFor.display_name}
          onClose={() => setCodeFor(null)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  note: {
    fontFamily: font.light,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.textFaint,
    marginTop: 8,
  },
  spacing: { marginTop: 20 },
});
