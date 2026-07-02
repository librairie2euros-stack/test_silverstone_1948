/* Test de bout en bout SANS navigateur : physique + logique de jeu.
   Usage : node tools/test-game.mjs */
import { createRequire } from 'module';
import path from 'path';
import url from 'url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const { Game, formatTime, FIXED_DT } = require(path.join(root, 'js', 'game.js'));
const { CarPhysics } = require(path.join(root, 'js', 'carphysics.js'));

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? '  OK ' : 'ÉCHEC'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

console.log('=== Tests physique ===\n');
{
  // Ligne droite, plein gaz 8 s
  const car = new CarPhysics();
  const MU = car.p.muTrack;
  const surf = { mu: MU, rollMult: 1, dragMult: 1 };
  let t100 = null;
  for (let t = 0; t < 14; t += FIXED_DT) {
    car.step(FIXED_DT, { throttle: 1, brake: 0, steer: 0, handbrake: false }, surf);
    if (t100 === null && car.vx >= 27.78) t100 = t;
  }
  const vKmh = car.vx * 3.6;
  check(vKmh > 200 && vKmh < 280, 'Vitesse après 14 s plein gaz (voiture moderne)', `${vKmh.toFixed(0)} km/h, 0→100 en ${t100 ? t100.toFixed(1) : '?'} s`);
  check(t100 !== null && t100 < 5.5, '0→100 km/h digne d\'une sportive moderne', `${t100 ? t100.toFixed(1) : '?'} s`);
  check(Math.abs(car.y) < 1 && Math.abs(car.vy) < 0.5, 'Trajectoire rectiligne stable', `y=${car.y.toFixed(2)}`);

  // Freinage (ABS + appui aéro : au moins aussi bien que la théorie μ seul)
  const v0 = car.vx;
  let dist = 0;
  while (car.vx > 0.5) {
    const x0 = car.x;
    car.step(FIXED_DT, { throttle: 0, brake: 1, steer: 0, handbrake: false }, surf);
    dist += car.x - x0;
  }
  const expected = v0 * v0 / (2 * MU * 9.81);
  check(dist > expected * 0.4 && dist < expected * 1.3, 'Distance de freinage moderne', `${dist.toFixed(0)} m depuis ${(v0 * 3.6).toFixed(0)} km/h (théorie μ seul : ${expected.toFixed(0)} m)`);

  // Virage régulier : rayon cohérent
  const car2 = new CarPhysics();
  for (let t = 0; t < 6; t += FIXED_DT) {
    car2.step(FIXED_DT, { throttle: t < 3 ? 0.6 : 0.25, brake: 0, steer: t > 3 ? 0.5 : 0, handbrake: false }, surf);
  }
  check(Math.abs(car2.r) > 0.05, 'La voiture tourne quand on braque', `vitesse de lacet ${car2.r.toFixed(2)} rad/s`);
  check(!Number.isNaN(car2.x + car2.y + car2.vx + car2.vy + car2.r), 'Pas de NaN');

  // Herbe : nettement plus lent
  const car3 = new CarPhysics();
  const grass = { mu: 0.55, rollMult: 4.0, dragMult: 3.0 };
  for (let t = 0; t < 10; t += FIXED_DT) car3.step(FIXED_DT, { throttle: 1, brake: 0, steer: 0, handbrake: false }, grass);
  const grassKmh = car3.vx * 3.6;
  check(grassKmh > 30 && grassKmh < 130, 'L\'herbe ralentit nettement mais on peut revenir', `${grassKmh.toFixed(0)} km/h sur herbe`);
}

