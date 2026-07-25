import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton, GlassSurface, Toast, color, font, radius } from '@/design';
import { useSession } from '@/features/auth/session';
import { ScreenHeader } from '@/features/expenses/ScreenHeader';
import { redeemClaimCode } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Type in a claim code and absorb the placeholder somebody made for you.
 *
 * The other half of `ClaimCodeSheet`. Both exist because the invite LINK only helps when you can
 * send a link — this is the path for reading eight characters down a phone, or for two people
 * sitting together reconciling who owes what.
 *
 * ---------------------------------------------------------------- online only
 *
 * A merge repoints rows across six tables and cannot be replayed from an outbox — a client that
 * queued one would be guessing at a server state it has no way to know. `claim_placeholder` is
 * already excluded from the outbox for the same reason (`lib/offline/outbox.ts`), and this
 * follows it. Offline, the button simply fails with the network error, which is honest.
 *
 * ---------------------------------------------------------------- reading the result
 *
 * **A wrong code comes back as `{ok: false}`, NOT as a thrown error.** That is deliberate on the
 * server: PostgREST runs each RPC in one transaction, so a function that recorded the failed
 * attempt and then raised would have its own throttle counter rolled back by the exception
 * (0026). The consequence here is that `onSuccess` fires for failures too, so it has to branch
 * on `ok` — treating "the request completed" as "the code worked" is exactly the bug this
 * shape invites.
 */
export default function Claim() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { refreshProfile } = useSession();

  const [code, setCode] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const ping = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3600);
  };

  const redeem = useMutation({
    mutationFn: () => redeemClaimCode(code),
    onSuccess: async (result) => {
      if (!result.ok) {
        // One message for wrong/expired/used, because the server returns one reason for all
        // three — telling them apart would confirm a guess had once been a real code.
        ping(
          result.reason === 'throttled'
            ? 'Too many tries. Wait an hour and try again.'
            : 'That code is not valid. Codes expire after 15 minutes — ask for a fresh one.',
        );
        return;
      }

      if (!result.merged) {
        ping('That is your own code.');
        return;
      }

      await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: queryKeys.home() });
      setDone(result.display_name ?? 'them');
      setCode('');
    },
    onError: (e: Error) => ping(e.message),
  });

  // Accept whatever they type — lowercase, spaces, the hyphen we display — and normalise for
  // the length check only. The server normalises again before hashing, so this is purely about
  // not disabling the button on a code that is actually complete.
  const normalised = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const ready = normalised.length === 8 && !redeem.isPending;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Claim a person" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        {done !== null ? (
          <GlassSurface radius={radius.card} contentStyle={styles.panel}>
            <Text style={styles.doneTitle}>You are {done} now.</Text>
            <Text style={styles.doneBody}>
              Everything they had recorded against you has moved onto your account. It is already
              on your home screen.
            </Text>
          </GlassSurface>
        ) : (
          <>
            <Text style={styles.lede}>
              If a friend added you to Hisaab before you signed up, they can generate a code for
              you. Typing it here moves everything they recorded against you onto this account.
            </Text>

            <GlassSurface radius={radius.card} contentStyle={styles.panel}>
              <Text style={styles.label}>THEIR CODE</Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="ABCD-2345"
                placeholderTextColor={color.textGhost}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                // `maxLength` counts the hyphen a user may type or paste, so it is 9 rather
                // than 8. The length check above works on the stripped value.
                maxLength={9}
                accessibilityLabel="Claim code"
                style={styles.input}
              />
              <Text style={styles.hint}>
                Eight characters. Codes expire fifteen minutes after they are made.
              </Text>
            </GlassSurface>

            <GlassButton
              label={redeem.isPending ? 'Checking…' : 'Claim'}
              variant="primary"
              disabled={!ready}
              onPress={() => redeem.mutate()}
              style={styles.submit}
            />

            {/*
              * Said plainly, because it is the one thing that surprises people: this is a merge
              * INTO you, and it only ever goes one way. Two friends who each added the other
              * need two codes — merge_profiles refuses a source that already has an account, so
              * a symmetric handshake does not exist and cannot be faked here.
              */}
            <Text style={styles.footnote}>
              This only works one way. If you also added them before they joined, they will need
              a code from you too.
            </Text>
          </>
        )}
      </ScrollView>

      <Toast message={toast} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 4 },

  lede: {
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 22,
    color: color.textSecondary,
    marginBottom: 22,
  },

  panel: { padding: 16, gap: 10 },
  label: {
    fontFamily: font.medium,
    fontSize: 11,
    letterSpacing: 1.4,
    color: color.textMuted,
  },
  input: {
    fontFamily: font.semibold,
    fontSize: 26,
    // Tracked out to match how the code is displayed when it is generated, so the thing on
    // screen looks like the thing they were given.
    letterSpacing: 4,
    color: color.creamWarm,
    paddingVertical: 10,
    textAlign: 'center',
  },
  hint: { fontFamily: font.regular, fontSize: 12.5, color: color.textMuted, textAlign: 'center' },

  submit: { marginTop: 18 },
  footnote: {
    marginTop: 18,
    fontFamily: font.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.textMuted,
    textAlign: 'center',
  },

  doneTitle: {
    fontFamily: font.display,
    fontSize: 26,
    color: color.creamWarm,
  },
  doneBody: {
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 22,
    color: color.textSecondary,
  },
});
