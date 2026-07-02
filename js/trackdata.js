/* ============================================================
   SILVERSTONE — géométrie des circuits (module pur, sans THREE)
   Convention 2D : plan (x, y) mathématique, cap θ en radians,
   CCW positif = virage à GAUCHE.  En 3D : (x, 0, -y).
   `turn` = changement de cap signé en degrés (+ = gauche).
   La somme des changements de cap fait -360° (boucle horaire).
   Deux tracés :
     - s1948 : circuit du RAC GP 1948, avec les deux pointes
       rentrantes sur les pistes d'envol (Seagrave / Seaman).
     - s1950 : circuit périmètre du premier GP de F1 (mai 1950) :
       Copse → Maggotts direct (Maggotts devient un gauche),
       Stowe → Club direct (deux droites simples), pointes disparues.
   Le départ est identique : sur Farm Straight, après Abbey.
   ============================================================ */
(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var SCALE = 0.72;          // échelle globale (tracé 1948 réel ~5,9 km)
  var TRACK_W = 14;          // largeur de piste (m)
  var SAMPLE_STEP = 2.5;     // pas d'échantillonnage de la ligne médiane (m)

  // Générateur pseudo-aléatoire déterministe (placement foin / arbres)
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------
     Registre des circuits.
     edges[i] : longueur (m, avant échelle) du segment droit i ;
     corners[i] : virage à la FIN du segment i {turn, r, hay}.
     barrier  : {a, b} indices des deux virages séparés par le mur
                blanc + bottes de foin (1948 uniquement).
     concrete : [{from, to}] plages de virages entre lesquelles le
                sol est en dalles de béton (anciennes runways).
     Le segment 0 est toujours Farm Straight (départ identique).
     ------------------------------------------------------------ */
  var TRACKS = {
    s1948: {
      id: 's1948',
      name: 'Silverstone 1948',
      blurb: 'RAC International Grand Prix — pistes d’envol, Seagrave & Seaman face à face',
      edges: [544.2, 403.9, 620.0, 532.3, 280.0, 380.0, 850.0, 932.3, 520.0, 420.0],
      edgeNames: ['Farm Straight', '', '', '', '', '', 'Hangar Straight', '', '', ''],
      corners: [
        { name: 'Woodcote', turn: -90, r: 55, hay: true },   // 90° à droite
        { name: 'Copse', turn: -110, r: 45, hay: true },   // 70° à droite
        { name: 'Seagrave', turn: 135, r: 22, hay: false },  // 45° à gauche (pointe nord)
        { name: 'Maggotts', turn: -90, r: 50, hay: true },   // 90° à droite
        { name: 'Becketts', turn: -90, r: 50, hay: true },   // 90° à droite
        { name: 'Chapel', turn: 35, r: 120, hay: false },  // courbe à gauche (145°)
        { name: 'Stowe', turn: -160, r: 20, hay: true },   // 20° à droite, bien serré
        { name: 'Seaman', turn: 135, r: 22, hay: false },  // 45° à gauche (pointe sud)
        { name: 'Club', turn: -160, r: 20, hay: true },   // 20° à droite, bien serré
        { name: 'Abbey', turn: 35, r: 120, hay: false }   // courbe à gauche (145°)
      ],
      barrier: { a: 2, b: 7 },                    // Seagrave / Seaman
      concrete: [{ from: 1, to: 2 }, { from: 6, to: 7 }], // Copse→Seagrave, Stowe→Seaman
      finishDistFromAbbeyVertex: 200,
      spawnBackFromFinish: 26,
      seed: 19481002 // 2 octobre 1948
    },
    s1950: {
      id: 's1950',
      name: 'Silverstone 1950',
      blurb: 'Circuit périmètre du premier Grand Prix de F1 — les pointes ont disparu',
      edges: [544.2, 430.0, 480.0, 380.0, 280.0, 950.0, 616.7, 957.5],
      edgeNames: ['Farm Straight', '', '', '', '', 'Hangar Straight', '', ''],
      corners: [
        { name: 'Woodcote', turn: -90, r: 55, hay: true },   // 90° à droite
        { name: 'Copse', turn: -87, r: 50, hay: true },   // à droite, mène droit à Maggotts
        { name: 'Maggotts', turn: 22, r: 150, hay: true },   // devenu un GAUCHE rapide
        { name: 'Becketts', turn: -90, r: 50, hay: true },   // 90° à droite
        { name: 'Chapel', turn: 35, r: 120, hay: false },  // courbe à gauche
        { name: 'Stowe', turn: -105, r: 50, hay: true },   // virage à droite, mène droit à Club
        { name: 'Club', turn: -80, r: 45, hay: true },   // virage à droite simple
        { name: 'Abbey', turn: 35, r: 120, hay: false }   // courbe à gauche
      ],
      barrier: null,
      concrete: [],
      finishDistFromAbbeyVertex: 200, // départ identique à 1948
      spawnBackFromFinish: 26,
      seed: 19500513 // 13 mai 1950 : premier GP du championnat du monde
    }
  };

  function rot(v, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
  }

  function buildTrack(trackId) {
    var SPEC = TRACKS[trackId || 's1948'];
    if (!SPEC) throw new Error('Circuit inconnu : ' + trackId);
    var i, j;
    var n = SPEC.edges.length;
    var lengths = SPEC.edges.map(function (L) { return L * SCALE; });
    var radii = SPEC.corners.map(function (c) { return c.r * SCALE; });

    // Caps successifs des segments droits
    var headings = [0];
    for (i = 0; i < n - 1; i++) headings.push(headings[i] + SPEC.corners[i].turn * DEG);
    var dirs = headings.map(function (h) { return { x: Math.cos(h), y: Math.sin(h) }; });

    // --- Fermeture exacte de la boucle (moindres carrés sur les longueurs) ---
    var rx = 0, ry = 0;
    for (i = 0; i < n; i++) { rx -= lengths[i] * dirs[i].x; ry -= lengths[i] * dirs[i].y; }
    var a11 = 0, a12 = 0, a22 = 0;
    for (i = 0; i < n; i++) { a11 += dirs[i].x * dirs[i].x; a12 += dirs[i].x * dirs[i].y; a22 += dirs[i].y * dirs[i].y; }
    var det = a11 * a22 - a12 * a12;
    var bx = (a22 * rx - a12 * ry) / det, by = (a11 * ry - a12 * rx) / det;
    for (i = 0; i < n; i++) lengths[i] += dirs[i].x * bx + dirs[i].y * by;

    // --- Sommets du polygone (le sommet i est le virage à la fin du segment i) ---
    var verts = [];
    var px = 0, py = 0; // sommet d'Abbey = origine
    for (i = 0; i < n; i++) {
      px += lengths[i] * dirs[i].x; py += lengths[i] * dirs[i].y;
      verts.push({ x: px, y: py });
    }
    var closureError = Math.hypot(verts[n - 1].x, verts[n - 1].y);

    // --- Congés d'arc : points de tangence + centres ---
    var fillets = [];
    for (i = 0; i < n; i++) {
      var turn = SPEC.corners[i].turn * DEG;
      var R = radii[i];
      var t = R * Math.tan(Math.abs(turn) / 2);
      var V = verts[i];
      var uIn = dirs[i], uOut = dirs[(i + 1) % n];
      var Tin = { x: V.x - uIn.x * t, y: V.y - uIn.y * t };
      var Tout = { x: V.x + uOut.x * t, y: V.y + uOut.y * t };
      var side = turn > 0 ? 1 : -1;
      var nrm = rot(uIn, side * Math.PI / 2);
      var C = { x: Tin.x + nrm.x * R, y: Tin.y + nrm.y * R };
      fillets.push({ Tin: Tin, Tout: Tout, C: C, R: R, turn: turn, t: t, vertex: V });
    }

    // --- Échantillonnage de la ligne médiane ---
    var samples = [];
    var sAcc = 0;

    function pushSample(x, y, heading, curv, cornerIdx) {
      if (samples.length) {
        var p = samples[samples.length - 1];
        sAcc += Math.hypot(x - p.x, y - p.y);
      }
      samples.push({ x: x, y: y, s: sAcc, heading: heading, curv: curv, corner: cornerIdx });
    }

    function sampleStraight(from, to, heading, skipFirst) {
      var d = Math.hypot(to.x - from.x, to.y - from.y);
      var steps = Math.max(1, Math.round(d / SAMPLE_STEP));
      for (var k = skipFirst ? 1 : 0; k <= steps; k++) {
        var f = k / steps;
        pushSample(from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f, heading, 0, -1);
      }
    }

    var cornerMeta = [];

    function sampleArc(f, cornerIdx) {
      var a0 = Math.atan2(f.Tin.y - f.C.y, f.Tin.x - f.C.x);
      var steps = Math.max(4, Math.ceil(Math.abs(f.turn) / (2.2 * DEG)));
      var entryIdx = samples.length - 1;
      for (var k = 1; k <= steps; k++) {
        var a = a0 + f.turn * (k / steps);
        var x = f.C.x + Math.cos(a) * f.R;
        var y = f.C.y + Math.sin(a) * f.R;
        var heading = a + (f.turn > 0 ? 1 : -1) * Math.PI / 2;
        pushSample(x, y, heading, (f.turn > 0 ? 1 : -1) / f.R, cornerIdx);
      }
      cornerMeta[cornerIdx] = {
        entryIdx: entryIdx,
        midIdx: entryIdx + Math.round(steps / 2),
        exitIdx: samples.length - 1
      };
    }

    var start = fillets[n - 1].Tout; // sortie d'Abbey
    pushSample(start.x, start.y, headings[0], 0, -1);
    for (i = 0; i < n; i++) {
      var from = (i === 0) ? start : fillets[i - 1].Tout;
      sampleStraight(from, fillets[i].Tin, headings[i], true);
      sampleArc(fillets[i], i);
    }
    var S = samples[samples.length - 1].s;
    samples.pop(); // le dernier point reboucle sur le premier

    for (i = 0; i < samples.length; i++) {
      var h = samples[i].heading;
      while (h > Math.PI) h -= 2 * Math.PI;
      while (h < -Math.PI) h += 2 * Math.PI;
      samples[i].heading = h;
    }

    // --- Ligne d'arrivée & départ (sur Farm Straight) ---
    var tAbbey = fillets[n - 1].t;
    var finishRaw = SPEC.finishDistFromAbbeyVertex * SCALE - tAbbey;
    var finish = {
      x: start.x + dirs[0].x * finishRaw,
      y: start.y + dirs[0].y * finishRaw,
      heading: headings[0],
      sRaw: finishRaw
    };
    var spawnRaw = finishRaw - SPEC.spawnBackFromFinish;
    var spawn = {
      x: start.x + dirs[0].x * spawnRaw,
      y: start.y + dirs[0].y * spawnRaw,
      heading: headings[0]
    };

    function rebase(sRaw) { var s = sRaw - finishRaw; if (s < 0) s += S; return s; }
    for (i = 0; i < samples.length; i++) samples[i].s = rebase(samples[i].s);

    // --- Points de contrôle : au milieu de chaque virage, SUR la ligne médiane ---
    var checkpoints = [];
    for (i = 0; i < n; i++) {
      var m = samples[cornerMeta[i].midIdx];
      checkpoints.push({
        name: SPEC.corners[i].name,
        s: m.s, x: m.x, y: m.y, heading: m.heading,
        rVisual: 5.5
      });
    }
    checkpoints.sort(function (a, b) { return a.s - b.s; });

    var rng = mulberry32(SPEC.seed);
    var bales = [];
    var BALE = { lx: 1.45, ly: 0.85, h: 0.8, collR: 0.85 };

    function addBale(x, y, yaw) {
      bales.push({ x: x, y: y, yaw: yaw + (rng() - 0.5) * 0.22 });
    }

    // --- Barrière entre deux virages (1948 : Seagrave / Seaman) ---
    var walls = [];
    var barrier = null;
    if (SPEC.barrier) {
      var idxA = cornerMeta[SPEC.barrier.a].midIdx, idxB = cornerMeta[SPEC.barrier.b].midIdx;
      var apexA = samples[idxA], apexB = samples[idxB];
      var mid = { x: (apexA.x + apexB.x) / 2, y: (apexA.y + apexB.y) / 2 };
      var axis = { x: apexB.x - apexA.x, y: apexB.y - apexA.y };
      var axisLen = Math.hypot(axis.x, axis.y);
      axis.x /= axisLen; axis.y /= axisLen;
      var wdir = { x: -axis.y, y: axis.x };
      var wallHalf = 18;
      walls.push({
        x1: mid.x - wdir.x * wallHalf, y1: mid.y - wdir.y * wallHalf,
        x2: mid.x + wdir.x * wallHalf, y2: mid.y + wdir.y * wallHalf,
        thickness: 0.5, height: 1.15
      });
      barrier = { mid: mid, axis: axis, wdir: wdir, apexSg: apexA, apexSm: apexB, gap: axisLen };

      // deux rangées de bottes de part et d'autre du mur blanc
      for (var row = -1; row <= 1; row += 2) {
        var off = 2.1, count = 25;
        for (var k = 0; k < count; k++) {
          var wpos = -wallHalf - 0.8 + (k / (count - 1)) * (2 * wallHalf + 1.6);
          addBale(mid.x + wdir.x * wpos + axis.x * off * row,
            mid.y + wdir.y * wpos + axis.y * off * row,
            Math.atan2(wdir.y, wdir.x));
        }
      }
    }

    // --- Bottes de foin à l'extérieur des virages protégés ---
    for (i = 0; i < n; i++) {
      if (!SPEC.corners[i].hay) continue;
      var meta = cornerMeta[i];
      var sideOut = SPEC.corners[i].turn > 0 ? -1 : 1;
      var stride = Math.max(1, Math.round(2.4 / (S / samples.length)));
      for (j = meta.entryIdx - 2 * stride; j <= meta.exitIdx + 2 * stride; j += stride) {
        var sm = samples[(j + samples.length) % samples.length];
        var lat = TRACK_W / 2 + 2.6;
        var nx = -Math.sin(sm.heading), ny = Math.cos(sm.heading);
        addBale(sm.x + nx * lat * sideOut, sm.y + ny * lat * sideOut, sm.heading);
      }
    }

    // --- Plages en dalles de béton (anciennes pistes d'envol) ---
    var concreteRanges = [];
    for (i = 0; i < SPEC.concrete.length; i++) {
      concreteRanges.push([
        cornerMeta[SPEC.concrete[i].from].exitIdx,
        cornerMeta[SPEC.concrete[i].to].exitIdx
      ]);
    }

    // --- Panneaux de virage ---
    var signs = [];
    for (i = 0; i < n; i++) {
      var f2 = fillets[i];
      var hIn2 = headings[i];
      var sideOut2 = SPEC.corners[i].turn > 0 ? -1 : 1;
      var nx2 = -Math.sin(hIn2), ny2 = Math.cos(hIn2);
      var back = 14;
      signs.push({
        name: SPEC.corners[i].name.toUpperCase(),
        x: f2.Tin.x - Math.cos(hIn2) * back + nx2 * sideOut2 * (TRACK_W / 2 + 6.5),
        y: f2.Tin.y - Math.sin(hIn2) * back + ny2 * sideOut2 * (TRACK_W / 2 + 6.5),
        heading: hIn2
      });
    }

    // --- Boîte englobante ---
    var bbox = { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 };
    for (i = 0; i < samples.length; i++) {
      var sp = samples[i];
      if (sp.x < bbox.minX) bbox.minX = sp.x;
      if (sp.x > bbox.maxX) bbox.maxX = sp.x;
      if (sp.y < bbox.minY) bbox.minY = sp.y;
      if (sp.y > bbox.maxY) bbox.maxY = sp.y;
    }

    var trees = [];
    var trackObj = {
      id: SPEC.id, name: SPEC.name, blurb: SPEC.blurb,
      samples: samples, S: S, width: TRACK_W,
      checkpoints: checkpoints, finish: finish, spawn: spawn,
      walls: walls, bales: bales, baleDims: BALE,
      barrier: barrier, concreteRanges: concreteRanges,
      signs: signs, bbox: bbox, trees: trees,
      closureError: closureError, cornerMeta: cornerMeta, spec: SPEC,
      verts: verts, lengths: lengths, headings: headings
    };
    buildGrid(trackObj);

    // --- Arbres décoratifs (hors piste, hors barrière) ---
    var margin = 120;
    var tries = 0;
    while (trees.length < 46 && tries < 4000) {
      tries++;
      var tx = bbox.minX - margin + rng() * (bbox.maxX - bbox.minX + 2 * margin);
      var ty = bbox.minY - margin + rng() * (bbox.maxY - bbox.minY + 2 * margin);
      var pr = projectToTrack(trackObj, tx, ty);
      if (pr.dist < TRACK_W / 2 + 16) continue;
      if (barrier && Math.hypot(tx - barrier.mid.x, ty - barrier.mid.y) < 55) continue;
      var okT = true;
      for (j = 0; j < trees.length; j++) {
        if (Math.hypot(tx - trees[j].x, ty - trees[j].y) < 22) { okT = false; break; }
      }
      if (okT) trees.push({ x: tx, y: ty, scale: 0.8 + rng() * 0.9 });
    }

    return trackObj;
  }

  /* --- Grille spatiale pour la projection point → piste --- */
  function buildGrid(track) {
    var cell = 24;
    var g = { cell: cell, map: {}, minX: track.bbox.minX - 40, minY: track.bbox.minY - 40 };
    for (var i = 0; i < track.samples.length; i++) {
      var sp = track.samples[i];
      var cx = Math.floor((sp.x - g.minX) / cell), cy = Math.floor((sp.y - g.minY) / cell);
      var key = cx + ',' + cy;
      (g.map[key] || (g.map[key] = [])).push(i);
    }
    track.grid = g;
  }

  /* Projection : renvoie {dist, lat, s, idx, heading}. lat > 0 : à gauche. */
  function projectToTrack(track, x, y) {
    var g = track.grid, samples = track.samples, nS = samples.length;
    var cx = Math.floor((x - g.minX) / g.cell), cy = Math.floor((y - g.minY) / g.cell);
    var best = -1, bestD2 = Infinity;
    for (var ring = 0; ring <= 12; ring++) {
      for (var dx = -ring; dx <= ring; dx++) {
        for (var dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          var lst = g.map[(cx + dx) + ',' + (cy + dy)];
          if (!lst) continue;
          for (var k = 0; k < lst.length; k++) {
            var sp = samples[lst[k]];
            var d2 = (sp.x - x) * (sp.x - x) + (sp.y - y) * (sp.y - y);
            if (d2 < bestD2) { bestD2 = d2; best = lst[k]; }
          }
        }
      }
      if (best >= 0 && ring >= 1 && bestD2 < (ring * g.cell) * (ring * g.cell)) break;
    }
    if (best < 0) {
      for (var q = 0; q < nS; q++) {
        var spq = samples[q];
        var dq = (spq.x - x) * (spq.x - x) + (spq.y - y) * (spq.y - y);
        if (dq < bestD2) { bestD2 = dq; best = q; }
      }
    }
    var result = null;
    for (var o = -1; o <= 0; o++) {
      var i0 = (best + o + nS) % nS, i1 = (i0 + 1) % nS;
      var A = samples[i0], B = samples[i1];
      var abx = B.x - A.x, aby = B.y - A.y;
      var L2 = abx * abx + aby * aby;
      if (L2 < 1e-9) continue;
      var t = ((x - A.x) * abx + (y - A.y) * aby) / L2;
      t = Math.max(0, Math.min(1, t));
      var qx = A.x + abx * t, qy = A.y + aby * t;
      var d = Math.hypot(x - qx, y - qy);
      if (!result || d < result.dist) {
        var segLen = Math.sqrt(L2);
        var sHere = A.s + segLen * t;
        if (sHere >= track.S) sHere -= track.S;
        var cross = abx * (y - qy) - aby * (x - qx);
        result = {
          dist: d, lat: cross >= 0 ? d : -d, s: sHere,
          idx: best, heading: Math.atan2(aby, abx)
        };
      }
    }
    return result;
  }

  /* Échantillon le plus proche d'une station donnée (autopilote) */
  function sampleAtStation(track, s) {
    var S = track.S;
    s = ((s % S) + S) % S;
    var samples = track.samples, n = samples.length;
    if (track._sOrder === undefined) {
      var order = [];
      for (var i = 0; i < n; i++) order.push(i);
      order.sort(function (a, b) { return samples[a].s - samples[b].s; });
      track._sOrder = order;
    }
    var lo = 0, hi = n - 1, ord = track._sOrder;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (samples[ord[mid]].s < s) lo = mid + 1; else hi = mid;
    }
    return samples[ord[lo % n]];
  }

  function trackList() {
    var out = [];
    for (var id in TRACKS) out.push({ id: id, name: TRACKS[id].name, blurb: TRACKS[id].blurb });
    return out;
  }

  var TrackKit = {
    buildTrack: buildTrack,
    projectToTrack: projectToTrack,
    sampleAtStation: sampleAtStation,
    trackList: trackList,
    TRACKS: TRACKS,
    TRACK_W: TRACK_W,
    SCALE: SCALE
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TrackKit;
  else global.TrackKit = TrackKit;
})(typeof window !== 'undefined' ? window : globalThis);
