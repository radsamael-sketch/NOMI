-- NOMI cloud schema template. Review and run in Supabase SQL Editor only
-- after creating a project. All user-owned rows are isolated with RLS.
create extension if not exists pgcrypto;

create table if not exists public.nomi_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_name text not null,
  record_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  unique(user_id, store_name, record_id)
);
alter table public.nomi_records enable row level security;
drop policy if exists "Users manage own NOMI records" on public.nomi_records;
create policy "Users manage own NOMI records" on public.nomi_records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.nomi_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_sync_at timestamptz,
  device_label text,
  updated_at timestamptz not null default now()
);
alter table public.nomi_sync_state enable row level security;
drop policy if exists "Users manage own sync state" on public.nomi_sync_state;
create policy "Users manage own sync state" on public.nomi_sync_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nomi-photos', 'nomi-photos', false, 12582912,
        array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do nothing;

drop policy if exists "NOMI users read own photos" on storage.objects;
create policy "NOMI users read own photos" on storage.objects
  for select to authenticated using (bucket_id = 'nomi-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "NOMI users upload own photos" on storage.objects;
create policy "NOMI users upload own photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'nomi-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "NOMI users update own photos" on storage.objects;
create policy "NOMI users update own photos" on storage.objects
  for update to authenticated using (bucket_id = 'nomi-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'nomi-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "NOMI users delete own photos" on storage.objects;
create policy "NOMI users delete own photos" on storage.objects
  for delete to authenticated using (bucket_id = 'nomi-photos' and (storage.foldername(name))[1] = auth.uid()::text);
