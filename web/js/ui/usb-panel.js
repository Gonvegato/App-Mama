// Ajustes y estado del modo USB (solo cuando el programa se abre desde un USB).
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { Btn, Icon, Progress, Spinner } from './kit.js';
import { usbState, onUsb, syncUsb, openUsbFolder, usbTotals } from '../lib/usb.js';
import { fmtSize } from '../lib/util.js';

export function useUsbState() {
  const [, force] = useState(0);
  useEffect(() => onUsb(() => force(n => n + 1)), []);
  return usbState;
}

export function UsbSection() {
  const u = useUsbState();
  if (!u.enabled) return null;
  const t = usbTotals();
  const free = u.info?.free, total = u.info?.total;
  return html`<section class="set-section card" id="ajustes-usb">
    <h2><${Icon} name="hard-drive" size=${20} /> Copia en el USB</h2>
    <p class="muted">El programa se está usando desde un USB. Todos los archivos de los viajes (los subidos y los que están en enlaces, como guías y PDF) se copian solos a la carpeta <b>«Archivos de viajes»</b> del USB, ordenados por viaje. Así se abren desde aquí, rápido y aunque no haya internet. El original sigue en la nube o en el enlace, y en el móvil todo funciona igual.</p>
    ${u.info?.detached && html`<p class="muted small"><${Icon} name="info" size=${15} /> El programa se está abriendo desde una copia en el disco de este ordenador, pero la sesión y los archivos se guardan en el USB. En este ordenador no queda nada.</p>`}
    ${u.running ? html`<div class="usb-progress"><${Spinner} size=${16} /> Copiando ${Math.min(u.done + 1, u.total)} de ${u.total}${u.current ? html`: <i>${u.current}</i>` : ''}<${Progress} value=${u.done} max=${u.total || 1} label="Copia al USB" /></div>`
      : html`<p><b>${t.count}</b> ${t.count === 1 ? 'archivo' : 'archivos'} en el USB · ${fmtSize(t.bytes)}${free != null ? html` · <span class="muted">quedan ${fmtSize(free)} libres de ${fmtSize(total)}</span>` : ''}</p>
        ${u.errors > 0 && html`<p class="muted small">${u.errors} ${u.errors === 1 ? 'archivo no se ha podido copiar' : 'archivos no se han podido copiar'} (por ejemplo, enlaces que ya no funcionan). Se volverá a intentar más tarde.</p>`}`}
    ${free != null && free < 500 * 1024 * 1024 && html`<p class="usage-warn"><${Icon} name="alert" size=${16} /> Queda poco espacio en el USB.</p>`}
    <div class="btn-row">
      <${Btn} icon="folder" onClick=${() => openUsbFolder()}>Abrir la carpeta</${Btn}>
      <${Btn} kind="ghost" icon="refresh" disabled=${u.running || !navigator.onLine} onClick=${() => syncUsb()}>Copiar ahora</${Btn}>
    </div>
    <p class="muted small">El original está en la nube: si el USB se pierde no se pierde nada. Pero quien lo encuentre podría ver estos archivos y entrar en la cuenta; en ese caso, desde el móvil, usa «Cerrar la sesión en todos los demás dispositivos» (en Cuenta) y cambia la contraseña.</p>
  </section>`;
}

// Indicador pequeño en la barra lateral mientras se copia.
export function UsbBadge() {
  const u = useUsbState();
  if (!u.enabled) return null;
  return html`<a class="sync usb-badge" href="#/ajustes/usb" title="Copia de los archivos en el USB">
    <${Icon} name="hard-drive" size=${15} class=${u.running ? 'pulse' : ''} /><span>${u.running ? `USB ${Math.min(u.done + 1, u.total)}/${u.total}` : 'USB'}</span></a>`;
}
