-- Install pg_net, which `0030` assumed and never created.
--
-- ---------------------------------------------------------------- how this got missed
--
-- `0030` opens with `create extension if not exists pg_cron` and then calls `net.http_post`
-- inside `internal.dispatch_notifications()` without ever creating pg_net. That worked
-- everywhere it was tested, because the local Supabase stack ships pg_net pre-installed — so
-- the missing line was invisible for six migrations.
--
-- It stayed invisible through the push, too, and that is the part worth understanding. A
-- plpgsql function body is parsed for SYNTAX at `create function` time but its object
-- references are not resolved until it runs. So `perform net.http_post(...)` inside a function
-- body is just text as far as the migration is concerned: `0030` applied cleanly to a database
-- with no `net` schema at all, reported success, and scheduled a cron job that would fail every
-- thirty seconds from then on. Nothing in the push output could have told us.
--
-- Confirmed on the hosted project rather than assumed: `pg_extension` listed pg_cron 1.6.4,
-- pg_trgm, pgcrypto and supabase_vault, and no pg_net. `pg_available_extensions` had it at
-- 0.20.4 with `installed_version` null.
--
-- ---------------------------------------------------------------- why a new file
--
-- `0030` is already applied to the hosted project, so it can no longer be edited in place. That
-- window closed the moment the first push ran, which the release plan called out in advance;
-- this is that rule being obeyed rather than discovered.
--
-- ---------------------------------------------------------------- the schema is not ours to choose
--
-- No `with schema` clause on purpose. pg_net is non-relocatable and pins itself to `net`, which
-- is what every call site already spells. Naming a schema here would either be ignored or
-- error, and getting it "helpfully" wrong would move `http_post` somewhere `0030` cannot see.

create extension if not exists pg_net;

/*
 * `internal.dispatch_notifications()` is `security definer` and owned by the migration role, so
 * it executes as that role rather than as the cron job's caller. These grants are what let it
 * reach into `net` — without them the extension exists and the call still fails, which looks
 * identical from the outside and is the more confusing half of this bug.
 *
 * Narrow on purpose: `postgres` only. Nothing that reaches this database over PostgREST has any
 * business making arbitrary outbound HTTP requests from inside Postgres, and `anon` or
 * `authenticated` holding execute on `net.http_post` would be a server-side request forgery
 * primitive handed out for free.
 */
grant usage on schema net to postgres;
grant execute on all functions in schema net to postgres;

revoke all on schema net from anon, authenticated;

notify pgrst, 'reload schema';
