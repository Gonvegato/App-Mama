// Temas y tamaño de letra.
export const THEMES = {
  papel:  { label: 'Papel',   dark: false, bg: '#f6f2ea', ink: '#2a2620', accent: '#8a5a3c' },
  salvia: { label: 'Salvia',  dark: false, bg: '#eef1ea', ink: '#26302a', accent: '#55704f' },
  mar:    { label: 'Mar',     dark: false, bg: '#edf1f3', ink: '#1f2a33', accent: '#3d6680' },
  rosa:   { label: 'Rosa antiguo', dark: false, bg: '#f5efee', ink: '#30262a', accent: '#9a5a66' },
  noche:  { label: 'Noche',   dark: true,  bg: '#17181b', ink: '#ece6dc', accent: '#d2a86e' },
  tinta:  { label: 'Tinta',   dark: true,  bg: '#121a24', ink: '#e5ebf1', accent: '#8fb5d6' },
};

export const TEXT_SIZES = { normal: 'Normal', grande: 'Grande', enorme: 'Muy grande' };

const mq = matchMedia('(prefers-color-scheme: dark)');

export function resolveTheme(pref) {
  if (pref && THEMES[pref]) return pref;
  return mq.matches ? 'noche' : 'papel';
}

export function applyTheme(prefs) {
  const id = resolveTheme(prefs.theme);
  const root = document.documentElement;
  root.dataset.theme = id;
  root.dataset.dark = THEMES[id].dark ? '1' : '';
  root.dataset.size = prefs.textSize || 'normal';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEMES[id].bg;
  root.style.colorScheme = THEMES[id].dark ? 'dark' : 'light';
}

export function watchSystemTheme(getPrefs) {
  mq.addEventListener('change', () => applyTheme(getPrefs()));
}
