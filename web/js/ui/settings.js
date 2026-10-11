// Ajustes: apariencia, cuenta, Gmail, móvil y copias de seguridad.
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { Btn, Icon, IconBtn, Field, Segmented, confirm, pickFiles, Spinner, copyText, Select } from './kit.js';
import { THEMES, TEXT_SIZES } from '../lib/theme.js';
import { MAP_STYLES } from '../lib/leaflet-loader.js';
import { useStore, setPrefs, saveSettings, signOut, resetConfig, refresh, exportAll, importTrip, toast, state, getBackend } from '../lib/store.js';
import { gmailPing } from '../lib/gmail.js';
import { downloadBlob, cx, fmtSize, todayISO } from '../lib/util.js';
import qrcode from '../../vendor/qrcode.mjs';
import { go } from '../lib/router.js';

const APP_VERSION = '1.0.0';

function Section({ id, icon, title, children, intro }) {
  return html`<section class="set-section card" id=${`ajustes-${id}`}>
    <h2><${Icon} name=${icon} size=${20} /> ${title}</h2>
    ${intro && html`<p class="muted">${intro}</p>`}
    ${children}
  </section>`;
}

function webUrl() {
  const baked = window.APP_CONFIG?.webUrl;
  if (/^https:/.test(location.protocol) && !/localhost|127\.0\.0\.1/.test(location.hostname)) return location.origin + location.pathname;
  return baked || '';
}

function QR({ text }) {
  if (!text) return null;
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return html`<div class="qr" dangerouslySetInnerHTML=${{ __html: qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) }}></div>`;
}

function Gmail() {
  const settings = useStore(s => s.settings);
  const [url, setUrl] = useState(settings.gmail?.url || '');
  const [key, setKey] = useState(settings.gmail?.key || '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(settings.gmail?.email ? { ok: true, email: settings.gmail.email } : null);
  useEffect(() => { setUrl(settings.gmail?.url || ''); setKey(settings.gmail?.key || ''); }, [settings.gmail?.url, settings.gmail?.key]);
  const test = async () => {
    const cfg = { url: url.trim(), key: key.trim() };
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(cfg.url)) { setStatus({ ok: false, msg: 'La URL debe ser la de la implementación: https://script.google.com/macros/s/…/exec' }); return; }
    setBusy(true);
    try {
      const r = await gmailPing(cfg);
      await saveSettings({ gmail: { ...cfg, email: r.email } });
      setStatus({ ok: true, email: r.email });
      toast('Gmail conectado', 'ok');
    } catch (e) { setStatus({ ok: false, msg: e.message }); }
    setBusy(false);
  };
  return html`<${Section} id="correo" icon="mail" title="Correo (Gmail)"
    intro="Con esto la app puede buscar en Gmail los correos de cada viaje y guardarlos con sus adjuntos. Solo lee: no envía ni borra nada.">
    ${status?.ok && html`<p class="status-ok"><${Icon} name="check-circle" size=${18} /> Conectado con <b>${status.email}</b></p>`}
    ${status && !status.ok && html`<p class="error">${status.msg}</p>`}
    <div class="form-grid">
      <${Field} label="URL del ayudante" hint="La que te dio Google Apps Script al implementar (termina en /exec)."><input class="input" value=${url} onInput=${e => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" spellcheck="false" /></${Field}>
      <${Field} label="Clave secreta" hint="La misma frase que escribiste en el script."><input class="input" type="password" value=${key} onInput=${e => setKey(e.target.value)} autocomplete="off" /></${Field}>
    </div>
    <div class="btn-row">
      <${Btn} kind="primary" icon=${busy ? undefined : 'check'} onClick=${test} disabled=${busy || !url || !key}>${busy ? html`<${Spinner} size=${16} /> Comprobando…` : 'Guardar y probar'}</${Btn}>
      ${settings.gmail && html`<${Btn} kind="ghost" onClick=${async () => { if (await confirm('¿Desconectar Gmail?', 'Los correos ya guardados en los viajes se conservan.', { okLabel: 'Desconectar' })) { await saveSettings({ gmail: null }); setStatus(null); setUrl(''); setKey(''); } }}>Desconectar</${Btn}>`}
    </div>
    <details class="howto"><summary>Cómo se instala el ayudante (una sola vez, unos 5 minutos)</summary>
      <ol>
        <li>Con la cuenta de Gmail de los viajes, entra en <a href="https://script.google.com" target="_blank" rel="noopener">script.google.com</a> y pulsa <b>Nuevo proyecto</b>.</li>
        <li>Borra lo que haya y pega el contenido del archivo <code>backend/gmail-ayudante.gs</code> del proyecto. Cambia la línea <code>CLAVE</code> por una frase secreta tuya.</li>
        <li>Guarda. Arriba elige la función <b>probar</b> y pulsa <b>Ejecutar</b>. Acepta los permisos (si aparece «Google no ha verificado esta aplicación»: <i>Configuración avanzada → Ir a…</i>; es tu propio script).</li>
        <li><b>Implementar → Nueva implementación →</b> tipo <b>Aplicación web</b>. Ejecutar como: <b>Yo</b>. Quién tiene acceso: <b>Cualquier usuario</b>. Pulsa Implementar y copia la URL.</li>
        <li>Pega aquí la URL y la clave, y pulsa <b>Guardar y probar</b>. Desde ese momento funciona también en el móvil.</li>
      </ol>
    </details>
  </${Section}>`;
}

