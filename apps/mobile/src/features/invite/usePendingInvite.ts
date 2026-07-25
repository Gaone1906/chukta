import { useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';

import { useSession } from '@/features/auth/session';
import { claimPlaceholder } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { tokenFromUrl } from './inviteLink';

/**
 * Catch an invite link and redeem it — but only once there is somebody to redeem it *for*.
 *
 * The ordering here is the whole problem. An invite arrives from someone who does not have an
 * account: the link opens the app, the app sends them to sign in, and only several screens
 * later does a profile exist to fold the placeholder into. Claiming at link-open time would
 * fail every time it mattered.
 *
 * So the token is held and redeemed when the session appears. Held in memory rather than
 * storage on purpose — a token that survives a reinstall is a claim link sitting on the device
 * indefinitely, and the link itself is still in their messages if they abandon signup.
 *
 * Returns a one-shot message for the UI to surface, because "your history was already here" is
 * the single most reassuring thing this app can say and it deserves better than silence.
 */
export function usePendingInvite(): string | null {
  const { session, profile, refreshProfile } = useSession();
  const queryClient = useQueryClient();

  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Guards against a second claim while the first is still in flight — the effect re-runs on
  // every session change, and claiming twice is a wasted round trip at best.
  const claiming = useRef(false);

  // Cold start and warm open are different APIs, and an invite can arrive either way.
  useEffect(() => {
    let cancelled = false;

    Linking.getInitialURL().then((url) => {
      if (cancelled || !url) return;
      const token = tokenFromUrl(url);
      if (token) setPending(token);
    });

    const sub = Linking.addEventListener('url', ({ url }) => {
      const token = tokenFromUrl(url);
      if (token) setPending(token);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!pending || !session || !profile || claiming.current) return;

    claiming.current = true;

    claimPlaceholder(pending)
      .then(async (result) => {
        setPending(null);
        if (!result.merged) return;

        await refreshProfile();
        await queryClient.invalidateQueries({ queryKey: queryKeys.home() });
        setMessage('Welcome — the expenses your friend added are already here.');
      })
      .catch(() => {
        // An expired or already-claimed link is the ordinary case, not an error worth
        // interrupting a brand-new user with. It is dropped silently; nothing was lost,
        // because a claim only ever adds history.
        setPending(null);
      })
      .finally(() => {
        claiming.current = false;
      });
  }, [pending, session, profile, refreshProfile, queryClient]);

  return message;
}
