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
  const surf = { mu: 1.05, rollMult: 1, dragMult: 1 };
  let t100 = null;
  for (let t = 0; t < 14; t += FIXED_DT) {
    car.step(FIXED_DT, { throttle: 1, brake: 0, steer: 0, handbrake: false }, surf);
    if (t100 === null && car.vx >= 27.78) t100 = t;
  }
  const vKmh = car.vx * 3.6;
  check(vKmh > 150 && vKmh < 240, 'Vitesse après 14 s plein gaz plausible', `${vKmh.toFixed(0)} km/h, 0→100 en ${t100 ? t100.toFixed(1) : '?'} s`);
  check(Math.abs(car.y) < 1 && Math.abs(car.vy) < 0.5, 'Trajectoire rectiligne stable', `y=${car.y.toFixed(2)}`);

  // Freinage
  const v0 = car.vx;
  let dist = 0;
  while (car.vx > 0.5) {
    const x0 = car.x;
    car.step(FIXED_DT, { throttle: 0, brake: 1, steer: 0, handbrake: false }, surf);
    dist += car.x - x0;
  }
  const expected = v0 * v0 / (2 * 1.05 * 9.81);
  check(dist > expected * 0.8 && dist < expected * 1.8, 'Distance de freinage réaliste', `${dist.toFixed(0)} m depuis ${(v0 * 3.6).toFixed(0)} km/h (théorie μ : ${expected.toFixed(0)} m)`);

  // Virage régulier : rayon cohérent
  const car2 = new CarPhysics();
  for (let t = 0; t < 6; t += FIXED_DT) {
    car2.step(FIXED_DT, { throttle: t < 3 ? 0.6 : 0.25, brake: 0, steer: t > 3 ? 0.5 : 0, handbrake: false }, surf);
  }
  check(Math.abs(car2.r) > 0.05, 'La voiture tourne quand on braque', `vitesse de lacet ${car2.r.toFixed(2)} rad/s`);
  check(!Number.isNaN(car2.x + car2.y + car2.vx + car2.vy + car2.r), 'Pas de NaN');

  // Herbe : nettement plus lent
  const car3 = new CarPhysics();
  const grass = { mu: 0.52, rollMult: 4.0, dragMult: 3.0 };
  for (let t = 0; t < 10; t += FIXED_DT) car3.step(FIXED_DT, { throttle: 1, brake: 0, steer: 0, handbrake: false }, grass);
  const grassKmh = car3.vx * 3.6;
  check(grassKmh > 30 && grassKmh < 110, 'L\'herbe ralentit nettement mais on peut revenir', `${grassKmh.toFixed(0)} km/h sur herbe`);
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
