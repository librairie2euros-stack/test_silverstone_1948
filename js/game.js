/* ============================================================
   Logique de jeu (module pur, sans THREE ni DOM) :
   - boucle de simulation à pas fixe
   - surface (piste / herbe) + bannière hors-piste
   - masques de collision : bottes de foin (cercles) + murs (segments)
   - points de contrôle, ligne d'arrivée, chronos
   - autopilote (démo + tests automatisés)
   ============================================================ */
(function (global) {
  'use strict';

  var TrackKitRef = (typeof module !== 'undefined' && module.exports)
    ? require('./trackdata.js') : global.TrackKit;
  var CarPhysicsRef = (typeof module !== 'undefined' && module.exports)
    ? require('./carphysics.js').CarPhysics : null;

  var FIXED_DT = 1 / 120;
  var OFFTRACK_MARGIN = 0.6;   // sortie déclarée quand |lat| > W/2 + marge
  var TELEPORT_DS = 40;        // saut de station anormal → pas de franchissement

  function Game(opts) {
    opts = opts || {};
    var CP = CarPhysicsRef || global.CarPhysics;
    this.TrackKit = TrackKitRef || global.TrackKit;
    this.track = opts.track || this.TrackKit.buildTrack();
    this.car = new CP(opts.carParams);

    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.autopilot = false;

    this.simTime = 0;
    this.accumulator = 0;

    // Bannière : 'hidden' | 'off' (rouge) | 'back' (vert, 1 s)
    this.banner = { mode: 'hidden', timer: 0 };
    this.onTrack = true;
    this.proj = null;

    // Chronos & points de contrôle
    this.cpCount = this.track.checkpoints.length;
    this.cpNext = 0;              // index du prochain CP attendu
    this.cpStates = [];           // false/true par CP
    for (var i = 0; i < this.cpCount; i++) this.cpStates.push(false);
    this.lapCount = 0;
    this.lapStartTime = null;     // simTime au franchissement de la ligne
    this.lastLapTime = null;
    this.bestLapTime = null;
    this.lapValid = [];           // historique
    this.message = null;          // {text, kind:'ok'|'ko', until}
    this.events = [];             // journal pour les tests

    // Collisions
    this.carCircleR = 0.95;
    this.carCircleOffset = 1.05;

    var spawn = this.track.spawn;
    this.car.reset(spawn.x, spawn.y, spawn.heading);
    this.prevS = null;
    this._project();
    this.prevS = this.proj.s;
  }

  Game.prototype._project = function () {
    this.proj = this.TrackKit.projectToTrack(this.track, this.car.x, this.car.y);
    this.onTrack = Math.abs(this.proj.lat) <= this.track.width / 2 + OFFTRACK_MARGIN;
  };

  /* Avance la simulation de dtReal secondes (pas fixes internes). */
  Game.prototype.step = function (dtReal) {
    this.accumulator = Math.min(this.accumulator + dtReal, 0.12);
    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      this._fixedStep(FIXED_DT);
    }
  };

  Game.prototype._fixedStep = function (dt) {
    this.simTime += dt;
    if (this.autopilot) this._autopilotInput();

    var surface = this.onTrack
      ? { mu: this.car.p.muTrack, rollMult: 1, dragMult: 1 }
      : { mu: this.car.p.muGrass, rollMult: this.car.p.rollGrassMult, dragMult: this.car.p.dragGrassMult };

    this.car.step(dt, this.input, surface);
    this._collide();
    this._project();
    this._lapLogic();
    this._banner(dt);
  };

  /* ---------- Bannière hors-piste ---------- */
  Game.prototype._banner = function (dt) {
    var b = this.banner;
    if (!this.onTrack) {
      if (b.mode !== 'off') this.events.push({ t: this.simTime, type: 'offtrack' });
      b.mode = 'off'; b.timer = 0;
    } else if (b.mode === 'off') {
      b.mode = 'back'; b.timer = 1.0; // vert pendant 1 seconde
      this.events.push({ t: this.simTime, type: 'backontrack' });
    } else if (b.mode === 'back') {
      b.timer -= dt;
      if (b.timer <= 0) { b.mode = 'hidden'; b.timer = 0; }
    }
  };

  /* ---------- Points de contrôle & ligne d'arrivée ---------- */
  Game.prototype._lapLogic = function () {
    var S = this.track.S;
    var s = this.proj.s;
    var ds = s - this.prevS;
    if (ds > S / 2) ds -= S; else if (ds < -S / 2) ds += S;

    if (Math.abs(ds) > TELEPORT_DS) { this.prevS = s; return; } // téléportation / reset
    if (ds <= 0) { this.prevS = s; return; }                    // on ne valide qu'en marche avant

    var crossed = function (station, prev, cur, total) {
      // franchissement en avant de `station` entre prev et cur (avec bouclage)
      var d = station - prev; if (d < 0) d += total;
      var dc = cur - prev; if (dc < 0) dc += total;
      return d > 1e-9 && d <= dc + 1e-9;
    };

    if (this.onTrack) {
      // prochain CP attendu uniquement (ordre strict)
      if (this.cpNext < this.cpCount) {
        var cp = this.track.checkpoints[this.cpNext];
        if (crossed(cp.s, this.prevS, s, S)) {
          this.cpStates[this.cpNext] = true;
          this.events.push({ t: this.simTime, type: 'cp', name: cp.name, index: this.cpNext });
          this.cpNext++;
        }
      }
      // ligne d'arrivée (station 0)
      if (crossed(0, this.prevS, s, S)) this._crossFinish();
    }
    this.prevS = s;
  };

  Game.prototype._crossFinish = function () {
    var allDone = this.cpNext >= this.cpCount;
    if (this.lapStartTime !== null) {
      var lapTime = this.simTime - this.lapStartTime;
      if (allDone) {
        this.lapCount++;
        this.lastLapTime = lapTime;
        if (this.bestLapTime === null || lapTime < this.bestLapTime) this.bestLapTime = lapTime;
        this.lapValid.push(lapTime);
        this.message = {
          text: 'TOUR ' + this.lapCount + ' VALIDÉ — ' + formatTime(lapTime),
          kind: 'ok', until: this.simTime + 4
        };
        this.events.push({ t: this.simTime, type: 'lap', time: lapTime, valid: true });
      } else {
        this.message = {
          text: 'Tour non validé (' + this.cpNext + '/' + this.cpCount + ' points de contrôle)',
          kind: 'ko', until: this.simTime + 4
        };
        this.events.push({ t: this.simTime, type: 'lap', valid: false, cp: this.cpNext });
      }
    }
    this.lapStartTime = this.simTime;
    this.cpNext = 0;
    for (var i = 0; i < this.cpCount; i++) this.cpStates[i] = false;
  };

  /* ---------- Collisions : cercles voiture vs bottes & murs ---------- */
  Game.prototype._collide = function () {
    var car = this.car;
    var c = Math.cos(car.heading), s = Math.sin(car.heading);
    var centers = [
      { x: car.x + c * this.carCircleOffset, y: car.y + s * this.carCircleOffset },
      { x: car.x - c * this.carCircleOffset, y: car.y - s * this.carCircleOffset }
    ];
    var R = this.carCircleR;
    var bales = this.track.bales;
    var baleR = this.track.baleDims.collR;
    var i, k;

    for (i = 0; i < bales.length; i++) {
      var bl = bales[i];
      for (k = 0; k < 2; k++) {
        var ctr = centers[k];
        var dx = ctr.x - bl.x, dy = ctr.y - bl.y;
        var d2 = dx * dx + dy * dy, rr = R + baleR;
        if (d2 >= rr * rr || d2 < 1e-9) continue;
        var d = Math.sqrt(d2);
        this._resolveContact(ctr.x, ctr.y, dx / d, dy / d, rr - d, 0.30, 'bale');
        c = Math.cos(car.heading); s = Math.sin(car.heading);
        centers[0] = { x: car.x + c * this.carCircleOffset, y: car.y + s * this.carCircleOffset };
        centers[1] = { x: car.x - c * this.carCircleOffset, y: car.y - s * this.carCircleOffset };
      }
    }

    var walls = this.track.walls;
    for (i = 0; i < walls.length; i++) {
      var w = walls[i];
      for (k = 0; k < 2; k++) {
        var ctr2 = centers[k];
        var abx = w.x2 - w.x1, aby = w.y2 - w.y1;
        var L2 = abx * abx + aby * aby;
        var t = ((ctr2.x - w.x1) * abx + (ctr2.y - w.y1) * aby) / L2;
        t = Math.max(0, Math.min(1, t));
        var qx = w.x1 + abx * t, qy = w.y1 + aby * t;
        var dxw = ctr2.x - qx, dyw = ctr2.y - qy;
        var rw = R + w.thickness / 2;
        var d2w = dxw * dxw + dyw * dyw;
        if (d2w >= rw * rw || d2w < 1e-9) continue;
        var dw = Math.sqrt(d2w);
        this._resolveContact(ctr2.x, ctr2.y, dxw / dw, dyw / dw, rw - dw, 0.35, 'wall');
        c = Math.cos(car.heading); s = Math.sin(car.heading);
        centers[0] = { x: car.x + c * this.carCircleOffset, y: car.y + s * this.carCircleOffset };
        centers[1] = { x: car.x - c * this.carCircleOffset, y: car.y - s * this.carCircleOffset };
      }
    }
  };

  /* Contact rigide 2D : normale (nx,ny) pointe vers la voiture, pénétration pen. */
  Game.prototype._resolveContact = function (px, py, nx, ny, pen, restitution, kind) {
    var car = this.car;
    // dépénétration
    car.x += nx * pen; car.y += ny * pen;
    var vp = car.worldVelocityAt(px, py);
    var vn = vp.x * nx + vp.y * ny;
    if (vn >= 0) return;
    var m = car.p.mass, I = car.p.inertia;
    var armX = px - car.x, armY = py - car.y;
    var armCrossN = armX * ny - armY * nx;
    var invMassN = 1 / m + (armCrossN * armCrossN) / I;
    var j = -(1 + restitution) * vn / invMassN;
    car.applyImpulse(px, py, nx * j, ny * j);
    // friction tangentielle
    var tx = -ny, ty = nx;
    var vt = vp.x * tx + vp.y * ty;
    var armCrossT = armX * ty - armY * tx;
    var invMassT = 1 / m + (armCrossT * armCrossT) / I;
    var jt = -vt / invMassT;
    var jtMax = 0.5 * j;
    jt = Math.max(-jtMax, Math.min(jtMax, jt));
    car.applyImpulse(px, py, tx * jt, ty * jt);
    if (Math.abs(vn) > 0.5) {
      this.lastHit = { t: this.simTime, kind: kind, speed: Math.abs(vn) };
      this.events.push({ t: this.simTime, type: 'hit', kind: kind, speed: Math.abs(vn) });
      if (this.events.length > 6000) this.events.splice(0, 3000);
    }
  };

  /* ---------- Réinitialisation sur la piste ---------- */
  Game.prototype.resetCar = function () {
    var pr = this.proj;
    var sm = this.TrackKit.sampleAtStation(this.track, pr ? pr.s : 0);
    this.car.reset(sm.x, sm.y, sm.heading);
    this._project();
    this.prevS = this.proj.s;
    this.events.push({ t: this.simTime, type: 'reset' });
  };

  /* ---------- Autopilote (démo « P » + tests) ---------- */
  Game.prototype._autopilotInput = function () {
    var track = this.track, TK = this.TrackKit;
    var car = this.car, pr = this.proj;
    if (!pr) return;
    var v = Math.max(car.vx, 1);

    // Anti-blocage : si la voiture reste plantée (contre une botte…), on la replace
    if (this._stuck === undefined) this._stuck = 0;
    if (car.speed() < 1.2 && (this.input.throttle > 0.2 || this.input.brake > 0.2)) {
      this._stuck += FIXED_DT;
      if (this._stuck > 2.5) { this._stuck = 0; this.resetCar(); return; }
    } else this._stuck = 0;

    // Point visé : un peu devant, sur la ligne médiane
    var look = Math.max(9, v * 0.8);
    var tgt = TK.sampleAtStation(track, pr.s + look);
    var dx = tgt.x - car.x, dy = tgt.y - car.y;
    var angTo = Math.atan2(dy, dx);
    var err = angTo - car.heading;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    this.input.steer = Math.max(-1, Math.min(1, err * 2.2));

    // Vitesse cible : courbure la plus contraignante devant, avec enveloppe de freinage
    var aLatMax = 0.78 * car.p.muTrack * 9.81;
    var aBrake = 6.2;
    var vAllow = 60;
    for (var d = 5; d <= 340; d += 5) {
      var smp = TK.sampleAtStation(track, pr.s + d);
      var k = Math.abs(smp.curv);
      var vc = k > 1e-6 ? Math.sqrt(aLatMax / k) : 60;
      var vHere = Math.sqrt(vc * vc + 2 * aBrake * d);
      if (vHere < vAllow) vAllow = vHere;
    }
    // pénalité si loin de la médiane
    if (Math.abs(pr.lat) > 3) vAllow = Math.min(vAllow, 22);

    var dv = vAllow - car.vx;
    if (dv > 0.5) { this.input.throttle = Math.min(1, dv * 0.5); this.input.brake = 0; }
    else if (dv < -0.8) { this.input.throttle = 0; this.input.brake = Math.min(1, -dv * 0.32); }
    else { this.input.throttle = 0.25; this.input.brake = 0; }
    this.input.handbrake = false;
  };

  function formatTime(t) {
    if (t === null || t === undefined) return '—:——.———';
    var m = Math.floor(t / 60);
    var s = t - m * 60;
    var ss = s.toFixed(3);
    if (s < 10) ss = '0' + ss;
    return m + ':' + ss;
  }

  var out = { Game: Game, formatTime: formatTime, FIXED_DT: FIXED_DT };
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
  else { global.GameKit = out; }
})(typeof window !== 'undefined' ? window : globalThis);