function Backup() {
  const trips = useStore(s => s.trips);
  const imp = async () => {
    const [f] = await pickFiles({ accept: '.json,application/json', multiple: false });
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = data.trips || (Array.isArray(data) ? data : [data]);
      if (!list.length || !list[0] || typeof list[0] !== 'object') throw new Error('El archivo no contiene viajes');
      if (!await confirm('Importar viajes', `Se añadirán ${list.length} viaje(s) como copias nuevas. Los archivos adjuntos no van incluidos en las copias.`, { okLabel: 'Importar' })) return;
      for (const t of list) await importTrip(t);
      toast(`${list.length} viaje(s) importado(s)`, 'ok');
    } catch (e) { toast(`No se pudo importar: ${e.message}`, 'error'); }
  };
  return html`<${Section} id="copia" icon="download" title="Copia de seguridad"
    intro="Descarga todos los viajes en un archivo (fechas, reservas, lugares, notas, maleta y gastos). Los documentos y correos guardados no van dentro del archivo: siguen en la nube.">
    <div class="btn-row">
      <${Btn} icon="download" onClick=${() => downloadBlob(new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' }), `cuaderno-de-viajes-${todayISO()}.json`)} disabled=${!trips.length}>Descargar copia (${trips.length} viajes)</${Btn}>
      <${Btn} icon="upload" onClick=${imp}>Importar copia</${Btn}>
    </div>
  </${Section}>`;
}

