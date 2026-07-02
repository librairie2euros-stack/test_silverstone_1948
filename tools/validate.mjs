/* Validation géométrique des circuits — usage : node tools/validate.mjs */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import url from 'url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const TrackKit = require(path.join(root, 'js', 'trackdata.js'));

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? '  OK ' : 'ÉCHEC'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

function validateTrack(id, expect) {
  const track = TrackKit.buildTrack(id);
  const W = track.width;
  console.log(`\n════════ ${track.name} ════════\n`);

  // 1. Fermeture
  check(track.closureError < 5, 'Fermeture du polygone (avant correction)', `erreur ${track.closureError.toFixed(2)} m`);
  const first = track.samples[0], last = track.samples[track.samples.length - 1];
  const gapLoop = Math.hypot(first.x - last.x, first.y - last.y);
  check(gapLoop < 6, 'Continuité premier/dernier échantillon', `${gapLoop.toFixed(2)} m`);

  // 2. Somme des caps
  const sumTurns = track.spec.corners.reduce((a, c) => a + c.turn, 0);
  check(Math.abs(sumTurns + 360) < 1e-9, 'Somme des changements de cap = -360°', `${sumTurns}°`);

  console.log(`\nLongueur du tour : ${(track.S / 1000).toFixed(3)} km   (échantillons : ${track.samples.length})`);
  console.log('Sommets :');
  track.spec.corners.forEach((c, i) => {
    const v = track.verts[i];
    console.log(`  ${c.name.padEnd(9)} (${v.x.toFixed(1)}, ${v.y.toFixed(1)})  ${c.turn > 0 ? 'gauche' : 'droite'} ${Math.abs(c.turn)}° de cap, R=${(c.r * TrackKit.SCALE).toFixed(1)} m`);
  });

  // 3. Virages attendus
  check(track.checkpoints.length === expect.cpCount, `${expect.cpCount} points de contrôle`, `${track.checkpoints.length}`);
  const names = track.checkpoints.map(c => c.name);
  check(JSON.stringify(names) === JSON.stringify(expect.cpOrder), 'Ordre des virages conforme', names.join(' → '));

  // 4. CP sur la médiane, croissants
  let prevS = -1, cpOK = true;
  for (const cp of track.checkpoints) {
    const pr = TrackKit.projectToTrack(track, cp.x, cp.y);
    if (Math.abs(pr.dist) > 0.5 || cp.s <= prevS) cpOK = false;
    prevS = cp.s;
  }
  check(cpOK, 'CP strictement croissants et sur la ligne médiane');

  // 5. Auto-intersection
  let minGlobal = Infinity;
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
      if (d2 < minGlobal) minGlobal = d2;
    }
  }
  minGlobal = Math.sqrt(minGlobal);
  check(minGlobal > W + 6, 'Aucune auto-intersection du ruban', `distance mini ${minGlobal.toFixed(1)} m`);

  // 6. Bottes hors piste
  let balesOn = 0, minBaleDist = Infinity;
  for (const bale of track.bales) {
    const pr = TrackKit.projectToTrack(track, bale.x, bale.y);
    if (pr.dist < W / 2 + 1.0) balesOn++;
    if (pr.dist < minBaleDist) minBaleDist = pr.dist;
  }
  check(balesOn === 0, `Bottes de foin toutes hors piste (${track.bales.length})`, `distance mini ${minBaleDist.toFixed(1)} m`);

  // 7. Départ / arrivée sur Farm Straight
  const prF = TrackKit.projectToTrack(track, track.finish.x, track.finish.y);
  const prSp = TrackKit.projectToTrack(track, track.spawn.x, track.spawn.y);
  check(Math.abs(prF.dist) < 0.3 && Math.abs(prF.s) < 2, 'Ligne d\'arrivée sur la médiane, s=0', `s=${prF.s.toFixed(2)}`);
  check(Math.abs(prSp.dist) < 0.3, 'Départ sur la médiane de Farm Straight');
  check(track.samples[prF.idx].corner === -1, 'Ligne d\'arrivée sur une portion droite');
  check(Math.abs(track.spawn.x - expect.spawn.x) < 0.5 && Math.abs(track.spawn.y - expect.spawn.y) < 0.5,
    'Lieu de départ identique entre circuits', `(${track.spawn.x.toFixed(1)}, ${track.spawn.y.toFixed(1)})`);

  // 8. Congés dans les segments
  const n = track.spec.corners.length;
  let filletsOK = true;
  for (let i = 0; i < n; i++) {
    const prev = track.spec.corners[(i + n - 1) % n];
    const cur = track.spec.corners[i];
    const tPrev = prev.r * TrackKit.SCALE * Math.tan(Math.abs(prev.turn) * Math.PI / 360);
    const tCur = cur.r * TrackKit.SCALE * Math.tan(Math.abs(cur.turn) * Math.PI / 360);
    if (track.lengths[i] < tPrev + tCur + 5) filletsOK = false;
  }
  check(filletsOK, 'Tous les segments assez longs pour leurs congés');

  // 9. Spécifique barrière / béton
  if (expect.barrier) {
    const b = track.barrier;
    console.log(`\nÉcart apex ${expect.barrier[0]} ↔ ${expect.barrier[1]} : ${b.gap.toFixed(1)} m`);
    check(b.gap > W + 12, 'Écart entre les deux apex suffisant');
    check(track.walls.length === 1, 'Mur blanc présent');
    const w = track.walls[0];
    const pm = TrackKit.projectToTrack(track, (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2);
    check(pm.dist > W / 2 + 2, 'Mur blanc hors piste', `${pm.dist.toFixed(1)} m`);
    const dA = Math.hypot((w.x1 + w.x2) / 2 - b.apexSg.x, (w.y1 + w.y2) / 2 - b.apexSg.y);
    const dB = Math.hypot((w.x1 + w.x2) / 2 - b.apexSm.x, (w.y1 + w.y2) / 2 - b.apexSm.y);
    check(Math.abs(dA - dB) < 2, 'Mur centré entre les deux virages', `${dA.toFixed(1)} / ${dB.toFixed(1)} m`);
    check(track.concreteRanges.length === 2, 'Deux pistes d\'envol en béton', `${track.concreteRanges.length}`);
  } else {
    check(track.barrier === null && track.walls.length === 0, 'Pas de barrière (pointes disparues)');
    check(track.concreteRanges.length === 0, 'Pas de dalles de béton (circuit périmètre)');
    check(!names.includes('Seagrave') && !names.includes('Seaman'), 'Seagrave et Seaman ont disparu');
    const maggotts = track.spec.corners.find(c => c.name === 'Maggotts');
    check(maggotts.turn > 0, 'Maggotts est devenu un virage à GAUCHE', `${maggotts.turn}°`);
    const stowe = track.spec.corners.find(c => c.name === 'Stowe');
    const club = track.spec.corners.find(c => c.name === 'Club');
    check(stowe.turn < 0 && stowe.turn > -130, 'Stowe : virage à droite simple', `${stowe.turn}°`);
    check(club.turn < 0 && club.turn > -130, 'Club : virage à droite simple', `${club.turn}°`);
  }

  // --- Aperçu SVG ---
  const bb = track.bbox, pad = 90;
  const sw = bb.maxX - bb.minX + 2 * pad, sh = bb.maxY - bb.minY + 2 * pad;
  const X = x => ((x - bb.minX + pad)).toFixed(1);
  const Y = y => ((bb.maxY - y + pad)).toFixed(1);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sw.toFixed(0)} ${sh.toFixed(0)}" style="background:#4e8a3c">\n`;
  svg += `<path d="M ${track.samples.map(p => `${X(p.x)} ${Y(p.y)}`).join(' L ')} Z" fill="none" stroke="#3d3f42" stroke-width="${W}" stroke-linejoin="round"/>\n`;
  for (const [i0, i1] of track.concreteRanges) {
    const pts = track.samples.slice(i0, i1 + 1);
    svg += `<path d="M ${pts.map(p => `${X(p.x)} ${Y(p.y)}`).join(' L ')}" fill="none" stroke="#a8a9a1" stroke-width="${W}" stroke-linejoin="round"/>\n`;
  }
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
  const svgName = `track-preview-${id.slice(1)}.svg`;
  fs.writeFileSync(path.join(root, 'tools', svgName), svg);
  console.log(`\nAperçu écrit : tools/${svgName}`);
  return track;
}

console.log('=== SILVERSTONE — validation des circuits ===');

const ref = TrackKit.buildTrack('s1948');
validateTrack('s1948', {
  cpCount: 10,
  cpOrder: ['Woodcote', 'Copse', 'Seagrave', 'Maggotts', 'Becketts', 'Chapel', 'Stowe', 'Seaman', 'Club', 'Abbey'],
  barrier: ['Seagrave', 'Seaman'],
  spawn: ref.spawn
});
validateTrack('s1950', {
  cpCount: 8,
  cpOrder: ['Woodcote', 'Copse', 'Maggotts', 'Becketts', 'Chapel', 'Stowe', 'Club', 'Abbey'],
  barrier: null,
  spawn: ref.spawn // le lieu de départ doit être identique
});

console.log(failures ? `\n*** ${failures} ÉCHEC(S) ***` : '\n*** TOUT EST OK ***');
process.exit(failures ? 1 : 0);
