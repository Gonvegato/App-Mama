// Punto de entrada de la app.
import { html, render, useEffect } from '../vendor/preact-htm.js';
import { useStore, boot, state, subscribe } from './lib/store.js';
import { initUsb, scheduleSync } from './lib/usb.js';
import { applyTheme, watchSystemTheme } from './lib/theme.js';
import { useRoute } from './lib/router.js';
import { ModalHost, ToastHost } from './ui/kit.js';
import { Sidebar } from './ui/sidebar.js';
import { Home } from './ui/home.js';
import { TripPage } from './ui/trip.js';
import { Settings } from './ui/settings.js';
import { Setup, Login, Splash, BootError } from './ui/auth.js';
import { cx } from './lib/util.js';

function Shell() {
  const route = useRoute();
  useEffect(() => { if (route.name !== 'trip') document.title = 'Cuaderno de viajes'; }, [route.name]);
  return html`<div class=${cx('shell', `route-${route.name}`)}>
    <${Sidebar} route=${route} />
    <main class="main" id="main">
      ${route.name === 'trip' ? html`<${TripPage} route=${route} key=${route.id} />`
        : route.name === 'settings' ? html`<${Settings} route=${route} />`
        : html`<${Home} />`}
    </main>
  </div>`;
}

function App() {
  const phase = useStore(s => s.phase);
  const prefs = useStore(s => s.prefs);
  useEffect(() => applyTheme(prefs), [prefs.theme, prefs.textSize]);
  return html`
    ${phase === 'boot' ? html`<${Splash} />`
      : phase === 'setup' ? html`<${Setup} />`
      : phase === 'login' ? html`<${Login} />`
      : phase === 'error' ? html`<${BootError} />`
      : html`<${Shell} />`}
    <${ModalHost} />
    <${ToastHost} />`;
}

applyTheme(state.prefs);
watchSystemTheme(() => state.prefs);
render(html`<${App} />`, document.getElementById('app'));
boot().then(() => initUsb()).then(on => {
  if (!on) return;
  // Cada vez que cambian los viajes (archivo nuevo, enlace nuevo…), se copia al USB.
  let last = state.trips;
  subscribe(s => { if (s.trips !== last) { last = s.trips; scheduleSync(6000); } });
});

// Funciona sin conexión y se puede instalar como app (solo en web https).
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
