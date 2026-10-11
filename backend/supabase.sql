-- Instalación de la base de datos de «Cuaderno de viajes» en Supabase.
-- Cómo usarlo: en el panel de Supabase → SQL Editor → «New query» → pega todo → «Run».
-- Se puede ejecutar más de una vez sin problema.

-- 1. Viajes (cada viaje se guarda como un documento JSON) -------------------
create table if not exists public.viajes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists viajes_user_idx on public.viajes (user_id);
alter table public.viajes enable row level security;

drop policy if exists "viajes: ver los míos" on public.viajes;
drop policy if exists "viajes: crear los míos" on public.viajes;
drop policy if exists "viajes: cambiar los míos" on public.viajes;
drop policy if exists "viajes: borrar los míos" on public.viajes;
create policy "viajes: ver los míos" on public.viajes for select to authenticated using (user_id = (select auth.uid()));
create policy "viajes: crear los míos" on public.viajes for insert to authenticated with check (user_id = (select auth.uid()));
create policy "viajes: cambiar los míos" on public.viajes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "viajes: borrar los míos" on public.viajes for delete to authenticated using (user_id = (select auth.uid()));

-- 2. Ajustes compartidos entre dispositivos (conexión con Gmail, etc.) ------
create table if not exists public.ajustes (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.ajustes enable row level security;
drop policy if exists "ajustes: los míos" on public.ajustes;
create policy "ajustes: los míos" on public.ajustes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 3. Latido: tabla pública sin datos, para que una tarea automática de GitHub
--    consulte la base de datos cada pocos días y el proyecto gratuito no se pause.
create table if not exists public.latido (id int primary key, nota text);
insert into public.latido (id, nota) values (1, 'sigo aquí') on conflict (id) do nothing;
alter table public.latido enable row level security;
drop policy if exists "latido: lectura pública" on public.latido;
create policy "latido: lectura pública" on public.latido for select to anon, authenticated using (true);

grant select, insert, update, delete on public.viajes to authenticated;
grant select, insert, update, delete on public.ajustes to authenticated;
grant select on public.latido to anon, authenticated;

-- 4. Archivos (billetes, fotos, guías…) en un espacio privado ---------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('viajes', 'viajes', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "archivos: ver los míos" on storage.objects;
drop policy if exists "archivos: subir los míos" on storage.objects;
drop policy if exists "archivos: cambiar los míos" on storage.objects;
drop policy if exists "archivos: borrar los míos" on storage.objects;
create policy "archivos: ver los míos" on storage.objects for select to authenticated
  using (bucket_id = 'viajes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "archivos: subir los míos" on storage.objects for insert to authenticated
  with check (bucket_id = 'viajes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "archivos: cambiar los míos" on storage.objects for update to authenticated
  using (bucket_id = 'viajes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "archivos: borrar los míos" on storage.objects for delete to authenticated
  using (bucket_id = 'viajes' and (storage.foldername(name))[1] = (select auth.uid())::text);
