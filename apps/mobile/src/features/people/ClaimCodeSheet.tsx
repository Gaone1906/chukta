import { useMutation } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { GlassButton, Sheet, color, font, radius } from '@/design';
import { createClaimCode, type ClaimCode } from '@/lib/api';

/**
 * Generate a short code somebody can type, for a placeholder you added.
 *
 * The share LINK already exists and is better whenever you can send a link. This is for the
 * cases a link is awkward: reading it down a phone, or the other person being right next to you
 * with their own screen open.
 *
 * ---------------------------------------------------------------- what this hands over
 *
 * Redeeming merges the placeholder — and every expense recorded against it — into whoever types
 * the code, and **there is no un-merge anywhere in the schema**. So the sheet is deliberately
 * blunt about who it is for. The failure mode worth designing against is not a stranger
 * guessing (fifteen minutes at forty bits makes that essentially impossible); it is the user
 * cheerfully posting the code somewhere public because nothing told them not to.
 *
 * ---------------------------------------------------------------- and why it can go stale
 *
 * Fifteen minutes, not the invite link's ninety days. At forty bits the number of codes alive
 * at once IS the security parameter, so a short window is the control doing the real work
 * (0026). That makes expiry an ordinary event rather than an error: the countdown is shown from
 * the start, and when it runs out the sheet offers a new code instead of an apology.
 */
export function ClaimCodeSheet({
  visible,
  profileId,
  displayName,
  onClose,
}: {
  visible: boolean;
  profileId: string;
  displayName: string;
  onClose: () => void;
}) {
  if (!visible) return null;
  return (
    <ClaimCodeBody profileId={profileId} displayName={displayName} onClose={onClose} />
  );
}

function ClaimCodeBody({
  profileId,
  displayName,
  onClose,
}: {
  profileId: string;
  displayName: string;
  onClose: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [code, setCode] = useState<ClaimCode | null>(null);

  const mint = useMutation({
    mutationFn: () => createClaimCode(profileId),
    onSuccess: (result) => {
      setCode(result);
      setNote(null);
    },
    onError: (e: Error) =>
      setNote(
        // The server refuses a profile that already signed up. That is not a failure the user
        // caused, and it has a genuinely good answer, so it gets its own sentence.
        e.message.includes('already has an account')
          ? `${displayName} is already on Chukta — there is nothing to claim.`
          : e.message,
      ),
  });

  // Mint on open rather than behind a button. There is nothing to decide first, and a sheet
  // whose only content is a button that reveals the real content is a wasted tap.
  useEffect(() => {
    mint.mutate();
    // Once, on mount. `mint` is recreated every render, so depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remaining = useCountdown(code?.expires_at ?? null);
  const expired = code !== null && remaining <= 0;

  return (
    <Sheet
      visible
      onClose={onClose}
      title={`Claim code for ${displayName}`}
      subtitle="They type this into Chukta to take over their side of the ledger."
      footer={
        <GlassButton
          label={expired ? 'Get a new code' : 'Done'}
          variant={expired ? 'primary' : 'secondary'}
          disabled={mint.isPending}
          onPress={expired ? () => mint.mutate() : onClose}
        />
      }
    >
      {mint.isPending && code === null ? (
        <Text style={styles.status}>Generating…</Text>
      ) : null}

      {code !== null ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Copy the code, ${code.formatted.split('').join(' ')}`}
            onPress={() => {
              void Clipboard.setStringAsync(code.formatted);
              setNote('Copied.');
            }}
            style={({ pressed }) => [
              styles.codeBox,
              expired ? styles.codeExpired : null,
              pressed ? styles.codePressed : null,
            ]}
          >
            <Text style={[styles.code, expired ? styles.codeTextExpired : null]}>
              {code.formatted}
            </Text>
          </Pressable>

          <Text style={styles.timer}>
            {expired
              ? 'This code has expired.'
              : `Expires in ${formatRemaining(remaining)}. Tap it to copy.`}
          </Text>

          {/*
            * The warning is not boilerplate. Whoever types this absorbs the whole shared history
            * with this person, permanently, and nothing else on screen would tell them that.
            */}
          <Text style={styles.warning}>
            Only give this to {displayName}. Whoever enters it takes over every expense you have
            recorded against them, and it cannot be undone.
          </Text>
        </>
      ) : null}

      {note !== null ? <Text style={styles.note}>{note}</Text> : null}
    </Sheet>
  );
}

/**
 * Seconds left, ticking once a second.
 *
 * A timer rather than a static "expires at 15:42" because the whole point of the short window
 * is that the user should feel it — a wall-clock time reads as trivia, a countdown reads as
 * "read this out now".
 */
function useCountdown(expiresAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (expiresAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (expiresAt === null) return 0;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  status: { fontFamily: font.regular, fontSize: 15, color: color.textMuted, textAlign: 'center' },

  codeBox: {
    marginTop: 4,
    paddingVertical: 18,
    borderRadius: radius.cardCompact,
    borderWidth: 1,
    borderColor: 'rgba(184,150,60,0.45)',
    backgroundColor: 'rgba(184,150,60,0.12)',
    alignItems: 'center',
  },
  codePressed: { backgroundColor: 'rgba(184,150,60,0.22)' },
  codeExpired: { borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.04)' },
  code: {
    fontFamily: font.semibold,
    fontSize: 32,
    color: color.goldBright,
    // Wide tracking so the eye groups the characters while reading them aloud, which is the
    // thing this code exists to be used for.
    letterSpacing: 4,
  },
  codeTextExpired: { color: color.textGhost },

  timer: {
    marginTop: 10,
    fontFamily: font.regular,
    fontSize: 13,
    color: color.textMuted,
    textAlign: 'center',
  },
  warning: {
    marginTop: 14,
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: color.textSecondary,
    textAlign: 'center',
  },
  note: {
    marginTop: 12,
    fontFamily: font.regular,
    fontSize: 13,
    color: color.textMuted,
    textAlign: 'center',
  },
});
