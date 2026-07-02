/* ============================================================
   HUD (DOM + canvas minimap) :
   - bannière « Hors-Piste ! » (rouge) → verte 1 s au retour
   - chronos (tour courant / dernier / meilleur), compteur CP
   - vitesse, messages de tour, minimap avec état des CP
   ============================================================ */
(function (global) {
  'use strict';

  var fmt = function (t) { return global.GameKit.formatTime(t); };

  function HUD(game) {
    this.game = game;
    this.banner = document.getElementById('banner');
    this.speedEl = document.getElementById('speed');
    this.lapEl = document.getElementById('laptimes');
    this.cpEl = document.getElementById('cpcount');
    this.msgEl = document.getElementById('lapmsg');
    this.autoEl = document.getElementById('autopilot');
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    this._buildMapBase();
  }

  HUD.prototype._buildMapBase = function () {
    var track = this.game.track, bb = track.bbox;
    var Wpx = this.map.width, Hpx = this.map.height, pad = 14;
    var sx = (Wpx - 2 * pad) / (bb.maxX - bb.minX);
    var sy = (Hpx - 2 * pad) / (bb.maxY - bb.minY);
    var sc = this.mapScale = Math.min(sx, sy);
    var ox = (Wpx - sc * (bb.maxX - bb.minX)) / 2;
    var oy = (Hpx - sc * (bb.maxY - bb.minY)) / 2;
    this.mapX = function (x) { return ox + (x - bb.minX) * sc; };
    this.mapY = function (y) { return Hpx - (oy + (y - bb.minY) * sc); };

    var off = this.mapBase = document.createElement('canvas');
    off.width = Wpx; off.height = Hpx;
    var ctx = off.getContext('2d');
    ctx.fillStyle = 'rgba(12, 24, 12, 0.55)';
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(0, 0, Wpx, Hpx, 10); ctx.fill(); }
    else ctx.fillRect(0, 0, Wpx, Hpx);
    // tracé
    ctx.strokeStyle = '#c9cdd3';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    var samples = track.samples;
    for (var i = 0; i < samples.length; i += 2) {
      var p = samples[i];
      if (i === 0) ctx.moveTo(this.mapX(p.x), this.mapY(p.y));
      else ctx.lineTo(this.mapX(p.x), this.mapY(p.y));
    }
    ctx.closePath();
    ctx.stroke();
    // ligne d'arrivée
    var f = track.finish, nx = -Math.sin(f.heading), ny = Math.cos(f.heading);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.mapX(f.x - nx * 12), this.mapY(f.y - ny * 12));
    ctx.lineTo(this.mapX(f.x + nx * 12), this.mapY(f.y + ny * 12));
    ctx.stroke();
    // mur blanc de la barrière (s'il existe sur ce circuit)
    if (track.walls.length) {
      var w = track.walls[0];
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.mapX(w.x1), this.mapY(w.y1));
      ctx.lineTo(this.mapX(w.x2), this.mapY(w.y2));
      ctx.stroke();
    }
  };

  HUD.prototype.update = function () {
    var game = this.game;

    // --- Bannière hors-piste ---
    var b = game.banner;
    if (b.mode === 'off') {
      this.banner.style.display = 'block';
      this.banner.style.background = '#d11f1f';
      this.banner.textContent = 'Hors-Piste !';
      this.banner.style.opacity = '1';
    } else if (b.mode === 'back') {
      this.banner.style.display = 'block';
      this.banner.style.background = '#1fae3d';
      this.banner.textContent = 'Sur la piste';
      this.banner.style.opacity = String(Math.max(0.25, Math.min(1, b.timer / 0.6)));
    } else {
      this.banner.style.display = 'none';
    }

    // --- Vitesse ---
    var kmh = Math.abs(game.car.vx) * 3.6;
    this.speedEl.textContent = kmh.toFixed(0) + ' km/h';

    // --- Chronos ---
    var cur = game.lapStartTime === null ? null : game.simTime - game.lapStartTime;
    this.lapEl.innerHTML =
      'Tour&nbsp;: <b>' + fmt(cur) + '</b><br>' +
      'Dernier&nbsp;: ' + fmt(game.lastLapTime) + '<br>' +
      'Meilleur&nbsp;: ' + fmt(game.bestLapTime) + '<br>' +
      'Tours validés&nbsp;: ' + game.lapCount;

    // --- Compteur CP ---
    var next = game.cpNext < game.cpCount ? game.track.checkpoints[game.cpNext].name : '→ Ligne d\'arrivée';
    this.cpEl.innerHTML = 'Points de contrôle&nbsp;: <b>' + game.cpNext + '/' + game.cpCount + '</b>' +
      '<br><span class="dim">Prochain&nbsp;: ' + next + '</span>';

    // --- Message de tour ---
    if (game.message && game.simTime < game.message.until) {
      this.msgEl.style.display = 'block';
      this.msgEl.textContent = game.message.text;
      this.msgEl.className = game.message.kind === 'ok' ? 'ok' : 'ko';
    } else this.msgEl.style.display = 'none';

    this.autoEl.style.display = game.autopilot ? 'block' : 'none';

    this._drawMap();
  };

  HUD.prototype._drawMap = function () {
    var ctx = this.mapCtx, game = this.game;
    ctx.clearRect(0, 0, this.map.width, this.map.height);
    ctx.drawImage(this.mapBase, 0, 0);
    // points de contrôle
    for (var i = 0; i < game.track.checkpoints.length; i++) {
      var cp = game.track.checkpoints[i];
      ctx.fillStyle = game.cpStates[i] ? '#2ecc40' : '#e33';
      ctx.beginPath();
      ctx.arc(this.mapX(cp.x), this.mapY(cp.y), 3.4, 0, 7);
      ctx.fill();
    }
    // voiture
    var car = game.car;
    var x = this.mapX(car.x), y = this.mapY(car.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-car.heading + Math.PI / 2);
    ctx.fillStyle = '#ffd23c';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  global.HUD = HUD;
})(window);