console.log('\n=== Tests de stabilité (la voiture ne part pas dans tous les sens) ===\n');
{
  const surf = { mu: 1.30, rollMult: 1, dragMult: 1 };

  // 1. Coup de volant maximal maintenu à ~160 km/h : vire fort, SANS tête-à-queue
  const car = new CarPhysics();
  car.vx = 45;
  let maxAlphaR = 0, maxYaw = 0, minV = 999;
  const h0 = 0;
  for (let t = 0; t < 3; t += FIXED_DT) {
    car.step(FIXED_DT, { throttle: 0.3, brake: 0, steer: 1, handbrake: false }, surf);
    maxAlphaR = Math.max(maxAlphaR, Math.abs(Math.atan2(car.vy - car.p.b * car.r, Math.max(1.2, car.vx))));
    maxYaw = Math.max(maxYaw, Math.abs(car.r));
    minV = Math.min(minV, car.vx);
  }
  check(maxAlphaR < 0.30, 'Braquage max à 160 km/h : dérive arrière contenue (pas de toupie)', `dérive max ${(maxAlphaR * 180 / Math.PI).toFixed(1)}°`);
  check(maxYaw < 1.6, 'Vitesse de lacet bornée', `${maxYaw.toFixed(2)} rad/s`);
  check(car.vx > 15, 'La voiture continue d\'avancer (elle tourne, elle ne glisse pas)', `${(car.vx * 3.6).toFixed(0)} km/h`);

  // 2. Lever de pied brutal en plein virage : pas de survirage brusque
  const car2 = new CarPhysics();
  car2.vx = 40;
  for (let t = 0; t < 1.5; t += FIXED_DT) car2.step(FIXED_DT, { throttle: 0.6, brake: 0, steer: 0.7, handbrake: false }, surf);
  const rBefore = car2.r;
  let maxR = 0;
  for (let t = 0; t < 1.5; t += FIXED_DT) {
    car2.step(FIXED_DT, { throttle: 0, brake: 0, steer: 0.7, handbrake: false }, surf);
    maxR = Math.max(maxR, Math.abs(car2.r));
  }
  check(maxR < Math.abs(rBefore) * 1.6 + 0.35, 'Lever de pied en virage : pas de survirage violent', `lacet ${rBefore.toFixed(2)} → max ${maxR.toFixed(2)} rad/s`);

  // 3. Zigzag brutal au clavier à ~130 km/h : la voiture reste dans l'axe global
  const car3 = new CarPhysics();
  car3.vx = 36;
  for (let t = 0; t < 4; t += FIXED_DT) {
    const st = Math.floor(t / 0.5) % 2 === 0 ? 1 : -1; // pleine gauche / pleine droite toutes les 0,5 s
    car3.step(FIXED_DT, { throttle: 0.5, brake: 0, steer: st, handbrake: false }, surf);
  }
  const alphaR3 = Math.abs(Math.atan2(car3.vy - car3.p.b * car3.r, Math.max(1.2, car3.vx)));
  check(alphaR3 < 0.25 && car3.vx > 20, 'Zigzag brutal : la voiture reste rattrapable', `dérive finale ${(alphaR3 * 180 / Math.PI).toFixed(1)}°, ${(car3.vx * 3.6).toFixed(0)} km/h`);

  // 4. Plein gaz en sortie d'épingle (2e rapport virtuel) : le TC évite le tête-à-queue
  const car4 = new CarPhysics();
  car4.vx = 12;
  let spun = false;
  for (let t = 0; t < 3; t += FIXED_DT) {
    car4.step(FIXED_DT, { throttle: 1, brake: 0, steer: 0.9, handbrake: false }, surf);
    const aR = Math.abs(Math.atan2(car4.vy - car4.p.b * car4.r, Math.max(1.2, car4.vx)));
    if (aR > 0.45) spun = true;
  }
  check(!spun && car4.vx > 12, 'Plein gaz en sortie d\'épingle : le TC tient l\'arrière', `${(car4.vx * 3.6).toFixed(0)} km/h en sortie`);
}

