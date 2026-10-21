-- Slothpress — leak scenarios
--
-- The audit script checks the shape of the policies. This one checks what they
-- actually do, by putting a real row in the database and trying to read it
-- with the wrong identity.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/rls-scenarios.sql
--
-- It creates the `anon` and `authenticated` roles if they are missing, and
-- it cleans up after itself.

\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

grant usage on schema public to anon, authenticated;

begin;

-- Two people, two cards. `owner` owns the private card, `stranger` owns the
-- other one.
create temporary table slothpress_fixtures (
  label text primary key,
  owner uuid not null,
  card uuid not null,
  private_card uuid not null
) on commit drop;

insert into public.profiles (id, username)
values
  ('11111111-1111-1111-1111-111111111111', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'stranger');

insert into public.cards (id, author_id, content, is_public)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a public card', true),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a private card', false),
  ('aaaaaaaa-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'someone else''s card', true);

insert into slothpress_fixtures
values ('owner', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002');

insert into public.card_interactions (card_id, user_id, type)
values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'like');

-- 1. An anonymous visitor sees public cards and nothing else.
set local role anon;
set local request.jwt.claim.sub = '';

do $$
declare
  v_total int;
  v_private int;
begin
  select count(*) into v_total from public.cards;
  select count(*) into v_private from public.cards where not is_public;

  if v_total <> 2 then
    raise exception 'anon saw % cards, expected 2 public ones', v_total;
  end if;
  if v_private <> 0 then
    raise exception 'anon saw % private cards', v_private;
  end if;
end
$$;

-- 2. An anonymous visitor cannot write a card.
do $$
begin
  insert into public.cards (author_id, content)
  values ('11111111-1111-1111-1111-111111111111', 'should not be allowed');

  raise exception 'anon was allowed to insert a card';
exception
  when insufficient_privilege then null;
  when check_violation then null;
end
$$;

reset role;

-- 3. A signed-in stranger cannot read someone else's private card.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare
  v_total int;
begin
  select count(*) into v_total from public.cards;
  if v_total <> 2 then
    raise exception 'stranger saw % cards, expected the 2 public ones', v_total;
  end if;
end
$$;

-- 4. A signed-in stranger cannot read another person's likes.
do $$
declare
  v_total int;
begin
  select count(*) into v_total from public.card_interactions;
  if v_total <> 0 then
    raise exception 'stranger read % interaction rows belonging to someone else', v_total;
  end if;
end
$$;

-- 5. A signed-in stranger cannot update or delete another person's card.
do $$
begin
  update public.cards set content = 'edited' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

  raise exception 'stranger was allowed to update a card they do not own';
exception
  when insufficient_privilege then null;
  when check_violation then null;
end
$$;

do $$
begin
  delete from public.cards where id = 'aaaaaaaa-0000-0000-0000-000000000001';

  raise exception 'stranger was allowed to delete a card they do not own';
exception
  when insufficient_privilege then null;
  when check_violation then null;
end
$$;

-- 6. A signed-in stranger cannot comment on a private card.
do $$
begin
  insert into public.card_comments (card_id, author_id, body)
  values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'hello');

  raise exception 'stranger was allowed to comment on a private card';
exception
  when insufficient_privilege then null;
  when check_violation then null;
end
$$;

reset role;

-- 7. The owner can read their own private card.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  v_total int;
begin
  select count(*) into v_total from public.cards;
  if v_total <> 3 then
    raise exception 'owner saw % cards, expected all 3', v_total;
  end if;
end
$$;

-- 8. The owner can edit their own card.
update public.cards set content = 'edited by the owner' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

do $$
declare
  v_content text;
begin
  select content into v_content from public.cards where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_content <> 'edited by the owner' then
    raise exception 'owner could not edit their own card';
  end if;
end
$$;

reset role;

-- 9. The like counter followed the rows.
do $$
declare
  v_likes int;
begin
  select like_count into v_likes
    from public.cards
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';

  if v_likes <> 1 then
    raise exception 'like_count is %, expected 1', v_likes;
  end if;
end
$$;

rollback;

\echo 'All leak scenarios passed.'
