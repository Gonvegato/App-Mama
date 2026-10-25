// Ajustes → Pagos automáticos: activar el buzón, copiar los datos al móvil y ver lo recibido.
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { Btn, Icon, Segmented, Spinner, copyText, confirm } from './kit.js';
import { useStore, toast } from '../lib/store.js';
import { enablePayments, disablePayments, paymentsSetup, getPaymentLog, onPaymentsChange, undoPayment, sendTestPayment } from '../lib/payments.js';
import { fmtMoney, cx } from '../lib/util.js';

const when = iso => new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

function Copy({ label, value, multiline }) {
  return html`<div class="pay-copy"><span class="pay-label">${label}</span>
    <div class="pay-val"><${multiline ? 'pre' : 'code'}>${value}</${multiline ? 'pre' : 'code'}>
      <${Btn} size="sm" icon="copy" onClick=${() => copyText(value).then(() => toast('Copiado', 'ok'))}>Copiar</${Btn}></div></div>`;
}

const ESTADO = {
  'añadido': { icon: 'check-circle', cls: 'ok', text: e => `Apuntado: ${e.comercio} · ${fmtMoney(e.importe, e.moneda)}` },
  'repetido': { icon: 'copy', cls: '', text: e => `Ya estaba apuntado: ${e.comercio} · ${fmtMoney(e.importe, 'EUR')}` },
  'sin-viaje': { icon: 'calendar', cls: '', text: e => `Fuera de un viaje, no apuntado${e.importe ? `: ${e.comercio || 'pago'} · ${fmtMoney(e.importe, e.moneda || 'EUR')}` : ''}` },
  'sin-leer': { icon: 'alert', cls: 'warn', text: e => `No he sabido leerlo (${e.motivo})` },
  'ignorado': { icon: 'info', cls: '', text: e => `Ignorado: ${e.motivo}` },
  'prueba': { icon: 'check-circle', cls: 'ok', text: e => (e.importe ? `Aviso de prueba entendido: ${e.comercio || 'pago'} · ${fmtMoney(e.importe, e.moneda || 'EUR')} (no se apunta como gasto)` : `Aviso de prueba recibido, pero no se entiende (${e.motivo})`) },
  'deshecho': { icon: 'x', cls: '', text: e => `Deshecho: ${e.comercio}` },
};