export function Settings({ route }) {
  const s = useStore();
  const prefs = s.prefs;
  const [usage, setUsage] = useState(null);
  useEffect(() => { getBackend()?.usage?.().then(setUsage).catch(() => {}); }, []);
  useEffect(() => {
    if (route.section) setTimeout(() => document.getElementById(`ajustes-${route.section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }, [route.section]);
  const url = webUrl();
  const inApp = !!window.cuaderno?.desktop;

  return html`<div class="page settings">
    <header class="page-head">
      <a class="hero-back only-mobile plain" href="#/" aria-label="Volver"><${Icon} name="back" size=${20} /></a>
      <h1>Ajustes</h1>
    </header>

    <${Section} id="apariencia" icon="sun" title="Apariencia">
      <span class="field-label">Tema</span>
      <div class="theme-grid">
        <button type="button" class=${cx('theme-card', 'theme-auto', prefs.theme === 'auto' && 'is-active')} onClick=${() => setPrefs({ theme: 'auto' })}>
          <span class="theme-sw"><i style="background:#f6f2ea"></i><i style="background:#17181b"></i></span><b>Automático</b><small>Claro de día, oscuro de noche</small></button>
        ${Object.entries(THEMES).map(([k, t]) => html`<button type="button" class=${cx('theme-card', prefs.theme === k && 'is-active')} onClick=${() => setPrefs({ theme: k })}>
          <span class="theme-sw" style=${`background:${t.bg}`}><span style=${`color:${t.ink};font-family:var(--serif)`}>Aa</span><i class="dot" style=${`background:${t.accent}`}></i></span><b>${t.label}</b></button>`)}
      </div>
      <div class="field-row">
        <div class="field"><span class="field-label">Tamaño de la letra</span>
          <${Segmented} value=${prefs.textSize || 'normal'} onChange=${v => setPrefs({ textSize: v })} options=${Object.entries(TEXT_SIZES).map(([value, label]) => ({ value, label }))} /></div>
        <div class="field"><span class="field-label">Estilo del mapa</span>
          <${Select} class="input" value=${prefs.mapStyle || 'auto'} onChange=${e => setPrefs({ mapStyle: e.target.value })}>
            <option value="auto">Automático (según el tema)</option>${Object.entries(MAP_STYLES).map(([k, v]) => html`<option value=${k}>${v.label}</option>`)}</${Select}></div>
      </div>
      <p class="muted small">La apariencia se guarda en cada dispositivo por separado.</p>
    </${Section}>

    <${Section} id="cuenta" icon="cloud" title="Cuenta y sincronización">
      ${s.mode === 'cloud' ? html`
        <p>Conectada como <b>${s.user?.email}</b>. Todo lo que hagas se guarda en la nube y aparece en el ordenador y en el móvil.</p>
        <p class="muted small">${s.pending ? `Hay ${s.pending} cambio(s) esperando conexión.` : s.lastSync ? `Última sincronización: ${new Date(s.lastSync).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</p>
        <div class="btn-row">
          <${Btn} icon="refresh" onClick=${() => refresh().then(() => toast('Sincronizado', 'ok'))}>Sincronizar ahora</${Btn}>
          <${Btn} kind="ghost" icon="log-out" onClick=${async () => { if (await confirm('¿Cerrar sesión?', 'Para volver a entrar necesitarás el correo y la contraseña.', { okLabel: 'Cerrar sesión' })) signOut(); }}>Cerrar sesión</${Btn}>
        </div>` : html`
        <p>Modo <b>solo este dispositivo</b>: los viajes se guardan en este ${inApp ? 'ordenador' : 'navegador'} y no se ven en otros.</p>
        ${usage?.used ? html`<p class="muted small">Espacio usado: ${fmtSize(usage.used)}</p>` : ''}
        <div class="btn-row"><${Btn} icon="cloud" onClick=${async () => { if (await confirm('Conectar con la nube', 'Volverás a la pantalla de inicio para conectar con tu cuenta. Antes, descarga una copia de seguridad para pasar tus viajes (se puede importar después).', { okLabel: 'Continuar' })) resetConfig(); }}>Conectar con la nube</${Btn}></div>`}
    </${Section}>

    <${Gmail} />

    <${Section} id="movil" icon="compass" title="Usarla en el móvil"
      intro=${url ? 'Abre esta dirección en el móvil (o escanea el código con la cámara) y entra con el mismo correo y contraseña.' : 'Cuando la web esté publicada, aquí aparecerá su dirección y un código para abrirla con la cámara del móvil.'}>
      ${url && html`<div class="mobile-box">
        <${QR} text=${url} />
        <div>
          <p class="url-line"><a href=${url} target="_blank" rel="noopener">${url}</a> <${IconBtn} icon="copy" label="Copiar dirección" onClick=${() => copyText(url).then(() => toast('Dirección copiada', 'ok'))} /></p>
          <p><b>iPhone:</b> ábrela con Safari → botón <b>Compartir</b> <span class="kbd">⬆</span> → <b>Añadir a pantalla de inicio</b>.</p>
          <p><b>Android:</b> ábrela con Chrome → menú <span class="kbd">⋮</span> → <b>Añadir a pantalla de inicio</b> o <b>Instalar aplicación</b>.</p>
          <p class="muted small">Quedará un icono como el de cualquier aplicación.</p>
        </div>
      </div>`}
    </${Section}>

    <${Backup} />

    <${Section} id="acerca" icon="info" title="Acerca de">
      <p>Cuaderno de viajes · versión ${APP_VERSION}${inApp ? ' · aplicación de escritorio' : ''}</p>
      <p class="muted small">Mapas © colaboradores de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> y <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> · Búsqueda de lugares: Nominatim y Photon (OpenStreetMap) · El tiempo: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> · Aeropuertos: <a href="https://ourairports.com/data/" target="_blank" rel="noopener">OurAirports</a> · Iconos: <a href="https://lucide.dev" target="_blank" rel="noopener">Lucide</a> · Letra: Newsreader.</p>
      ${s.mode && html`<p><button type="button" class="link-btn small" onClick=${async () => { if (await confirm('Cambiar la configuración', s.mode === 'cloud' ? 'Se cerrará la sesión y volverás a la pantalla de configuración. Tus datos siguen en la nube.' : 'Volverás a la pantalla de configuración. Los viajes de este dispositivo no se borran.', { okLabel: 'Continuar' })) resetConfig(); }}>Cambiar la configuración de conexión</button></p>`}
    </${Section}>
  </div>`;
}