console.log('\n=== Test de jeu : tour complet en autopilote ===\n');
{
  const game = new Game();
  game.autopilot = true;
  const maxSim = 420; // 7 min de marge
  let lapDone = false;
  for (let t = 0; t < maxSim; t += FIXED_DT) {
    game._fixedStep(FIXED_DT);
    if (game.lapCount >= 1) { lapDone = true; break; }
  }
  check(lapDone, 'Un tour complet bouclé par l\'autopilote');
  const cpEvents = game.events.filter(e => e.type === 'cp');
  const lapEvents = game.events.filter(e => e.type === 'lap');
  check(cpEvents.length >= 10, 'Les 10 points de contrôle validés', cpEvents.map(e => e.name).join(' → '));
  const lastLap = lapEvents[lapEvents.length - 1];
  check(lastLap && lastLap.valid === true, 'Tour validé (tous les CP avant la ligne)');
  if (lastLap && lastLap.valid) {
    console.log(`       Temps au tour (autopilote) : ${formatTime(lastLap.time)}`);
    check(lastLap.time > 60 && lastLap.time < 300, 'Temps au tour plausible', formatTime(lastLap.time));
  }
  const hits = game.events.filter(e => e.type === 'hit');
  console.log(`       Collisions pendant le tour : ${hits.length}`);
  const off = game.events.filter(e => e.type === 'offtrack');
  console.log(`       Sorties de piste : ${off.length}`);
  check(!Number.isNaN(game.car.x + game.car.y), 'État final sain');
}

console.log('\n=== Test : bannière hors-piste ===\n');
{
  const game = new Game();
  // pousse la voiture hors de la piste, latéralement
  const spawn = game.track.spawn;
  game.car.reset(spawn.x, spawn.y + game.track.width / 2 + 5, spawn.heading);
  game._fixedStep(FIXED_DT);
  check(game.banner.mode === 'off', 'Bannière ROUGE quand la voiture est hors piste', game.banner.mode);
  // retour sur la piste
  game.car.reset(spawn.x, spawn.y, spawn.heading);
  game._fixedStep(FIXED_DT);
  check(game.banner.mode === 'back', 'Bannière VERTE au retour sur la piste', game.banner.mode);
  let t = 0;
  while (game.banner.mode === 'back' && t < 2) { game._fixedStep(FIXED_DT); t += FIXED_DT; }
  check(game.banner.mode === 'hidden' && t > 0.9 && t < 1.1, 'Bannière disparaît après ~1 s', `${t.toFixed(2)} s`);
}

console.log('\n=== Test : collision avec une botte de foin ===\n');
{
  const game = new Game();
  const bale = game.track.bales[0];
  // lance la voiture droit sur la botte
  const ang = Math.atan2(bale.y - 0, bale.x - 0);
  game.car.reset(bale.x - Math.cos(ang) * 30, bale.y - Math.sin(ang) * 30, ang);
  game.car.vx = 20;
  let hit = false;
  for (let t = 0; t < 4; t += FIXED_DT) {
    game._fixedStep(FIXED_DT);
    if (game.events.some(e => e.type === 'hit' && e.kind === 'bale')) { hit = true; break; }
  }
  check(hit, 'La botte de foin arrête la voiture (masque de collision actif)');
  const d = Math.hypot(game.car.x - bale.x, game.car.y - bale.y);
  check(d > 1.5, 'Pas d\'interpénétration après contact', `${d.toFixed(2)} m du centre de la botte`);
}

console.log('\n=== Test : mur blanc Seagrave/Seaman ===\n');
{
  const game = new Game();
  const w = game.track.walls[0];
  const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
  const nx = -(w.y2 - w.y1), ny = (w.x2 - w.x1);
  const nl = Math.hypot(nx, ny);
  const ang = Math.atan2(-ny / nl, -nx / nl);
  game.car.reset(mx + (nx / nl) * 40, my + (ny / nl) * 40, ang);
  game.car.vx = 25;
  let hitWall = false, hitBale = false;
  for (let t = 0; t < 5; t += FIXED_DT) {
    game._fixedStep(FIXED_DT);
    if (game.events.some(e => e.type === 'hit' && e.kind === 'wall')) hitWall = true;
    if (game.events.some(e => e.type === 'hit' && e.kind === 'bale')) hitBale = true;
    if (hitWall || hitBale) break;
  }
  check(hitWall || hitBale, 'La barrière centrale bloque la traversée Seagrave→Seaman',
    hitBale ? 'bottes de foin touchées' : 'mur touché');
  const v = game.car.speed();
  check(v < 12, 'La voiture est fortement ralentie par la barrière', `${(v * 3.6).toFixed(0)} km/h`);
}

console.log(failures ? `\n*** ${failures} ÉCHEC(S) ***` : '\n*** TOUT EST OK ***');
process.exit(failures ? 1 : 0);
