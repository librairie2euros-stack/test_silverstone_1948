/* ============================================================
   Physique voiture — modèle bicyclette dynamique (module pur).
   Monoplace type Grand Prix 1948 (~750 kg, ~150 kW, propulsion).
   Repère voiture : x vers l'avant, y vers la gauche, lacet CCW+.
   Forces : moteur (limité par la puissance ET l'adhérence),
   freins, pneus latéraux saturés (ellipse de friction),
   traînée aérodynamique, résistance au roulement.
   ============================================================ */
(function (global) {
  'use strict';

  var G = 9.81;

  var PARAMS = {
    mass: 750,          // kg
    inertia: 900,       // kg·m² (lacet)
    a: 1.30,            // distance CG → essieu avant (m)
    b: 1.30,            // distance CG → essieu arrière (m)
    halfWidth: 0.80,    // demi-largeur (m)
    power: 165e3,       // W (~225 ch, monoplace GP fin des années 40)
    engineForceMax: 6800,  // N (limite basse vitesse)
    brakeForceMax: 10500,  // N (total)
    brakeBias: 0.58,       // proportion avant
    handbrakeForce: 5200,  // N (arrière)
    cornerStiffF: 62000,   // N/rad (essieu avant)
    cornerStiffR: 68000,   // N/rad (essieu arrière)
    muTrack: 1.05,
    muGrass: 0.52,
    dragCoef: 0.70,        // ½ρCdA
    rollCoef: 220,         // N à v>0 (piste)
    rollGrassMult: 4.0,
    dragGrassMult: 3.0,
    steerMax: 0.55,        // rad (~31°) à l'arrêt
    steerRate: 3.2,        // rad/s (vitesse du volant)
    steerLatG: 1.35        // limite de braquage : δmax tel que a_lat ≈ 1.35·μ·g
  };

  function CarPhysics(opts) {
    this.p = {};
    for (var k in PARAMS) this.p[k] = PARAMS[k];
    if (opts) for (var k2 in opts) this.p[k2] = opts[k2];
    this.reset(0, 0, 0);
  }

  CarPhysics.prototype.reset = function (x, y, heading) {
    this.x = x; this.y = y; this.heading = heading;
    this.vx = 0; this.vy = 0; this.r = 0;   // vitesses repère voiture + vitesse de lacet
    this.steer = 0;                          // braquage actuel (rad)
    this.throttle = 0; this.brake = 0;
    this.wheelSpin = 0;                      // pour l'animation des roues
    this.slipping = 0;                       // indicateur de glisse (0..1)
  };

  CarPhysics.prototype.speed = function () {
    return Math.hypot(this.vx, this.vy);
  };

  /* input : {throttle 0..1, brake 0..1, steer -1..1 (gauche +), handbrake bool}
     surface : {mu, rollMult, dragMult} */
  CarPhysics.prototype.step = function (dt, input, surface) {
    var p = this.p;
    var mu = surface.mu;

    // --- Volant : consigne limitée par la vitesse (anti-tête-à-queue clavier) ---
    var vAbs = Math.abs(this.vx);
    var wheelbase = p.a + p.b;
    var steerLimit = p.steerMax;
    if (vAbs > 4) {
      var byLatG = Math.atan(p.steerLatG * mu * G * wheelbase / (this.vx * this.vx));
      steerLimit = Math.min(p.steerMax, Math.max(0.06, byLatG));
    }
    var target = Math.max(-1, Math.min(1, input.steer)) * steerLimit;
    var dSteer = target - this.steer;
    var maxD = p.steerRate * dt;
    this.steer += Math.max(-maxD, Math.min(maxD, dSteer));

    var delta = this.steer;
    this.throttle = input.throttle; this.brake = input.brake;

    // --- Charges verticales statiques ---
    var m = p.mass;
    var FzF = m * G * p.b / wheelbase;
    var FzR = m * G * p.a / wheelbase;

    // --- Forces longitudinales demandées ---
    var driveF = 0;
    if (input.throttle > 0) {
      var vForP = Math.max(3, this.vx);
      driveF = input.throttle * Math.min(p.engineForceMax, p.power / vForP);
    }
    var brakeF = input.brake * p.brakeForceMax;
    var movingFwd = this.vx > 0.3, movingBack = this.vx < -0.3;

    // Marche arrière : frein → propulsion arrière limitée quand on est arrêté
    var reverseF = 0;
    if (input.brake > 0 && !movingFwd) {
      brakeF = 0;
      if (this.vx > -11) reverseF = -input.brake * 3600; // ~40 km/h max en marche arrière
    }
    if (input.throttle > 0 && movingBack) { // on accélère alors qu'on recule : freine d'abord
      driveF = 0; brakeF = Math.max(brakeF, input.throttle * p.brakeForceMax * 0.8);
    }

    var brakeSign = movingFwd ? -1 : (movingBack ? 1 : 0);
    var FxF_want = brakeSign * brakeF * p.brakeBias;
    var FxR_want = driveF + reverseF + brakeSign * brakeF * (1 - p.brakeBias);

    var muR = mu, hb = !!input.handbrake;
    if (hb) {
      muR *= 0.55; // roues arrière bloquées → glisse
      if (movingFwd) FxR_want -= p.handbrakeForce;
    }

    // --- Angles de dérive ---
    var vxSafe = Math.max(1.2, vAbs);
    var alphaF = Math.atan2(this.vy + p.a * this.r, vxSafe) - delta * (this.vx >= 0 ? 1 : -1);
    var alphaR = Math.atan2(this.vy - p.b * this.r, vxSafe);

    // --- Forces pneus (saturation douce + ellipse de friction) ---
    var FyF_max = mu * FzF, FyR_maxBase = muR * FzR;
    // capacité longitudinale consommée à l'arrière
    var FxR = Math.max(-muR * FzR, Math.min(muR * FzR, FxR_want));
    var FyR_max = FyR_maxBase * Math.sqrt(Math.max(0.08, 1 - (FxR / (muR * FzR)) * (FxR / (muR * FzR))));
    var FxF = Math.max(-mu * FzF, Math.min(mu * FzF, FxF_want));
    var FyF_cap = FyF_max * Math.sqrt(Math.max(0.08, 1 - (FxF / (mu * FzF)) * (FxF / (mu * FzF))));

    var FyF = -p.cornerStiffF * alphaF;
    FyF = FyF_cap * Math.tanh(FyF / Math.max(1, FyF_cap));
    var FyR = -p.cornerStiffR * alphaR;
    FyR = FyR_max * Math.tanh(FyR / Math.max(1, FyR_max));

    // indicateur de glisse pour le son / HUD
    var slipF = Math.abs(alphaF) > 0.12 ? 1 : 0, slipR = Math.abs(alphaR) > 0.10 ? 1 : 0;
    this.slipping += ((slipF + slipR) * 0.5 * (vAbs > 4 ? 1 : 0) - this.slipping) * Math.min(1, dt * 6);

    // --- Résistances ---
    var drag = p.dragCoef * surface.dragMult * this.vx * Math.abs(this.vx);
    var roll = p.rollCoef * surface.rollMult * (this.vx > 0.2 ? 1 : (this.vx < -0.2 ? -1 : this.vx / 0.2));

    // --- Dynamique (modèle bicyclette) ---
    var cosd = Math.cos(delta), sind = Math.sin(delta);
    var Fx = FxR + FxF * cosd - FyF * sind - drag - roll;
    var Fy = FyF * cosd + FxF * sind + FyR;
    var Mz = p.a * (FyF * cosd + FxF * sind) - p.b * FyR;

    var ax = Fx / m + this.r * this.vy;
    var ay = Fy / m - this.r * this.vx;
    var rdot = Mz / p.inertia;

    this.vx += ax * dt;
    this.vy += ay * dt;
    this.r += rdot * dt;

    // --- Fusion basse vitesse : modèle cinématique (stable et maniable) ---
    var kin = 1 - Math.min(1, Math.max(0, (vAbs - 1.5) / 3.0)); // 1 en dessous de 1,5 m/s
    if (kin > 0) {
      var rKin = this.vx * Math.tan(delta) / wheelbase;
      var beta = Math.atan(p.b * Math.tan(delta) / wheelbase);
      var vyKin = this.vx * Math.tan(beta);
      this.r = this.r * (1 - kin) + rKin * kin;
      this.vy = this.vy * (1 - kin) + vyKin * kin;
    }

    // Immobilisation propre (pas de reptation numérique)
    if (Math.abs(this.vx) < 0.15 && input.throttle === 0 && input.brake === 0) {
      this.vx *= Math.max(0, 1 - 8 * dt);
    }
    if (Math.abs(this.vx) < 0.4) this.vy *= Math.max(0, 1 - 6 * dt);

    // --- Intégration position ---
    var c = Math.cos(this.heading), s = Math.sin(this.heading);
    this.x += (this.vx * c - this.vy * s) * dt;
    this.y += (this.vx * s + this.vy * c) * dt;
    this.heading += this.r * dt;
    while (this.heading > Math.PI) this.heading -= 2 * Math.PI;
    while (this.heading < -Math.PI) this.heading += 2 * Math.PI;

    this.wheelSpin += (this.vx / 0.34) * dt; // rayon de roue 34 cm
  };

  /* Impulsion appliquée en un point du monde (collisions).
     (px,py) point d'application, (jx,jy) impulsion en N·s, repère monde. */
  CarPhysics.prototype.applyImpulse = function (px, py, jx, jy) {
    var p = this.p;
    var c = Math.cos(this.heading), s = Math.sin(this.heading);
    // vitesse monde
    var wx = this.vx * c - this.vy * s;
    var wy = this.vx * s + this.vy * c;
    wx += jx / p.mass; wy += jy / p.mass;
    var armX = px - this.x, armY = py - this.y;
    this.r += (armX * jy - armY * jx) / p.inertia;
    // retour repère voiture
    this.vx = wx * c + wy * s;
    this.vy = -wx * s + wy * c;
  };

  CarPhysics.prototype.worldVelocityAt = function (px, py) {
    var c = Math.cos(this.heading), s = Math.sin(this.heading);
    var wx = this.vx * c - this.vy * s;
    var wy = this.vx * s + this.vy * c;
    var armX = px - this.x, armY = py - this.y;
    return { x: wx - this.r * armY, y: wy + this.r * armX };
  };

  var out = { CarPhysics: CarPhysics, PARAMS: PARAMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
  else { global.CarPhysics = CarPhysics; }
})(typeof window !== 'undefined' ? window : globalThis);
