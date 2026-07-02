/* Validation géométrique du circuit — usage : node tools/validate.mjs */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import url from 'url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const TrackKit = require(path.join(root, 'js', 'trackdata.js'));

const track = TrackKit.buildTrack();
const W = track.width;
let failures = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? '  OK ' : 'ÉCHEC'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

console.log('=== SILVERSTONE 1948 — validation du circuit ===\n');

// 1. Fermeture de la boucle
check(track.closureError < 5, 'Fermeture du polygone (avant correction)', `erreur ${track.closureError.toFixed(2)} m`);
const first = track.samples[0], last = track.samples[track.samples.length - 1];
const gapLoop = Math.hypot(first.x - last.x, first.y - last.y);
check(gapLoop < 6, 'Continuité premier/dernier échantillon', `${gapLoop.toFixed(2)} m`);

// 2. Somme des changements de cap
const sumTurns = track.spec.corners.reduce((a, c) => a + c.turn, 0);
check(Math.abs(sumTurns + 360) < 1e-9, 'Somme des changements de cap = -360°', `${sumTurns}°`);

// 3. Longueur du tour
console.log(`\nLongueur du tour : ${(track.S / 1000).toFixed(3)} km   (échantillons : ${track.samples.length})`);

// 4. Sommets
console.log('\nSommets (x, y) [m] :');
track.spec.corners.forEach((c, i) => {
  const v = track.verts[i];
  console.log(`  ${c.name.padEnd(9)} (${v.x.toFixed(1)}, ${v.y.toFixed(1)})  virage ${c.turn > 0 ? 'gauche' : 'droite'} ${Math.abs(c.turn)}° de cap, R=${(c.r * TrackKit.SCALE).toFixed(1)} m`);
});

// 5. Seagrave / Seaman : jamais se toucher ni se croiser
const b = track.barrier;
console.log(`\nÉcart apex Seagrave ↔ apex Seaman : ${b.gap.toFixed(1)} m`);
check(b.gap > W + 12, 'Écart entre les deux apex suffisant', `${b.gap.toFixed(1)} m > ${W + 12} m`);

const sg = track.cornerMeta[2], sm = track.cornerMeta[7];
let minSgSm = Infinity;
for (let i = sg.entryIdx - 40; i <= sg.exitIdx + 40; i++) {
  const a = track.samples[(i + track.samples.length) % track.samples.length];
  for (let j = sm.entryIdx - 40; j <= sm.exitIdx + 40; j++) {
    const c = track.samples[(j + track.samples.length) % track.samples.length];
    const d = Math.hypot(a.x - c.x, a.y - c.y);
    if (d < minSgSm) minSgSm = d;
  }
}
check(minSgSm > W + 6, 'Rubans Seagrave/Seaman disjoints (marge barrière)', `distance mini ${minSgSm.toFixed(1)} m`);

// 6. Auto-intersection globale : deux points éloignés le long de la piste
//    ne doivent jamais être proches dans le plan.
let minGlobal = Infinity, minPair = null;
const N = track.samples.length;
for (let i = 0; i < N; i++) {
  const a = track.samples[i];
  for (let j = i + 1; j < N; j++) {
    const c = track.samples[j];
    let ds = Math.abs(a.s - c.s);
    ds = Math.min(ds, track.S - ds);
    if (ds < 90) continue;
    const dx = a.x - c.x, dy = a.y - c.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < minGlobal) { minGlobal = d2; minPair = [i, j, ds]; }
  }
}
minGlobal = Math.sqrt(minGlobal);
check(minGlobal > W + 6, 'Aucune auto-intersection du ruban', `distance mini ${minGlobal.toFixed(1)} m (s: ${minPair && minPair[2].toFixed(0)} m d'écart piste)`);

// 7. Points de contrôle : sur la ligne médiane, dans l'ordre, non ambigus
console.log('\nPoints de contrôle (s croissant depuis la ligne d\'arrivée) :');
let prevS = -1, cpOK = true;
track.checkpoints.forEach((cp, i) => {
  const pr = TrackKit.projectToTrack(track, cp.x, cp.y);
  const onCenter = Math.abs(pr.dist) < 0.5;
  if (!(cp.s > prevS)) cpOK = false;
  prevS = cp.s;
  if (!onCenter) cpOK = false;
  console.log(`  CP${i + 1}  ${cp.name.padEnd(9)} s=${cp.s.toFixed(0).padStart(5)} m  écart médiane=${pr.dist.toFixed(2)} m`);
});
check(cpOK, 'CP strictement croissants et sur la ligne médiane');
check(track.checkpoints.length === 10, '10 points de contrôle', `${track.checkpoints.length}`);
const cpNames = track.checkpoints.map(c => c.name).join(' → ');
console.log(`  Ordre : ${cpNames}`);
check(track.checkpoints[0].name === 'Woodcote', 'Premier CP après la ligne = Woodcote', track.checkpoints[0].name);

// 8. Bottes de foin : toutes hors piste
let balesOn = 0, minBaleDist = Infinity;
for (const bale of track.bales) {
  const pr = TrackKit.projectToTrack(track, bale.x, bale.y);
  if (pr.dist < W / 2 + 1.0) balesOn++;
  if (pr.dist < minBaleDist) minBaleDist = pr.dist;
}
check(balesOn === 0, `Bottes de foin toutes hors piste (${track.bales.length} bottes)`, `distance mini au centre ${minBaleDist.toFixed(1)} m (bord piste à ${W / 2} m)`);

