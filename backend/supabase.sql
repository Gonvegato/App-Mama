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

-- 5. Espacio usado por los archivos (para el indicador de Ajustes) -----------
create or replace function public.uso_archivos()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)
  from storage.objects
  where bucket_id = 'viajes'
    and (storage.foldername(name))[1] = (select auth.uid())::text;
$$;
revoke all on function public.uso_archivos() from public, anon;
grant execute on function public.uso_archivos() to authenticated;

-- 6. Buzón de pagos: avisos de pago del móvil (banco, Google/Apple Wallet) -----
-- Una app de automatización del móvil (Tasker, MacroDroid, Atajos…) manda aquí el texto
-- de cada aviso de pago; la app lo lee, lo apunta como gasto si es durante un viaje y
-- lo borra. Se entra con un código secreto que se crea en Ajustes → Pagos automáticos.
-- Solo se puede ESCRIBIR con ese código (nadie puede leer ni tocar lo de otros); leer y
-- borrar, solo la propia persona ya identificada.
create table if not exists public.pagos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  texto text not null check (char_length(texto) <= 600),
  recibido timestamptz not null default now()
);
create index if not exists pagos_user_idx on public.pagos (user_id, recibido);
alter table public.pagos enable row level security;
drop policy if exists "pagos: ver los míos" on public.pagos;
drop policy if exists "pagos: borrar los míos" on public.pagos;
create policy "pagos: ver los míos" on public.pagos for select to authenticated using (user_id = (select auth.uid()));
create policy "pagos: borrar los míos" on public.pagos for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.pagos from anon;
grant select, delete on public.pagos to authenticated;

-- Guarda un aviso si el código es de alguien. Si no lo es, no dice nada (no se puede
-- tantear qué códigos existen). Guarda como mucho 100 avisos por persona.
create or replace function public._guardar_pago(codigo text, aviso text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  t text := left(btrim(coalesce(aviso, '')), 600);
begin
  if codigo is null or char_length(codigo) < 20 or t = '' then return; end if;
  select a.user_id into uid from public.ajustes a where a.data ->> 'pagosToken' = codigo limit 1;
  if uid is null then return; end if;
  insert into public.pagos (user_id, texto) values (uid, t);
  delete from public.pagos
   where user_id = uid
     and id not in (select p.id from public.pagos p where p.user_id = uid order by p.recibido desc, p.id limit 100);
end;
$$;
revoke all on function public._guardar_pago(text, text) from public, anon, authenticated;

-- Para Tasker y MacroDroid: el cuerpo es el texto tal cual (Content-Type: text/plain) y el
-- código va en la cabecera «x-token». Así no hay que escapar comillas ni saltos de línea.
create or replace function public.recibir_pago(text)
returns void
language sql
security definer
set search_path = ''
as $$
  select public._guardar_pago(current_setting('request.headers', true)::json ->> 'x-token', $1);
$$;
-- Para los Atajos del iPhone: cuerpo JSON {"texto": "..."} y el mismo código en «x-token».
create or replace function public.recibir_pago_json(texto text)
returns void
language sql
security definer
set search_path = ''
as $$
  select public._guardar_pago(current_setting('request.headers', true)::json ->> 'x-token', texto);
$$;
revoke all on function public.recibir_pago(text) from public;
revoke all on function public.recibir_pago_json(text) from public;
grant execute on function public.recibir_pago(text) to anon, authenticated;
grant execute on function public.recibir_pago_json(text) to anon, authenticated;
