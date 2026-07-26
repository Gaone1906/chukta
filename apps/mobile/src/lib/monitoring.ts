/**
 * Crash reporting.
 *
 * ---------------------------------------------------------------- why, and why now
 *
 * The beta's entire job is to surface bugs before real users meet them. Without this, a tester's
 * crash arrives as "it closed itself" and there is nothing to act on — no stack, no build, no
 * idea whether it happened once or to everybody.
 *
 * ---------------------------------------------------------------- the seam
 *
 * `EXPO_PUBLIC_SENTRY_DSN` absent means monitoring is simply off, and every function here
 * becomes a no-op. Same shape as the tip jar's RevenueCat seam and the store-review ladder: the
 * app must build, run and ship without the service configured, because for most of its life it
 * has not been.
 *
 * Also off in `__DEV__`. Local errors are already loud — LogBox draws them in red across the
 * screen — and shipping them to the same issue stream as real ones is how a stream stops being
 * read.
 *
 * ---------------------------------------------------------------- required, not imported
 *
 * `@sentry/react-native` is a native module, and this codebase has been bitten twice by
 * importing one at module scope: a missing native module throws while the module graph is being
 * evaluated, expo-router evaluates every route file to build its tree, and the whole app group
 * goes blank. A stale dev client that predates this install is exactly that situation. Crash
 * reporting failing to load must cost us crash reporting, not the app.
 *
 * ---------------------------------------------------------------- what must never leave the device
 *
 * This is a money app, and the default configuration of any error reporter is more generous
 * than it should be here. Three specific leaks are closed below:
 *
 * 1. **Our own error messages carry names.** `"${name} is already on Chukta"` and similar are
 *    written for humans and end up verbatim in an exception's `message`.
 * 2. **Route params carry names.** Settle-up is navigated to with `groupName` in its params, so
 *    navigation breadcrumbs would record which groups somebody is in.
 * 3. **Request bodies carry everything.** An RPC breadcrumb for `create_expense` would hold the
 *    description, the amount, and every participant's id.
 *
 * The rule taken here: **ids are fine, words are not.** A uuid identifies a row to somebody who
 * already has database access and means nothing to anybody else; a description is the user's
 * own sentence about their life. So request/response bodies are dropped wholesale, console
 * breadcrumbs are dropped wholesale, and the user is identified by profile id alone — no email,
 * no display name.
 */

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

export const monitoringConfigured = DSN.length > 0 && !__DEV__;

type SentryModule = typeof import('@sentry/react-native');

function sentry(): SentryModule | null {
  if (!monitoringConfigured) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@sentry/react-native') as SentryModule;
  } catch {
    return null;
  }
}

let started = false;

/**
 * Start reporting. Safe to call more than once; safe to call when unconfigured.
 *
 * Called at module scope from the root layout rather than in an effect, because an error thrown
 * while the tree is first mounting is precisely the kind worth catching, and an effect has not
 * run yet at that point.
 */
export function startMonitoring(): void {
  if (started) return;
  const Sentry = sentry();
  if (Sentry === null) return;
  started = true;

  Sentry.init({
    dsn: DSN,

    // Never attach IP address, cookies, or headers. The default is already false in recent
    // versions; stated explicitly because it is the setting whose default we would most regret
    // if it ever changed.
    sendDefaultPii: false,

    // A beta with a handful of testers wants every event. This is the knob to turn down if the
    // app ever has real volume, not before.
    tracesSampleRate: 1.0,

    /*
     * Breadcrumbs are the richest source of accidental disclosure, because they are collected
     * automatically from things nobody thinks of as logging.
     */
    beforeBreadcrumb: (crumb) => {
      // Console output can contain literally anything — including, during development, whole
      // API responses. There is no version of this worth keeping.
      if (crumb.category === 'console') return null;

      // Strip request and response bodies from network crumbs but keep the URL and status:
      // "create_expense returned 409" is the useful part, and the payload is the private part.
      if (crumb.category === 'xhr' || crumb.category === 'fetch') {
        return { ...crumb, data: { ...crumb.data, body: undefined, response_body: undefined } };
      }

      // Navigation crumbs record route params, and `/settle` is navigated to with `groupName`.
      // The route name alone answers "where were they when it broke".
      if (crumb.category === 'navigation') {
        return { ...crumb, data: { from: crumb.data?.from, to: crumb.data?.to } };
      }

      return crumb;
    },

    beforeSend: (event) => {
      // Belt and braces: `sendDefaultPii: false` should already have prevented this, but the
      // request body is the single worst thing that could end up here.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
      }
      return event;
    },
  });
}

/**
 * Tell reports which account they came from.
 *
 * **Profile id only.** It is enough to see whether one person is hitting something repeatedly or
 * fifty people are hitting it once — which is the actual question an issue stream answers — and
 * it discloses nothing to anybody who cannot already read the database.
 */
export function identify(profileId: string | null): void {
  const Sentry = sentry();
  if (Sentry === null) return;
  Sentry.setUser(profileId === null ? null : { id: profileId });
}

/**
 * Report something that was handled but should not have happened.
 *
 * For the cases the app recovers from and therefore never crashes on — a drained write the
 * server refused, a receipt upload that failed twice. Those are invisible without this, and
 * they are exactly what a beta is for.
 */
export function report(error: unknown, context?: Record<string, string>): void {
  const Sentry = sentry();
  if (Sentry === null) return;
  Sentry.captureException(error, context ? { tags: context } : undefined);
}
