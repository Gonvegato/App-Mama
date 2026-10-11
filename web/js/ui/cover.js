// Portadas de los viajes: foto propia o un degradado elegante.
import { html, useFileUrl } from './kit.js';
import { COVER_PRESETS } from '../lib/model.js';
import { cx, hashHue } from '../lib/util.js';

export function presetById(id) { return COVER_PRESETS.find(p => p.id === id) || COVER_PRESETS[0]; }

export function coverStyle(cover, url, seed) {
  if (cover?.type === 'image' && url) {
    const y = cover.focusY ?? 50;
    return `background-image:url("${url}");background-position:50% ${y}%;background-size:cover;`;
  }
  if (cover?.type === 'image') return `background:hsl(${hashHue(seed)} 18% 70%);`;
  const p = presetById(cover?.id);
  return `background:linear-gradient(135deg, ${p.a} 0%, ${p.b} 100%);`;
}

export function Cover({ trip, class: cls, children, pattern = true }) {
  const url = useFileUrl(trip.cover?.type === 'image' ? trip.cover.path : null);
  const isImg = trip.cover?.type === 'image';
  return html`<div class=${cx('cover', isImg ? 'cover-img' : 'cover-preset', pattern && !isImg && 'cover-pattern', cls)} style=${coverStyle(trip.cover, url, trip.id)}>${children}</div>`;
}
