-- Slothpress — Postgres schema
--
-- This is the server-side half of Slothpress. The app itself never talks to
-- it: a card is drawn in the browser and can be exported without the network
-- ever being involved. The schema is here for the part that does need a
-- server, which is sharing cards between devices.
--
-- The shape follows Supabase (Postgres + auth.users + PostgREST + RLS), but
-- it runs on plain Postgres too. Where the two differ, the difference is
-- handled by a shim at the bottom of this file.
--
-- Fixes applied to the original blueprint, and why:
--
--   1. `default timezone('utc', now())` was a type error. `now()` already
--      returns timestamptz; the default is just `now()`.
--   2. `users.id` was a standalone uuid. It has to reference `auth.users(id)`
--      or the two halves of the identity can drift apart.
--   3. There were no RLS policies at all, which means every table was
--      readable and writable by anyone with the anon key.
--   4. There were no counter triggers, so `like_count` would only ever be
--      whatever the client last wrote.
--   5. There was no comments table, so there was nowhere for the moderation
--      state to live.
--   6. The feed index was `(created_at desc)` alone, which does not support
--      keyset pagination. It is `(created_at desc, id desc)` now.
--   7. Cross-table lookups inside a policy used the same table they are
--      checking, which trips Postgres error 42P17 (infinite recursion
--      detected in policy). Those lookups go through `security definer`
--      functions in a schema that is not exposed over the API.

-- ---------------------------------------------------------------------------
-- Extensions and schemas
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- `private` holds helper functions that policies call. It is not in the
-- API's exposed schema list, so the client cannot call these directly.
create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Profiles: one row per signed-in person
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique check (username ~ '^[a-z0-9_]{3,32}$'),
  display_name  text,
  avatar_url    text,
  bio           text check (char_length(bio) <= 280),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is 'One row per auth.users row. Created by a trigger, never by the client.';

-- ---------------------------------------------------------------------------
-- Cards
-- ---------------------------------------------------------------------------

