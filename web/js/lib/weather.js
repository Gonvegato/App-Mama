// Previsión del tiempo con Open-Meteo (gratis, sin clave, hasta 16 días vista).
import { todayISO, addDays } from './util.js';

const CODES = [
  [[0], 'Despejado', 'sun'],
  [[1, 2], 'Poco nuboso', 'cloud-sun'],
  [[3], 'Nublado', 'cloudy'],
  [[45, 48], 'Niebla', 'cloud-fog'],
  [[51, 53, 55, 56, 57], 'Llovizna', 'cloud-rain'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'Lluvia', 'cloud-rain'],
  [[71, 73, 75, 77, 85, 86], 'Nieve', 'snow'],
  [[95, 96, 99], 'Tormenta', 'cloud-lightning'],
];
export function describe(code) {
  for (const [list, label, icon] of CODES) if (list.includes(code)) return { label, icon };
  return { label: '—', icon: 'cloud' };
}

const memo = new Map();
export async function forecast(lat, lng, start, end) {
  const today = todayISO();
  const maxDay = addDays(today, 15);
  const from = start < today ? today : start;
  const to = (end || start) > maxDay ? maxDay : (end || start);
  if (!lat || !lng || from > to) return null;
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${from},${to}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < 30 * 60 * 1000) return hit.data;
  const p = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lng.toFixed(4),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto', start_date: from, end_date: to,
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
  if (!r.ok) return null;
  const j = await r.json();
  const d = j.daily;
  if (!d?.time) return null;
  const data = d.time.map((day, i) => ({
    day, code: d.weather_code[i], max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]),
    rain: d.precipitation_probability_max?.[i] ?? null, ...describe(d.weather_code[i]),
  }));
  memo.set(key, { t: Date.now(), data });
  return data;
}
