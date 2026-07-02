/* Assemble le jeu en UN SEUL fichier HTML autonome (Three.js inclus).
   Usage : node tools/build-single.mjs  →  silverstone-1948.html */
import fs from 'fs';
import path from 'path';
import url from 'url';

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const code = fs.readFileSync(path.join(root, src), 'utf8');
  return `<script>\n/* ==== ${src} ==== */\n${code}\n</script>`;
});

const out = path.join(root, 'silverstone-1948.html');
fs.writeFileSync(out, html);
console.log(`Écrit : ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} Ko)`);
