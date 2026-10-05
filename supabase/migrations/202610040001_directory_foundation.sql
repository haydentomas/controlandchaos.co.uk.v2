begin;

grant usage on schema public to anon, authenticated, service_role;
create schema if not exists cc_private;
revoke all on schema cc_private from public, anon, authenticated;
grant usage on schema cc_private to authenticated, service_role;

create table public.directory_profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  sl_username text not null unique check (char_length(btrim(sl_username)) between 1 and 100),
  role_type text not null check (role_type in ('domme', 'sub', 'switch')),
  headline text not null default '' check (char_length(headline) <= 160),
  tagline text not null default '' check (char_length(tagline) <= 1000),
  about text not null default '' check (char_length(about) <= 20000),
  avatar_image text not null default '' check (avatar_image = '' or avatar_image ~ '^(/[^/]|https?://)[^[:space:]]+$'),
  banner_image text not null default '' check (banner_image = '' or banner_image ~ '^(/[^/]|https?://)[^[:space:]]+$'),
  starting_rate text not null default '' check (char_length(starting_rate) <= 100),
  availability text not null default 'available' check (availability in ('available', 'busy', 'away', 'offline')),
  tags text[] not null default '{}' check (cardinality(tags) <= 20 and array_position(tags, null) is null and octet_length(array_to_string(tags, '|')) <= 2000),
  is_published boolean not null default false,
  is_approved boolean not null default false,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table cc_private.verified_avatar_links (
  avatar_uuid uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (avatar_uuid, user_id)
);

create table cc_private.profile_owners (
  profile_id uuid primary key references public.directory_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_uuid uuid not null unique,
  assigned_at timestamptz not null default now(),
  foreign key (avatar_uuid, user_id) references cc_private.verified_avatar_links(avatar_uuid, user_id) on delete cascade
);

create index verified_avatar_links_user_idx on cc_private.verified_avatar_links(user_id);
create index profile_owners_user_idx on cc_private.profile_owners(user_id);
create index directory_profiles_public_order_idx on public.directory_profiles(is_featured desc, display_name, id) where is_approved and is_published;
create index directory_profiles_role_idx on public.directory_profiles(role_type) where is_approved and is_published;
create index directory_profiles_tags_idx on public.directory_profiles using gin(tags);

alter table public.directory_profiles enable row level security;
alter table cc_private.verified_avatar_links enable row level security;
alter table cc_private.profile_owners enable row level security;

revoke all on table public.directory_profiles from public, anon, authenticated;
revoke all on table cc_private.verified_avatar_links, cc_private.profile_owners from public, anon, authenticated;
grant select on table public.directory_profiles to anon, authenticated;
grant update (display_name, role_type, headline, tagline, about, avatar_image, banner_image, starting_rate, availability, tags, is_published) on public.directory_profiles to authenticated;
grant all on table public.directory_profiles, cc_private.verified_avatar_links, cc_private.profile_owners to service_role;

create function cc_private.can_manage_directory_profile(target_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from cc_private.profile_owners as ownership
    join cc_private.verified_avatar_links as identity
      on identity.avatar_uuid = ownership.avatar_uuid and identity.user_id = ownership.user_id
    where ownership.profile_id = target_profile
      and ownership.user_id = (select auth.uid())
      and identity.revoked_at is null
  );
$$;

revoke all on function cc_private.can_manage_directory_profile(uuid) from public, anon;
grant execute on function cc_private.can_manage_directory_profile(uuid) to authenticated, service_role;

create policy directory_public_read on public.directory_profiles
for select to anon, authenticated
using (is_approved and is_published);

create policy directory_owner_read on public.directory_profiles
for select to authenticated
using (cc_private.can_manage_directory_profile(id));

create policy directory_owner_update on public.directory_profiles
for update to authenticated
using (cc_private.can_manage_directory_profile(id))
with check (cc_private.can_manage_directory_profile(id));

create function cc_private.touch_directory_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function cc_private.touch_directory_profile() from public, anon, authenticated;
create trigger directory_profiles_updated_at
before update on public.directory_profiles
for each row execute function cc_private.touch_directory_profile();

commit;