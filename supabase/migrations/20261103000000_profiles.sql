create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  profile_data jsonb not null default '{}'::jsonb,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9]([a-z0-9-]{0,37}[a-z0-9])?$'),
  constraint profiles_username_reserved check (username not in ('admin', 'api', 'auth', 'dashboard', 'login', 'logout', 'settings', 'static', 'assets', 'favicon.ico', 'robots.txt')),
  constraint profiles_data_object check (jsonb_typeof(profile_data) = 'object')
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to anon, authenticated;
grant insert, update, delete on table public.profiles to authenticated;

drop policy if exists "Published profiles are public" on public.profiles;
create policy "Published profiles are public"
  on public.profiles for select
  to anon, authenticated
  using (published = true);

drop policy if exists "Owners can read their profile" on public.profiles;
create policy "Owners can read their profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Owners can create their profile" on public.profiles;
create policy "Owners can create their profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owners can update their profile" on public.profiles;
create policy "Owners can update their profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owners can delete their profile" on public.profiles;
create policy "Owners can delete their profile"
  on public.profiles for delete
  to authenticated
  using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-media',
  'profile-media',
  true,
  41943040,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Published profile media is readable" on storage.objects;
create policy "Published profile media is readable"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'profile-media');

drop policy if exists "Owners upload profile media" on storage.objects;
create policy "Owners upload profile media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Owners update profile media" on storage.objects;
create policy "Owners update profile media"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Owners delete profile media" on storage.objects;
create policy "Owners delete profile media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
