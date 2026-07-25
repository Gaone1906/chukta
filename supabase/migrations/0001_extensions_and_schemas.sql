-- Extensions and schema layout.
--
-- Four schemas, each with a different exposure:
--   public   — client-visible tables. RLS on, read-only to clients (writes go through RPCs).
--   app      — RPCs and views the client calls. The only write surface.
--   auth_ext — SECURITY DEFINER helpers used inside RLS policies. Never called by clients.
--   internal — queues, logs, sync spine. No client grants at all.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists app;
create schema if not exists auth_ext;
create schema if not exists internal;

comment on schema app is 'RPCs and views the client is allowed to call.';
comment on schema auth_ext is 'SECURITY DEFINER helpers for RLS. Not client-callable.';
comment on schema internal is 'Queues, logs and the sync spine. No client access.';

-- Clients reach the database as `authenticated` (or `anon` before sign-in). They may execute
-- functions in `app`, and nothing else — every table grant is added explicitly below.
grant usage on schema public to authenticated, anon;
grant usage on schema app to authenticated;

-- Deny by default: no blanket table privileges anywhere. Read access is granted per table in
-- 0012 alongside its RLS policy, so a table without a policy is unreachable rather than open.
alter default privileges in schema public revoke all on tables from authenticated, anon;
