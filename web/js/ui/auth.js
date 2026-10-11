// Primeros pasos: elegir modo, conectar con Supabase e iniciar sesión.
import { html, useState } from '../../vendor/preact-htm.js';
import { Btn, Icon, Field, Spinner } from './kit.js';
import { startLocal, startCloud, signIn, resetConfig, useStore, bakedConfig } from '../lib/store.js';

function Frame({ children, wide }) {
  return html`<div class="auth">
    <div class=${`auth-card${wide ? ' auth-wide' : ''}`}>
      <div class="auth-brand"><span class="brand-mark"><${Icon} name="compass" size=${22} /></span><span class="brand-name">Cuaderno <em>de viajes</em></span></div>
      ${children}
    </div>
    <div class="auth-art" aria-hidden="true"></div>
  </div>`;
}

export function Splash() {
  return html`<div class="splash"><span class="brand-mark"><${Icon} name="compass" size=${26} /></span><${Spinner} size=${22} /></div>`;
}

export function Setup() {
  const [mode, setMode] = useState(null);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const connect = async e => {
    e.preventDefault();
    setErr('');
    const u = url.trim().replace(/\/+$/, '');
    if (!/^https:\/\/\S+$/i.test(u)) { setErr('La URL del proyecto empieza por https:// y suele terminar en .supabase.co'); return; }
    if (key.trim().length < 20) { setErr('Pega la clave pública completa (publishable o anon).'); return; }
    setBusy(true);
    try { await startCloud(u, key.trim()); } catch (ex) { setErr(ex.message); setBusy(false); }
  };
  if (mode === 'cloud') return html`<${Frame}>
    <h1>Conectar con la nube</h1>
    <p class="muted">Datos del proyecto de Supabase (Panel → Project Settings → API). Solo hace falta una vez por dispositivo.</p>
    <form class="form-grid" onSubmit=${connect}>
      <${Field} label="URL del proyecto"><input class="input" value=${url} onInput=${e => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" autofocus spellcheck="false" /></${Field}>
      <${Field} label="Clave pública (publishable / anon)"><input class="input" value=${key} onInput=${e => setKey(e.target.value)} spellcheck="false" autocomplete="off" /></${Field}>
      ${err && html`<p class="error">${err}</p>`}
      <div class="btn-row"><${Btn} kind="ghost" onClick=${() => setMode(null)}>Atrás</${Btn}><${Btn} kind="primary" type="submit" disabled=${busy}>${busy ? html`<${Spinner} size=${16} />` : 'Continuar'}</${Btn}></div>
    </form>
  </${Frame}>`;
  return html`<${Frame} wide>
    <h1>Bienvenida</h1>
    <p class="muted">Tu cuaderno para organizar viajes: reservas, billetes, mapa, correos, maleta y gastos.</p>
    <div class="choice-grid">
      <button type="button" class="choice" onClick=${() => setMode('cloud')}>
        <${Icon} name="cloud" size=${26} /><b>En el ordenador y en el móvil</b>
        <span>Se guarda en tu cuenta en la nube y se ve en todos tus dispositivos.</span></button>
      <button type="button" class="choice" onClick=${() => { setBusy(true); startLocal(); }}>
        <${Icon} name="database" size=${26} /><b>Solo en este dispositivo</b>
        <span>Para probar sin cuenta. Se puede pasar a la nube más adelante con una copia.</span></button>
    </div>
  </${Frame}>`;
}

export function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [show, setShow] = useState(false);
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await signIn(email.trim(), pw); } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };
  return html`<${Frame}>
    <h1>Hola de nuevo</h1>
    <p class="muted">Entra con tu correo y tu contraseña.</p>
    <form class="form-grid" onSubmit=${submit}>
      <${Field} label="Correo"><input class="input input-lg" type="email" autocomplete="username" value=${email} onInput=${e => setEmail(e.target.value)} autofocus required /></${Field}>
      <${Field} label="Contraseña">
        <div class="pw-row"><input class="input input-lg" type=${show ? 'text' : 'password'} autocomplete="current-password" value=${pw} onInput=${e => setPw(e.target.value)} required />
          <button type="button" class="icon-btn" aria-label=${show ? 'Ocultar contraseña' : 'Ver contraseña'} onClick=${() => setShow(s => !s)}><${Icon} name="eye" size=${18} /></button></div>
      </${Field}>
      ${err && html`<p class="error">${err}</p>`}
      <${Btn} kind="primary" type="submit" class="btn-block btn-lg" disabled=${busy}>${busy ? html`<${Spinner} size=${16} />` : 'Entrar'}</${Btn}>
    </form>
    ${!bakedConfig() && html`<p class="small center"><button type="button" class="link-btn" onClick=${resetConfig}>Cambiar de proyecto</button></p>`}
  </${Frame}>`;
}

export function BootError() {
  const err = useStore(s => s.error);
  return html`<${Frame}>
    <h1>No se ha podido abrir</h1>
    <p class="error">${err}</p>
    <p class="muted small">Comprueba la conexión a internet. Si el proyecto de Supabase está en pausa (en el plan gratuito pasa tras 7 días sin uso), hay que reactivarlo desde el panel de Supabase con «Restore project».</p>
    <div class="btn-row"><${Btn} kind="primary" icon="refresh" onClick=${() => location.reload()}>Reintentar</${Btn}>
      ${!bakedConfig() && html`<${Btn} kind="ghost" onClick=${resetConfig}>Cambiar configuración</${Btn}>`}</div>
  </${Frame}>`;
}