// 9. Mur blanc : hors piste, entre les deux virages
for (const wall of track.walls) {
  const p1 = TrackKit.projectToTrack(track, wall.x1, wall.y1);
  const p2 = TrackKit.projectToTrack(track, wall.x2, wall.y2);
  const pm = TrackKit.projectToTrack(track, (wall.x1 + wall.x2) / 2, (wall.y1 + wall.y2) / 2);
  check(Math.min(p1.dist, p2.dist, pm.dist) > W / 2 + 2, 'Mur blanc entièrement hors piste',
    `distances ${p1.dist.toFixed(1)} / ${pm.dist.toFixed(1)} / ${p2.dist.toFixed(1)} m`);
  const dSg = Math.hypot((wall.x1 + wall.x2) / 2 - b.apexSg.x, (wall.y1 + wall.y2) / 2 - b.apexSg.y);
  const dSm = Math.hypot((wall.x1 + wall.x2) / 2 - b.apexSm.x, (wall.y1 + wall.y2) / 2 - b.apexSm.y);
  check(Math.abs(dSg - dSm) < 2, 'Mur centré entre Seagrave et Seaman', `${dSg.toFixed(1)} m / ${dSm.toFixed(1)} m`);
}

// 10. Ligne d'arrivée et départ sur Farm Straight (segment 0, hors virages)
const prF = TrackKit.projectToTrack(track, track.finish.x, track.finish.y);
const prSp = TrackKit.projectToTrack(track, track.spawn.x, track.spawn.y);
check(Math.abs(prF.dist) < 0.3 && Math.abs(prF.s) < 2, 'Ligne d\'arrivée sur la médiane, s=0', `s=${prF.s.toFixed(2)}`);
check(Math.abs(prSp.dist) < 0.3, 'Départ sur la médiane de Farm Straight', `s=${prSp.s.toFixed(1)}`);
const sampF = track.samples[prF.idx];
check(sampF.corner === -1, 'Ligne d\'arrivée sur une portion droite', `corner=${sampF.corner}`);

// 11. Longueurs de segments suffisantes pour les congés
console.log('');
const n = track.spec.corners.length;
for (let i = 0; i < n; i++) {
  const Rprev = track.spec.corners[(i + n - 1) % n];
  const cur = track.spec.corners[i];
  const tPrev = Rprev.r * TrackKit.SCALE * Math.tan(Math.abs(Rprev.turn) * Math.PI / 360);
  const tCur = cur.r * TrackKit.SCALE * Math.tan(Math.abs(cur.turn) * Math.PI / 360);
  const L = track.lengths[i];
  check(L > tPrev + tCur + 5, `Segment ${i} assez long pour ses congés`, `${L.toFixed(0)} m ≥ ${(tPrev + tCur).toFixed(0)} m`);
}

// --- Aperçu SVG ---
const bb = track.bbox, pad = 90;
const sw = bb.maxX - bb.minX + 2 * pad, sh = bb.maxY - bb.minY + 2 * pad;
const X = x => ((x - bb.minX + pad)).toFixed(1);
const Y = y => ((bb.maxY - y + pad)).toFixed(1); // y inversé (SVG vers le bas)
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sw.toFixed(0)} ${sh.toFixed(0)}" style="background:#4e8a3c">\n`;
svg += `<path d="M ${track.samples.map(p => `${X(p.x)} ${Y(p.y)}`).join(' L ')} Z" fill="none" stroke="#3d3f42" stroke-width="${W}" stroke-linejoin="round"/>\n`;
svg += `<path d="M ${track.samples.map(p => `${X(p.x)} ${Y(p.y)}`).join(' L ')} Z" fill="none" stroke="#ffffff" stroke-width="1" stroke-dasharray="6 10" opacity="0.35"/>\n`;
for (const cp of track.checkpoints) svg += `<circle cx="${X(cp.x)}" cy="${Y(cp.y)}" r="${cp.rVisual}" fill="#d02020"/>\n`;
for (const bale of track.bales) svg += `<rect x="${(+X(bale.x) - 0.9).toFixed(1)}" y="${(+Y(bale.y) - 0.5).toFixed(1)}" width="1.8" height="1" fill="#d8b35a" transform="rotate(${(-bale.yaw * 180 / Math.PI).toFixed(0)} ${X(bale.x)} ${Y(bale.y)})"/>\n`;
for (const wall of track.walls) svg += `<line x1="${X(wall.x1)}" y1="${Y(wall.y1)}" x2="${X(wall.x2)}" y2="${Y(wall.y2)}" stroke="#ffffff" stroke-width="2.5"/>\n`;
const f = track.finish, fn = { x: -Math.sin(f.heading), y: Math.cos(f.heading) };
svg += `<line x1="${X(f.x - fn.x * W / 2)}" y1="${Y(f.y - fn.y * W / 2)}" x2="${X(f.x + fn.x * W / 2)}" y2="${Y(f.y + fn.y * W / 2)}" stroke="#fff" stroke-width="4"/>\n`;
track.spec.corners.forEach((c, i) => {
  const v = track.verts[i];
  svg += `<text x="${X(v.x)}" y="${Y(v.y)}" font-size="26" fill="#fff" font-family="sans-serif" text-anchor="middle">${c.name}</text>\n`;
});
svg += `<text x="${X(track.spawn.x)}" y="${+Y(track.spawn.y) + 40}" font-size="24" fill="#ffe" font-family="sans-serif" text-anchor="middle">DÉPART →</text>\n`;
svg += `</svg>\n`;
fs.writeFileSync(path.join(root, 'tools', 'track-preview.svg'), svg);
console.log('\nAperçu écrit : tools/track-preview.svg');

console.log(failures ? `\n*** ${failures} ÉCHEC(S) ***` : '\n*** TOUT EST OK ***');
process.exit(failures ? 1 : 0);
