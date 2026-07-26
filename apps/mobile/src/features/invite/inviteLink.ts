import * as Linking from 'expo-linking';

/**
 * Where an invite link points.
 *
 * Two forms, and the difference matters:
 *
 * - **A plain invite** — "come and use Chukta" — needs no token, because there is nothing to
 *   claim. It is just a way to get the app.
 * - **A personal invite** carries a claim token, so when that specific person signs up the
 *   placeholder their friend already added — with its whole expense history — becomes theirs
 *   instead of a second, empty account.
 *
 * ## Why these are web URLs and not `chukta://`
 *
 * A custom scheme works perfectly when the app is installed and fails silently when it is
 * not — the browser reports an unknown protocol and the recipient sees nothing. That is
 * exactly backwards for an invite, whose entire audience is people who do not have the app.
 *
 * An https link degrades the right way: with the app installed, iOS Universal Links and
 * Android App Links open it directly; without, the page loads and offers the store.
 *
 * ⚠️ **This needs a domain that we do not own yet** (PROGRESS.md open question #5). Until then
 * `INVITE_ORIGIN` points at the GitHub Pages site that already hosts the legal pages, and the
 * association files (`apple-app-site-association`, `assetlinks.json`) are not published — so
 * these links open a web page rather than the app. The link is correct and shareable either
 * way, which is why this ships now rather than waiting.
 */
const INVITE_ORIGIN = process.env.EXPO_PUBLIC_INVITE_ORIGIN ?? 'https://gaone1906.github.io/chukta';

export function plainInviteUrl(): string {
  return `${INVITE_ORIGIN}/join`;
}

export function personalInviteUrl(token: string): string {
  return `${INVITE_ORIGIN}/join?t=${encodeURIComponent(token)}`;
}

/**
 * Pull a claim token out of a link that opened the app.
 *
 * Accepts both the https form and the `chukta://` scheme, because the dev client opens custom
 * scheme links and testing the real thing before the domain exists would otherwise be
 * impossible.
 */
export function tokenFromUrl(url: string): string | null {
  try {
    const { queryParams, path } = Linking.parse(url);
    if (path && !path.replace(/^\//, '').startsWith('join')) return null;
    const token = queryParams?.t;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** What gets shared. Written to read as a person, not as a growth loop. */
export function inviteMessage(url: string, name?: string): string {
  return name
    ? `I've been keeping our shared expenses in Chukta — this link picks up where we left off, so you'll see everything already there.\n\n${url}`
    : `I use Chukta to keep track of shared expenses. It's free, and there are no ads.\n\n${url}`;
}