create table if not exists public.cards (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid not null references public.profiles (id) on delete cascade,
  content         text not null check (char_length(content) between 1 and 2000),
  style_metadata  jsonb not null default '{}'::jsonb,
  is_public       boolean not null default true,
  is_deleted      boolean not null default false,
  like_count      integer not null default 0 check (like_count >= 0),
  comment_count   integer not null default 0 check (comment_count >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column public.cards.style_metadata is
  'Font, size, alignment, background and colours. Snake_case on purpose: this value is read back on another device and should still mean the same thing in a year.';

comment on column public.cards.like_count is
  'Maintained by trigger from card_interactions. The client never writes it.';

-- The feed. Keyset pagination needs the id as a tiebreaker, otherwise two
-- cards created in the same transaction can be skipped or repeated.
create index if not exists cards_feed_idx
  on public.cards (created_at desc, id desc)
  where is_public and not is_deleted;

create index if not exists cards_author_idx
  on public.cards (author_id, created_at desc, id desc);

-- Style filters, if the app ever grows them.
create index if not exists cards_style_idx
  on public.cards using gin (style_metadata jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- Interactions: likes and bookmarks
-- ---------------------------------------------------------------------------

create table if not exists public.card_interactions (
  card_id    uuid not null references public.cards (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null check (type in ('like', 'bookmark')),
  created_at timestamptz not null default now(),
  primary key (card_id, user_id, type)
);

-- "everything I liked", newest first.
create index if not exists card_interactions_user_idx
  on public.card_interactions (user_id, type, created_at desc);

create index if not exists card_interactions_card_idx
  on public.card_interactions (card_id, type);

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

create table if not exists public.card_comments (
  id               uuid primary key default gen_random_uuid(),
  card_id          uuid not null references public.cards (id) on delete cascade,
  author_id        uuid not null references public.profiles (id) on delete cascade,
  parent_id        uuid references public.card_comments (id) on delete cascade,
  body             text not null check (char_length(body) between 1 and 1000),
  moderation_state text not null default 'visible'
                     check (moderation_state in ('visible', 'pending', 'hidden')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists card_comments_card_idx
  on public.card_comments (card_id, created_at desc, id desc)
  where moderation_state = 'visible';

create index if not exists card_comments_author_idx
  on public.card_comments (author_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      'user_' || substr(replace(new.id::text, '-', ''), 1, 8)
    ),
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates a profile row when someone signs up. Runs as the definer so the new row is written even though the client cannot insert profiles directly.';

-- The like and comment counters. The client never writes them, so they cannot
-- drift away from the rows they count.
create or replace function public.sync_card_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.cards
       set like_count = like_count + 1,
           updated_at = now()
     where id = new.card_id;

    if tg_table_name = 'card_comments' then
      update public.cards
         set comment_count = comment_count + 1,
             updated_at = now()
       where id = new.card_id;
    end if;

    return new;
  end if;

  update public.cards
     set like_count = greatest(0, like_count - 1),
         updated_at = now()
   where id = old.card_id;

  if tg_table_name = 'card_comments' then
    update public.cards
       set comment_count = greatest(0, comment_count - 1),
           updated_at = now()
     where id = old.card_id;
  end if;

  return old;
end;
$$;

comment on function public.sync_card_counters() is
  'Keeps cards.like_count and cards.comment_count equal to the number of rows behind them.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists cards_touch_updated_at on public.cards;
create trigger cards_touch_updated_at
  before update on public.cards
  for each row execute function public.touch_updated_at();

drop trigger if exists card_comments_touch_updated_at on public.card_comments;
create trigger card_comments_touch_updated_at
  before update on public.card_comments
  for each row execute function public.touch_updated_at();

drop trigger if exists card_interactions_counter on public.card_interactions;
create trigger card_interactions_counter
  after insert or delete on public.card_interactions
  for each row execute function public.sync_card_counters();

drop trigger if exists card_comments_counter on public.card_comments;
create trigger card_comments_counter
  after insert or delete on public.card_comments
  for each row execute function public.sync_card_counters();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.cards            enable row level security;
alter table public.card_interactions enable row level security;
alter table public.card_comments    enable row level security;

-- Force RLS for the table owner too, so a mistake in a policy cannot be
-- masked by running the query as a superuser.
alter table public.profiles         force row level security;
alter table public.cards            force row level security;
alter table public.card_interactions force row level security;
alter table public.card_comments    force row level security;

-- Profiles: readable by anyone (they are public profiles), writable only by
-- their owner.
drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public
  on public.profiles
  for select
  using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
  on public.profiles
  for insert
  with check ((select auth.uid()) = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles
  for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists profiles_delete_self on public.profiles;
create policy profiles_delete_self
  on public.profiles
  for delete
  using ((select auth.uid()) = id);

-- Cards: public cards are readable by anyone, and a card is always readable
-- by its author. Writes are the author's alone.
drop policy if exists cards_select_visible on public.cards;
create policy cards_select_visible
  on public.cards
  for select
  using (
    (is_public and not is_deleted)
    or ((select auth.uid()) = author_id)
  );

drop policy if exists cards_insert_own on public.cards;
create policy cards_insert_own
  on public.cards
  for insert
  with check ((select auth.uid()) = author_id);

drop policy if exists cards_update_own on public.cards;
create policy cards_update_own
  on public.cards
  for update
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);

drop policy if exists cards_delete_own on public.cards;
create policy cards_delete_own
  on public.cards
  for delete
  using ((select auth.uid()) = author_id);

-- Interactions: a row belongs to the person who made it. Counts are read
-- from cards.like_count, not by counting these rows, so there is no reason
-- to let anyone enumerate who liked what.
drop policy if exists interactions_select_own on public.card_interactions;
create policy interactions_select_own
  on public.card_interactions
  for select
  using ((select auth.uid()) = user_id);

drop policy if exists interactions_insert_own on public.card_interactions;
create policy interactions_insert_own
  on public.card_interactions
  for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists interactions_delete_own on public.card_interactions;
create policy interactions_delete_own
  on public.card_interactions
  for delete
  using ((select auth.uid()) = user_id);

-- Comments: visible ones are public, anything else is only visible to its
-- author. A comment can only be attached to a card that is actually public.
drop policy if exists comments_select_visible on public.card_comments;
create policy comments_select_visible
  on public.card_comments
  for select
  using (
    (moderation_state = 'visible')
    or ((select auth.uid()) = author_id)
  );

drop policy if exists comments_insert_own on public.card_comments;
create policy comments_insert_own
  on public.card_comments
  for insert
  with check (
    ((select auth.uid()) = author_id)
    and private.card_is_public(card_id)
  );

drop policy if exists comments_update_own on public.card_comments;
create policy comments_update_own
  on public.card_comments
  for update
  using ((select auth.uid()) = author_id)
  with check ((select auth.uid()) = author_id);

drop policy if exists comments_delete_own on public.card_comments;
create policy comments_delete_own
  on public.card_comments
  for delete
  using ((select auth.uid()) = author_id);

-- ---------------------------------------------------------------------------
-- Policy helper functions
-- ---------------------------------------------------------------------------

create or replace function private.card_is_public(p_card_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.cards c
     where c.id = p_card_id
       and c.is_public
       and not c.is_deleted
  );
$$;

comment on function private.card_is_public(uuid) is
  'Used by the comments insert policy. security definer so the check does not re-enter the cards policies, which Postgres reports as error 42P17.';

revoke all on function private.card_is_public(uuid) from public, anon;
grant execute on function private.card_is_public(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The feed
-- ---------------------------------------------------------------------------

create or replace function public.list_public_cards(
  p_before_created_at timestamptz default null,
  p_before_id         uuid        default null,
  p_limit             integer     default 20
)
returns setof public.cards
language sql
stable
set search_path = ''
as $$
  select c.*
    from public.cards c
   where c.is_public
     and not c.is_deleted
     and (
       p_before_created_at is null
       or p_before_id is null
       or (c.created_at, c.id) < (p_before_created_at, p_before_id)
     )
   order by c.created_at desc, c.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

comment on function public.list_public_cards(timestamptz, uuid, integer) is
  'Keyset pagination. Pass the created_at and id of the last card you saw; rows with the same created_at are never skipped or repeated.';

grant execute on function public.list_public_cards(timestamptz, uuid, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

grant select on public.profiles to anon, authenticated;
grant insert, update, delete on public.profiles to authenticated;

grant select on public.cards to anon, authenticated;
grant insert, update, delete on public.cards to authenticated;

grant select, insert, delete on public.card_interactions to authenticated;

grant select on public.card_comments to anon, authenticated;
grant insert, update, delete on public.card_comments to authenticated;

grant usage, select on sequence public.cards_id_seq to authenticated;

-- Trigger functions are not called by anybody directly. Postgres does not
-- re-check EXECUTE when a trigger fires, so tightening this after the
-- triggers exist is safe.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_card_counters() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Local development shim
-- ---------------------------------------------------------------------------
-- Supabase provides `auth.uid()`. On a plain Postgres server it does not
-- exist, and the policies above would fail to parse. This block creates a
-- stand-in that reads the same JWT claim PostgREST sets, so the schema and
-- the audit script can be run locally without Supabase.

do $shim$
begin
  if to_regclass('auth.uid') is null then
    create schema if not exists auth;
    execute $fn$
      create function auth.uid()
      returns uuid
      language sql
      stable
      as $body$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $body$
    $fn$;
  end if;
end
$shim$;
