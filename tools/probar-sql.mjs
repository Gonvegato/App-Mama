// Prueba de la sección 6 de backend/supabase.sql (buzón de pagos) en un Postgres real, con roles y RLS.
// No forma parte de «npm test» para no añadir dependencias: ejecútala con
//   npm i --no-save @electric-sql/pglite && node tools/probar-sql.mjs
// Prueba de la sección 6 de supabase.sql en un Postgres real (PGlite), con roles y RLS de verdad.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const sql = fs.readFileSync(new URL('../backend/supabase.sql', import.meta.url), 'utf8');
const sec6 = sql.slice(sql.indexOf('-- 6. Buzón de pagos'));
const db = new PGlite();
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : bad++; console.log(`${cond ? '✔' : '✘'} ${name}${cond ? '' : '  ← ' + extra}`); };
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key);
  create role anon nologin; create role authenticated nologin;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  -- la tabla de ajustes tal como la crea el script real
  create table public.ajustes (user_id uuid primary key references auth.users (id) on delete cascade, data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
`);
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
const TA = 'a'.repeat(32), TB = 'b'.repeat(32);
await db.exec(`insert into auth.users values ('${A}'), ('${B}');
  insert into public.ajustes (user_id, data) values ('${A}', '{"pagosToken":"${TA}"}'), ('${B}', '{"pagosToken":"${TB}"}');`);
await db.exec(sec6);
await db.exec(sec6);   // se puede ejecutar dos veces
check('el script se puede ejecutar dos veces seguidas', true);

// llamada como lo hace PostgREST: rol anon + cabeceras como JSON
const asAnon = async (fn, args, token) => {
  await db.exec(`set role anon; select set_config('request.headers', '${JSON.stringify(token ? { 'x-token': token } : {})}', false)`);
  try { return await db.query(`select public.${fn}(${args.map(a => `'${a.replace(/'/g, "''")}'`).join(', ')})`); }
  finally { await db.exec('reset role'); }
};
const count = async uid => (await db.query(`select count(*)::int n from public.pagos where user_id='${uid}'`)).rows[0].n;

await asAnon('recibir_pago', ['Pago de 25,00 € en PICHON ROJO'], TA);
check('con el código de A, el aviso se guarda para A', await count(A) === 1);
check('…y no aparece en B', await count(B) === 0);
await asAnon('recibir_pago_json', ['Compra de 9,50 € en Bar Pepe'], TB);
check('la variante JSON guarda para B con su código', await count(B) === 1);
await asAnon('recibir_pago', ['intento con código falso'], 'z'.repeat(32));
await asAnon('recibir_pago', ['sin código'], null);
await asAnon('recibir_pago', ['código demasiado corto'], 'abc');
check('código falso, ausente o corto: no guarda nada y no da error', await count(A) === 1 && await count(B) === 1);
await asAnon('recibir_pago', ['   '], TA);
check('un aviso vacío no se guarda', await count(A) === 1);
await asAnon('recibir_pago', ['x'.repeat(2000)], TA);
check('un texto enorme se recorta a 600 en vez de fallar', (await db.query(`select max(char_length(texto))::int m from public.pagos where user_id='${A}'`)).rows[0].m === 600);
await asAnon('recibir_pago', ["Pago de 5 € en L'Atelier \"Le Petit\"\nsegunda línea"], TA);
check('comillas, apóstrofos y saltos de línea no rompen nada', (await db.query(`select 1 from public.pagos where texto like '%Atelier%' and texto like E'%\\n%'`)).rows.length === 1);

// permisos: lo que NO se puede hacer con la clave pública
const denied = async (name, q, role = 'anon') => {
  await db.exec(`set role ${role}`);
  let failed = false; try { await db.query(q); } catch { failed = true; }
  await db.exec('reset role');
  check(name, failed);
};
await denied('anon NO puede leer la tabla de pagos', 'select * from public.pagos');
await denied('anon NO puede insertar directamente', `insert into public.pagos (user_id, texto) values ('${A}', 'colado')`);
await denied('anon NO puede borrar', 'delete from public.pagos');
await denied('anon NO puede llamar a la función interna', `select public._guardar_pago('${TA}', 'directo')`);
await denied('un usuario identificado tampoco llama a la función interna', `select public._guardar_pago('${TA}', 'directo')`, 'authenticated');
await denied('ni insertar directamente', `insert into public.pagos (user_id, texto) values ('${A}', 'colado')`, 'authenticated');

// cada persona ve y borra solo lo suyo
const asUser = async (uid, q) => { await db.exec(`set role authenticated; select set_config('test.uid','${uid}',false)`); try { return await db.query(q); } finally { await db.exec('reset role'); } };
check('A ve sus avisos y ninguno de B', (await asUser(A, 'select user_id from public.pagos')).rows.every(r => r.user_id === A));
const delB = await asUser(A, `delete from public.pagos where user_id='${B}' returning id`);
check('A no puede borrar los de B', delB.rows.length === 0 && await count(B) === 1);
const mine = (await asUser(A, 'select id from public.pagos limit 1')).rows[0].id;
const del1 = await asUser(A, `delete from public.pagos where id='${mine}' returning id`);
check('A puede borrar uno suyo (así es como «lo reclama» la app)', del1.rows.length === 1);
const del2 = await asUser(A, `delete from public.pagos where id='${mine}' returning id`);
check('y borrarlo otra vez no devuelve nada (otro dispositivo no lo duplica)', del2.rows.length === 0);

// tope de 100
for (let i = 0; i < 130; i++) await asAnon('recibir_pago', [`Pago ${i}`], TA);
check('como mucho 100 avisos por persona', await count(A) === 100);
const last = (await db.query(`select texto from public.pagos where user_id='${A}' order by recibido desc, id limit 1`)).rows[0];
check('y se conservan los más nuevos', (await db.query(`select 1 from public.pagos where user_id='${A}' and texto='Pago 129'`)).rows.length === 1, JSON.stringify(last));
// si se cambia el código, el viejo deja de valer
await db.exec(`update public.ajustes set data = '{"pagosToken":"${'c'.repeat(32)}"}' where user_id='${A}'`);
const before = await count(A); await asAnon('recibir_pago', ['con el código viejo'], TA);
check('al cambiar el código, el anterior deja de funcionar', await count(A) === before);
await asAnon('recibir_pago', ['con el código nuevo'], 'c'.repeat(32));
check('y el nuevo sí', (await db.query(`select 1 from public.pagos where texto='con el código nuevo'`)).rows.length === 1);
console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
