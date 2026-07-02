/* ============================================================
   Physique voiture — modèle bicyclette dynamique (module pur).
   VOITURE MODERNE : châssis rigide, pneus à forte adhérence,
   appui aérodynamique, et aides électroniques :
     - TC  (antipatinage : le couple est limité à l'adhérence restante)
     - ABS (le freinage préserve toujours de quoi diriger)
     - ESP (couple de lacet correcteur : la voiture ne part pas en toupie)
   Le frein à main (Espace) débranche TC + ESP pour glisser volontairement.
   Repère voiture : x vers l'avant, y vers la gauche, lacet CCW+.
   ============================================================ */
(function (global) {
  'use strict';

  var G = 9.81;

  var PARAMS = {
    mass: 720,          // kg (sportive légère moderne)
    inertia: 850,       // kg·m² (lacet)
    a: 1.24,            // distance CG → essieu avant (m)
    b: 1.36,            // CG légèrement avancé → stable (sous-vireur)
    halfWidth: 0.85,
    power: 285e3,          // W (~390 ch)
    engineForceMax: 9800,  // N (limite basse vitesse)
    brakeForceMax: 16500,  // N (total)
    brakeBias: 0.62,       // proportion avant
    handbrakeForce: 6200,  // N (arrière)
    cornerStiffF: 96000,   // N/rad (essieu avant, pneus modernes)
    cornerStiffR: 118000,  // N/rad (essieu arrière)
    muTrack: 1.30,
    muGrass: 0.55,
    downforceCoef: 1.15,   // N/(m/s)² d'appui aéro total (~3,3 kN à 190 km/h)
    downBalanceF: 0.42,    // part de l'appui sur l'essieu avant
    dragCoef: 0.78,        // ½ρCdA
    rollCoef: 260,
    rollGrassMult: 4.0,
    dragGrassMult: 3.0,
    steerMax: 0.52,        // rad (~30°) à l'arrêt
    steerRate: 4.6,        // rad/s vers la consigne
    steerReturnMult: 1.7,  // retour au centre plus rapide
    steerLatG: 1.10,       // limite de braquage utile (fraction du potentiel)
    espYawGain: 3200,      // N·m par rad/s d'écart de lacet
    tcSlipStart: 0.12,     // rad : l'antipatinage coupe au-delà de cette dérive arrière
    absFrontReserve: 0.90  // l'ABS garde ≥ √(1-0.9²) ≈ 44 % du potentiel avant pour tourner
  };

  function CarPhysics(opts) {
    this.p = {};
    for (var k in PARAMS) this.p[k] = PARAMS[k];
    if (opts) for (var k2 in opts) this.p[k2] = opts[k2];
    this.reset(0, 0, 0);
  }

  CarPhysics.prototype.reset = function (x, y, heading) {
    this.x = x; this.y = y; this.heading = heading;
    this.vx = 0; this.vy = 0; this.r = 0;
    this.steer = 0;
    this.throttle = 0; this.brake = 0;
    this.wheelSpin = 0;
    this.slipping = 0;
  };

  CarPhysics.prototype.speed = function () {
    return Math.hypot(this.vx, this.vy);
  };

  /* input : {throttle 0..1, brake 0..1, steer -1..1 (gauche +), handbrake bool}
     surface : {mu, rollMult, dragMult} */
  CarPhysics.prototype.step = function (dt, input, surface) {
    var p = this.p;
    var mu = surface.mu;
    var m = p.mass;
    var wheelbase = p.a + p.b;
    var vAbs = Math.abs(this.vx);
    var hb = !!input.handbrake;
    var aids = !hb; // Espace : mode glisse, aides débranchées

    // --- Appui aérodynamique : plus on va vite, plus on colle ---
    var down = p.downforceCoef * this.vx * this.vx;
    var FzF = m * G * p.b / wheelbase + down * p.downBalanceF;
    var FzR = m * G * p.a / wheelbase + down * (1 - p.downBalanceF);
    var muEff = mu * (1 + down / (m * G)); // potentiel latéral global

    // --- Volant : consigne limitée par la vitesse (inclut l'appui aéro) ---
    var steerLimit = p.steerMax;
    if (vAbs > 4) {
      var byLatG = Math.atan(p.steerLatG * muEff * G * wheelbase / (this.vx * this.vx));
      steerLimit = Math.min(p.steerMax, Math.max(0.05, byLatG));
    }
    var target = Math.max(-1, Math.min(1, input.steer)) * steerLimit;
    var dSteer = target - this.steer;
    var rate = p.steerRate;
    if (target === 0 || target * this.steer < 0) rate *= p.steerReturnMult;
    var maxD = rate * dt;
    this.steer += Math.max(-maxD, Math.min(maxD, dSteer));

    var delta = this.steer;
    this.throttle = input.throttle; this.brake = input.brake;

    // --- Angles de dérive ---
    var vxSafe = Math.max(1.2, vAbs);
    var alphaF = Math.atan2(this.vy + p.a * this.r, vxSafe) - delta * (this.vx >= 0 ? 1 : -1);
    var alphaR = Math.atan2(this.vy - p.b * this.r, vxSafe);

    // --- Demandes longitudinales ---
    var driveF = 0;
    if (input.throttle > 0) {
      var vForP = Math.max(4, this.vx);
      driveF = input.throttle * Math.min(p.engineForceMax, p.power / vForP);
    }
    var brakeF = input.brake * p.brakeForceMax;
    var movingFwd = this.vx > 0.3, movingBack = this.vx < -0.3;

    var reverseF = 0;
    if (input.brake > 0 && !movingFwd) {
      brakeF = 0;
      if (this.vx > -13) reverseF = -input.brake * 5200; // marche arrière moderne
    }
    if (input.throttle > 0 && movingBack) {
      driveF = 0; brakeF = Math.max(brakeF, input.throttle * p.brakeForceMax * 0.8);
    }

    var muR = hb ? mu * 0.55 : mu;

    // --- TC (antipatinage) : ne demander à l'arrière que ce qu'il peut donner ---
    if (aids && driveF > 0 && vAbs > 1) {
      var FyR_demand = Math.min(p.cornerStiffR * Math.abs(alphaR), 0.96 * mu * FzR);
      var reserve = Math.sqrt(Math.max(0, (mu * FzR) * (mu * FzR) - FyR_demand * FyR_demand));
      driveF = Math.min(driveF, reserve);
      // coupe d'allumage si l'arrière dérive trop
      if (Math.abs(alphaR) > p.tcSlipStart) {
        driveF *= Math.max(0.2, 1 - (Math.abs(alphaR) - p.tcSlipStart) * 6);
      }
    }

    var brakeSign = movingFwd ? -1 : (movingBack ? 1 : 0);
    var FxF_want = brakeSign * brakeF * p.brakeBias;
    var FxR_want = driveF + reverseF + brakeSign * brakeF * (1 - p.brakeBias);
    if (hb && movingFwd) FxR_want -= p.handbrakeForce;

    // --- ABS : l'avant garde toujours de quoi diriger ---
    var FxF_cap = mu * FzF * (aids ? p.absFrontReserve : 1);
    var FxF = Math.max(-FxF_cap, Math.min(FxF_cap, FxF_want));
    var FxR = Math.max(-muR * FzR * 0.96, Math.min(muR * FzR * 0.96, FxR_want));

    // --- Pneus latéraux : saturation douce + ellipse de friction ---
    var FyF_cap = mu * FzF * Math.sqrt(Math.max(0.10, 1 - (FxF / (mu * FzF)) * (FxF / (mu * FzF))));
    var FyR_cap = muR * FzR * Math.sqrt(Math.max(0.10, 1 - (FxR / (muR * FzR)) * (FxR / (muR * FzR))));
    var FyF = -p.cornerStiffF * alphaF;
    FyF = FyF_cap * Math.tanh(FyF / Math.max(1, FyF_cap));
    var FyR = -p.cornerStiffR * alphaR;
    FyR = FyR_cap * Math.tanh(FyR / Math.max(1, FyR_cap));

    // indicateur de glisse (son / HUD)
    var slipF = Math.abs(alphaF) > 0.12 ? 1 : 0, slipR = Math.abs(alphaR) > 0.10 ? 1 : 0;
    this.slipping += ((slipF + slipR) * 0.5 * (vAbs > 4 ? 1 : 0) - this.slipping) * Math.min(1, dt * 6);

    // --- Résistances ---
    var drag = p.dragCoef * surface.dragMult * this.vx * Math.abs(this.vx);
    var roll = p.rollCoef * surface.rollMult * (this.vx > 0.2 ? 1 : (this.vx < -0.2 ? -1 : this.vx / 0.2));

    // --- Bilan des forces (modèle bicyclette) ---
    var cosd = Math.cos(delta), sind = Math.sin(delta);
    var Fx = FxR + FxF * cosd - FyF * sind - drag - roll;
    var Fy = FyF * cosd + FxF * sind + FyR;
    var Mz = p.a * (FyF * cosd + FxF * sind) - p.b * FyR;

    // --- ESP : couple de lacet correcteur vers la rotation « saine » ---
    if (aids && vAbs > 3) {
      var rRef = this.vx * Math.tan(delta) / wheelbase;
      var rCap = muEff * G / Math.max(vAbs, 3); // rotation max physiquement utile
      rRef = Math.max(-rCap, Math.min(rCap, rRef));
      var espGain = Math.min(1, (vAbs - 3) / 5);
      Mz += p.espYawGain * (rRef - this.r) * espGain;
    }

    var ax = Fx / m + this.r * this.vy;
    var ay = Fy / m - this.r * this.vx;
    var rdot = Mz / p.inertia;

    this.vx += ax * dt;
    this.vy += ay * dt;
    this.r += rdot * dt;

    // --- Fusion basse vitesse : modèle cinématique (stable et maniable) ---
    var kin = 1 - Math.min(1, Math.max(0, (vAbs - 1.5) / 3.0));
    if (kin > 0) {
      var rKin = this.vx * Math.tan(delta) / wheelbase;
      var beta = Math.atan(p.b * Math.tan(delta) / wheelbase);
      var vyKin = this.vx * Math.tan(beta);
      this.r = this.r * (1 - kin) + rKin * kin;
      this.vy = this.vy * (1 - kin) + vyKin * kin;
    }

    // Immobilisation propre
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

    this.wheelSpin += (this.vx / 0.35) * dt;
  };

  /* Impulsion appliquée en un point du monde (collisions). */
  CarPhysics.prototype.applyImpulse = function (px, py, jx, jy) {
    var p = this.p;
    var c = Math.cos(this.heading), s = Math.sin(this.heading);
    var wx = this.vx * c - this.vy * s;
    var wy = this.vx * s + this.vy * c;
    wx += jx / p.mass; wy += jy / p.mass;
    var armX = px - this.x, armY = py - this.y;
    this.r += (armX * jy - armY * jx) / p.inertia;
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