export function PaymentsPanel() {
  const mode = useStore(s => s.mode);
  const token = useStore(s => s.settings.pagosToken);
  const [tab, setTab] = useState('tasker');
  const [log, setLog] = useState(getPaymentLog);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => onPaymentsChange(() => setLog(getPaymentLog())), []);

  if (mode !== 'cloud') return html`<p class="muted">Los pagos automáticos necesitan la cuenta en la nube (Ajustes → Cuenta), porque los avisos pasan por ella.</p>`;
  if (!token) return html`<div>
    <p>La app no puede leer por sí sola las notificaciones del móvil: los navegadores y las apps web no tienen permiso para ello. Lo que sí se puede es que una app de automatización del móvil <b>reenvíe el texto de los avisos de pago</b> (solo los del banco o de la cartera que elijas) a tu cuenta. La app los lee, y si estás de viaje en ese momento, apunta el gasto sola.</p>
    <ul class="small muted"><li>Necesita una app extra en el móvil: Tasker o MacroDroid (Android) o los Atajos (iPhone).</li>
      <li>Hay que ejecutar una vez más el script <code>backend/supabase.sql</code> en Supabase (crea el buzón).</li>
      <li>El texto del aviso se guarda en tu cuenta solo hasta que la app lo lee, y luego se borra.</li></ul>
    <div class="btn-row"><${Btn} kind="primary" icon="wallet" onClick=${enablePayments}>Activar pagos automáticos</${Btn}></div></div>`;

  const s = paymentsSetup();
  const test = async () => {
    setBusy(true); setResult(null);
    try { setResult({ ok: true, e: await sendTestPayment() }); }
    catch (e) { setResult({ ok: false, msg: e.message }); }
    setBusy(false);
  };
  return html`<div class="pay-panel">
    <p>Activado. Falta configurar el móvil una vez. Cuando esté, pulsa <b>«Probar»</b>: manda un aviso de prueba por el mismo camino y comprueba que llega.</p>
    <div class="btn-row">
      <${Btn} kind="primary" icon=${busy ? undefined : 'check'} onClick=${test} disabled=${busy}>${busy ? html`<${Spinner} size=${15} /> Probando…` : 'Probar'}</${Btn}>
    </div>
    ${result && html`<p class=${cx('notice', result.ok ? '' : 'notice-warn')}><${Icon} name=${result.ok ? 'check-circle' : 'alert'} size=${16} />
      <span>${result.ok ? `Funciona. ${ESTADO[result.e.estado]?.text(result.e) || result.e.estado}.` : result.msg}</span></p>`}

    <div class="field"><span class="field-label">Tu móvil</span>
      <${Segmented} value=${tab} onChange=${setTab} options=${[{ value: 'tasker', label: 'Android · Tasker' }, { value: 'macrodroid', label: 'Android · MacroDroid' }, { value: 'ios', label: 'iPhone · Atajos' }]} /></div>

    ${tab !== 'ios' ? html`
      <ol class="pay-steps">
        <li>${tab === 'tasker' ? html`En Tasker crea un <b>perfil</b> con el evento <b>UI → Notificación</b> y en «Propietario» elige <b>solo la app del banco o de la cartera</b>.` : html`En MacroDroid crea una macro con el disparador <b>Notificación recibida</b> y elige <b>solo la app del banco o de la cartera</b>.`}</li>
        <li>${tab === 'tasker' ? html`En su tarea añade la acción <b>Net → HTTP Request</b>.` : html`Como acción, añade <b>Conexión HTTP</b> (petición HTTP).`}</li>
        <li>Método <b>POST</b> y esta dirección:</li>
      </ol>
      <${Copy} label="Dirección" value=${s.urlText} />
      <${Copy} label=${tab === 'tasker' ? 'Cabeceras (una por línea)' : 'Cabeceras'} value=${s.headersText.join('\n')} multiline />
      <ol class="pay-steps" start="4"><li>${tab === 'tasker'
        ? html`<b>Cuerpo</b>: el título y el texto de la notificación, separados por una barra. En Tasker son las variables <code>%evtprm2</code> (título) y <code>%evtprm3</code> (texto), según su guía:`
        : html`<b>Cuerpo</b>: el título y el texto de la notificación, separados por una barra. Usa el botón de variables <code>{…}</code> del propio campo y elige el título y el texto de la notificación (no he podido comprobar cómo se llaman en MacroDroid):`}</li></ol>
      ${tab === 'tasker' && html`<${Copy} label="Cuerpo" value="%evtprm2 | %evtprm3" />`}
      <p class="small muted">Si no te llega, mira cómo se llaman las variables en tu versión de ${tab === 'tasker' ? 'Tasker' : 'MacroDroid'}. El cuerpo se manda tal cual, sin comillas ni formato.</p>`
    : html`
      <ol class="pay-steps">
        <li>En <b>Atajos → Automatización → Nueva</b> elige <b>Cartera</b> (disparador «Transacción», iOS 17 o posterior), con las tarjetas que quieras, y <b>Ejecutar inmediatamente</b>.</li>
        <li>Añade la acción <b>Obtener contenido de URL</b>, método <b>POST</b>, con esta dirección:</li>
      </ol>
      <${Copy} label="Dirección" value=${s.urlJson} />
      <${Copy} label="Cabeceras" value=${s.headersJson.join('\n')} multiline />
      <ol class="pay-steps" start="3"><li>Cuerpo de la petición: <b>JSON</b>, con un campo <code>texto</code> que contenga, por ejemplo, <i>«Pago de [Importe] en [Comercio]»</i>, usando las variables de la transacción.</li></ol>
      <p class="small muted">Ojo: en los foros de Apple se cuenta que este disparador a veces tarda, se agota o entrega el comercio y el importe vacíos. Si pasa, la app lo deja como «no he sabido leerlo». No lo he podido probar en un iPhone.</p>`}

    <h3 class="section-title">Últimos avisos</h3>
    ${!log.length ? html`<p class="muted small">Todavía no ha llegado ningún aviso.</p>` : html`<ul class="pay-log">${log.slice(0, 10).map(e => {
      const st = ESTADO[e.estado] || ESTADO['ignorado'];
      return html`<li class=${st.cls}><${Icon} name=${st.icon} size=${16} />
        <span class="pay-log-text"><b>${st.text(e)}</b><small>${when(e.at)} · «${e.texto}»</small></span>
        ${e.estado === 'añadido' && html`<button type="button" class="link-btn small" onClick=${() => undoPayment(e.tripId, e.expenseId)}>Deshacer</button>`}</li>`;
    })}</ul>`}

    <p class="small muted">Se apunta solo lo que parece un pago y llega durante las fechas de un viaje. Con varios viajeros, el gasto queda sin asignar a nadie hasta que indiques quién pagó.</p>
    <div class="btn-row">
      <${Btn} size="sm" icon="refresh" onClick=${async () => { if (await confirm('¿Cambiar el código?', 'El anterior dejará de valer y tendrás que ponerlo de nuevo en el móvil.', { okLabel: 'Cambiar' })) { await disablePayments(); await enablePayments(); toast('Código cambiado. Actualiza el móvil.', 'ok'); } }}>Cambiar el código</${Btn}>
      <${Btn} size="sm" kind="ghost" icon="x" onClick=${async () => { if (await confirm('¿Desactivar los pagos automáticos?', 'Se borra el código: el móvil dejará de poder mandar avisos.', { okLabel: 'Desactivar', danger: true })) { await disablePayments(); setResult(null); } }}>Desactivar</${Btn}>
    </div>
  </div>`;
}
