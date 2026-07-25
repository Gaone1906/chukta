/**
 * JSON that survives a `bigint`.
 *
 * Money in this app is a JS `bigint` from the moment it crosses `lib/api.ts` — that is the
 * whole point, because `amount_minor` is a Postgres bigint and routing it through `number`
 * silently loses precision above 2^53. Everything downstream inherits it: eighteen fields on
 * the read path, four on the write path, nested up to four levels deep.
 *
 * `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt` on every one of
 * them. That matters more than it sounds, because of *where* it throws:
 *
 *   - In the query persister, TanStack catches the throw and hands it to an optional `retry`
 *     callback. With no retry configured it is swallowed, and the cache simply never writes.
 *     The symptom is "offline reads don't work" with no crash and nothing in the log.
 *   - In the outbox it would take out the enqueue, i.e. lose the write.
 *
 * So both use this, and neither may use plain JSON.
 *
 * A bigint is tagged rather than written as a bare string, because the round trip has to be
 * lossless in both directions: `"4320"` and `4320n` are different values and the screens that
 * read them do arithmetic. The tag mirrors the convention already in the codebase — Postgres
 * sends bigint as a string over the wire precisely so precision survives the hop.
 */

const TAG = '__bigint__';

/**
 * The one ambiguity, stated so it is a known limit rather than a surprise: an object that
 * genuinely has exactly one key, named `__bigint__`, holding a numeric string, would come back
 * as a bigint. Nothing in this app's shapes can produce one — they are all RPC results with
 * fixed field names.
 */
function isTagged(value: object): value is Record<typeof TAG, string> {
  const keys = Object.keys(value);
  return (
    keys.length === 1 &&
    keys[0] === TAG &&
    typeof (value as Record<string, unknown>)[TAG] === 'string'
  );
}

export function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) =>
    typeof raw === 'bigint' ? { [TAG]: raw.toString() } : raw,
  );
}

export function parse<T>(text: string): T {
  return JSON.parse(text, (_key, raw: unknown) =>
    raw !== null && typeof raw === 'object' && isTagged(raw) ? BigInt(raw[TAG]) : raw,
  ) as T;
}
