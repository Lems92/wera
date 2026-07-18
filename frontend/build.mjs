// Faux build : copie les fichiers du site statique vers dist/.
// Vercel (préréglage hérité du projet Vite) exécute `npm run build` et sert
// dist/ — on satisfait ce contrat sans bundler.
import { cpSync, mkdirSync, rmSync, readdirSync } from 'node:fs';

const EXCLUDE = new Set([
  'dist', 'node_modules', 'build.mjs', 'package.json', 'package-lock.json',
  'vercel.json', '.env', '.gitignore', 'README.md'
]);

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');

let copied = 0;
for (const entry of readdirSync('.')) {
  if (EXCLUDE.has(entry) || entry.startsWith('.')) continue;
  cpSync(entry, `dist/${entry}`, { recursive: true });
  copied++;
}
console.log(`build statique : ${copied} entrées copiées vers dist/`);
