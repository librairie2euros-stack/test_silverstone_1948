/* ============================================================
   Point d'entrée : menu de sélection de circuit, boucle de jeu,
   entrées clavier, son moteur.
   Clavier par position physique (event.code) : fonctionne en
   AZERTY (ZQSD) comme en QWERTY (WASD), plus les flèches.
   ============================================================ */
(function () {
  'use strict';

  var view = new Renderer3D(document.getElementById('scene'));
  var game = null;
  var hud = null;
  var started = false;
  var trackCache = {};

  function getTrack(id) {
    if (!trackCache[id]) trackCache[id] = TrackKit.buildTrack(id);
    return trackCache[id];
  }

  // ------- Menu de sélection de circuit -------
  var overlay = document.getElementById('overlay');
  var cardsBox = document.getElementById('trackcards');

  function drawThumb(canvas, track) {
    var ctx = canvas.getContext('2d');
    var bb = track.bbox, pad = 12;
    var sc = Math.min((canvas.width - 2 * pad) / (bb.maxX - bb.minX),
      (canvas.height - 2 * pad) / (bb.maxY - bb.minY));
    var ox = (canvas.width - sc * (bb.maxX - bb.minX)) / 2;
    var oy = (canvas.height - sc * (bb.maxY - bb.minY)) / 2;
    var X = function (x) { return ox + (x - bb.minX) * sc; };
    var Y = function (y) { return canvas.height - (oy + (y - bb.minY) * sc); };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#d8dce2';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var i = 0; i < track.samples.length; i += 3) {
      var p = track.samples[i];
      if (i === 0) ctx.moveTo(X(p.x), Y(p.y));
      else ctx.lineTo(X(p.x), Y(p.y));
    }
    ctx.closePath();
    ctx.stroke();
    // barrière 1948
    if (track.walls.length) {
      var w = track.walls[0];
      ctx.strokeStyle = '#ffd23c'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(w.x1), Y(w.y1)); ctx.lineTo(X(w.x2), Y(w.y2));
      ctx.stroke();
    }
    // départ
    var f = track.finish;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(X(f.x), Y(f.y), 3, 0, 7); ctx.fill();
  }

  function buildMenu() {
    cardsBox.innerHTML = '';
    TrackKit.trackList().forEach(function (info) {
      var track = getTrack(info.id);
      var card = document.createElement('div');
      card.className = 'trackcard';
      var cv = document.createElement('canvas');
      cv.width = 204; cv.height = 130;
      card.appendChild(cv);
      var b = document.createElement('b');
      b.textContent = info.name;
      card.appendChild(b);
      var len = document.createElement('span');
      len.className = 'len';
      len.textContent = (track.S / 1000).toFixed(2).replace('.', ',') + ' km — ' +
        track.checkpoints.length + ' points de contrôle';
      card.appendChild(len);
      var sp = document.createElement('span');
      sp.textContent = info.blurb;
      card.appendChild(sp);
      drawThumb(cv, track);
      card.addEventListener('click', function () { startGame(info.id); });
      cardsBox.appendChild(card);
    });
  }

  function startGame(trackId) {
    var track = getTrack(trackId);
    game = new GameKit.Game({ track: track });
    view.loadTrack(track);
    hud = new HUD(game);
    started = true;
    overlay.style.display = 'none';
    startAudio();
  }

  function showMenu() {
    started = false;
    overlay.style.display = 'flex';
  }

  buildMenu();

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
    if (!game) return;
    if (e.code === 'KeyR' && started) game.resetCar();
    if (e.code === 'KeyC') view.cameraMode = (view.cameraMode + 1) % 3;
    if (e.code === 'KeyP' && started) game.autopilot = !game.autopilot;
    if (e.code === 'Escape') { if (started) showMenu(); }
  });
  window.addEventListener('keyup', function (e) {
    var k = MAP[e.code];
    if (k) { keys[k] = false; e.preventDefault(); }
  });

  function readInput() {
    if (!game || game.autopilot) return;
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
    if (!audio || audio.broken || !game) return;
    var v = Math.abs(game.car.vx);
    var rpm = 60 + v * 4.2 + game.car.throttle * 26;
    var muted = !started;
    audio.osc1.frequency.setTargetAtTime(rpm, audio.ctx.currentTime, 0.05);
    audio.osc2.frequency.setTargetAtTime(rpm * 0.5, audio.ctx.currentTime, 0.05);
    var target = muted ? 0 : 0.020 + game.car.throttle * 0.030 + Math.min(v / 60, 1) * 0.012;
    audio.gain.gain.setTargetAtTime(target, audio.ctx.currentTime, 0.08);
    audio.filt.frequency.setTargetAtTime(500 + rpm * 2.2, audio.ctx.currentTime, 0.1);
  }

  // ------- Boucle -------
  var lastT = performance.now();
  function frame(now) {
    var dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (game) {
      if (started) {
        readInput();
        game.step(dt);
      }
      view.updateCar(game.car, dt);
      view.updateCheckpoints(game.cpStates);
      view.render();
      hud.update();
    }
    updateAudio(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', function () { view.resize(); });

  // ------- Crochets de debug / tests automatisés -------
  window.__getGame = function () { return game; };
  window.__view = view;
  window.__startGame = startGame;
  window.__simulate = function (seconds) {
    var n = Math.round(seconds / GameKit.FIXED_DT);
    for (var i = 0; i < n; i++) game._fixedStep(GameKit.FIXED_DT);
  };
  window.__teleport = function (x, y, heading) {
    game.car.reset(x, y, heading || 0);
    game._fixedStep(GameKit.FIXED_DT);
  };
  // rétro-compatibilité avec les anciens scripts de test
  Object.defineProperty(window, '__game', { get: function () { return game; } });
  window.__start = function () { if (!started) startGame('s1948'); };
})();
