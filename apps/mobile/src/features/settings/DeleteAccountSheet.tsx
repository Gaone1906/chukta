import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { GlassButton, Sheet, color, font } from '@/design';
import { useSession } from '@/features/auth/session';
import { deleteAccount } from '@/lib/api';

/** Typed exactly, in caps. Deliberately not the user's name — that is easy to type by reflex. */
const CONFIRM_WORD = 'DELETE';

/**
 * The confirmation the design copy promises and the prototype never built.
 *
 * Two things it has to be honest about, because both surprise people:
 *
 * 1. **The balances stay.** They are half of somebody else's ledger, and quietly erasing them
 *    would silently change what a friend is owed. So the account is anonymised: the name
 *    becomes "Deleted user" and every trace of who it was goes.
 * 2. **It cannot be undone.** There is no grace period and no restore, so the confirmation is
 *    a typed word rather than a second tap — a tap is too close to the first one.
 */
export function DeleteAccountSheet({
  visible,
  onClose,
  onDeleted,
  onError,
}: {
  visible: boolean;
  onClose: () => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  if (!visible) return null;
  return <DeleteAccountBody onClose={onClose} onDeleted={onDeleted} onError={onError} />;
}

function DeleteAccountBody({
  onClose,
  onDeleted,
  onError,
}: {
  onClose: () => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const [typed, setTyped] = useState('');
  const { signOut } = useSession();

  const remove = useMutation({
    mutationFn: deleteAccount,
    onSuccess: async () => {
      // The session's tokens outlive the auth.users row, so signing out locally is what
      // actually returns them to the sign-in screen rather than a shell of a signed-in app.
      await signOut();
      onDeleted();
    },
    onError: (e: Error) => {
      onClose();
      onError(`Couldn't delete your account — ${e.message}`);
    },
  });

  return (
    <Sheet
      visible
      onClose={remove.isPending ? () => {} : onClose}
      title="Delete your account"
      subtitle="This cannot be undone."
      footer={
        <View style={styles.actions}>
          <GlassButton
            label={remove.isPending ? 'Deleting…' : 'Delete my account'}
            variant="danger"
            disabled={typed.trim().toUpperCase() !== CONFIRM_WORD || remove.isPending}
            onPress={() => remove.mutate()}
          />
          <GlassButton
            label="Keep my account"
            variant="ghost"
            disabled={remove.isPending}
            onPress={onClose}
          />
        </View>
      }
    >
      <Text style={styles.body}>
        Your name, photo and UPI ID are removed, and you are signed out for good.
      </Text>

      <Text style={styles.body}>
        Expenses you shared with other people stay, because they are half of what those people
        are owed. You will show up in them as <Text style={styles.emphasis}>Deleted user</Text>.
      </Text>

      <Text style={styles.label}>Type {CONFIRM_WORD} to confirm</Text>
      <TextInput
        value={typed}
        onChangeText={setTyped}
        placeholder={CONFIRM_WORD}
        placeholderTextColor={color.textGhost}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!remove.isPending}
        accessibilityLabel={`Type ${CONFIRM_WORD} to confirm`}
        style={styles.input}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    marginBottom: 12,
    fontFamily: font.light,
    fontSize: 14.5,
    lineHeight: 21,
    color: color.textSecondary,
  },
  emphasis: { fontFamily: font.medium, color: color.cream },
  label: {
    marginTop: 6,
    marginBottom: 8,
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  input: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
    fontFamily: font.semibold,
    fontSize: 16,
    letterSpacing: 2,
    color: color.cream,
  },
  actions: { gap: 9 },
});
