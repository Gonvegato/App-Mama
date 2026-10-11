// Escribe web/config.js con las variables del repositorio (lo usan los flujos de GitHub Actions).
import { writeFileSync } from 'node:fs';

const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = (process.env.SUPABASE_KEY || '').trim();
let web = (process.env.WEB_URL || '').trim();
if (!web && process.env.GITHUB_REPOSITORY) {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  web = `https://${owner.toLowerCase()}.github.io/${repo}/`;
}
const q = s => JSON.stringify(s).replace(/"/g, "'");
const out = `// Generado automáticamente por GitHub Actions. No editar a mano.
window.APP_CONFIG = {
  supabaseUrl: ${q(url)},
  supabaseKey: ${q(key)},
  webUrl: ${q(web)},
};
`;
writeFileSync(new URL('../web/config.js', import.meta.url), out);
console.log(`config.js escrito (Supabase: ${url ? 'sí' : 'no'}, web: ${web || '—'})`);
