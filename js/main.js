/* ============================================================
   Point d'entrée : boucle de jeu, entrées clavier, son moteur.
   Clavier par position physique (event.code) : fonctionne en
   AZERTY (ZQSD) comme en QWERTY (WASD), plus les flèches.
   ============================================================ */
(function () {
  'use strict';

  var game = new GameKit.Game();
  var view = new Renderer3D(document.getElementById('scene'), game.track);
  var hud = new HUD(game);

  // ------- Entrées clavier -------
  var keys = {};
  var MAP = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'hand'
  };
  window.addEventListener('keydown', function (e) {
    var k = MAP[e.code];
    if (k) { keys[k] = true; e.preventDefault(); }
    if (e.code === 'KeyR') game.resetCar();
    if (e.code === 'KeyC') view.cameraMode = (view.cameraMode + 1) % 3;
    if (e.code === 'KeyP') game.autopilot = !game.autopilot;
    startAudio();
  });
  window.addEventListener('keyup', function (e) {
    var k = MAP[e.code];
    if (k) { keys[k] = false; e.preventDefault(); }
  });

  function readInput() {
    if (game.autopilot) return; // l'autopilote écrit lui-même game.input
    game.input.throttle = keys.up ? 1 : 0;
    game.input.brake = keys.down ? 1 : 0;
    game.input.steer = (keys.left ? 1 : 0) - (keys.right ? 1 : 0); // gauche = +
    game.input.handbrake = !!keys.hand;
  }

  // ------- Son moteur (WebAudio, léger) -------
  var audio = null;
  function startAudio() {
    if (audio) return;
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
      var osc2 = ctx.createOscillator(); osc2.type = 'square';
      var gain = ctx.createGain(); gain.gain.value = 0;
      var filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 900;
      osc1.connect(filt); osc2.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
      osc1.start(); osc2.start();
      audio = { ctx: ctx, osc1: osc1, osc2: osc2, gain: gain, filt: filt };
    } catch (e) { audio = { broken: true }; }
  }
  function updateAudio(dt) {
    if (!audio || audio.broken) return;
    var v = Math.abs(game.car.vx);
    var rpm = 60 + v * 4.2 + game.car.throttle * 26;
    audio.osc1.frequency.setTargetAtTime(rpm, audio.ctx.currentTime, 0.05);
    audio.osc2.frequency.setTargetAtTime(rpm * 0.5, audio.ctx.currentTime, 0.05);
    var target = 0.020 + game.car.throttle * 0.030 + Math.min(v / 60, 1) * 0.012;
    audio.gain.gain.setTargetAtTime(target, audio.ctx.currentTime, 0.08);
    audio.filt.frequency.setTargetAtTime(500 + rpm * 2.2, audio.ctx.currentTime, 0.1);
  }

  // ------- Écran d'accueil -------
  var overlay = document.getElementById('overlay');
  var started = false;
  function start() {
    if (started) return;
    started = true;
    overlay.style.display = 'none';
    startAudio();
  }
  overlay.addEventListener('click', start);
  window.addEventListener('keydown', function (e) {
    if (!started && (e.code === 'Space' || e.code === 'Enter' || MAP[e.code])) start();
  });

  // ------- Boucle -------
  var lastT = performance.now();
  function frame(now) {
    var dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (started) {
      readInput();
      game.step(dt);
    }
    view.updateCar(game.car, dt);
    view.updateCheckpoints(game.cpStates);
    view.render();
    hud.update();
    updateAudio(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', function () { view.resize(); });

  // ------- Crochets de debug / tests automatisés -------
  window.__game = game;
  window.__view = view;
  window.__start = start;
  window.__simulate = function (seconds) { // avance la simulation sans attendre
    var n = Math.round(seconds / GameKit.FIXED_DT);
    for (var i = 0; i < n; i++) game._fixedStep(GameKit.FIXED_DT);
  };
  window.__teleport = function (x, y, heading) {
    game.car.reset(x, y, heading || 0);
    game._fixedStep(GameKit.FIXED_DT);
  };
})();
