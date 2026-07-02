/* ============================================================
   Rendu 3D (THREE r147) — construit la scène à partir des
   données de piste pures et anime voiture / caméra / ombres.
   Plan 2D (x, y) → monde 3D (x, 0, -y).
   ============================================================ */
(function (global) {
  'use strict';

  function W3(p) { return new THREE.Vector3(p.x, 0, -p.y); }

  function makeNoiseTexture(base, spots, size, density, spotSize) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (var i = 0; i < density; i++) {
      ctx.fillStyle = spots[i % spots.length];
      ctx.globalAlpha = 0.10 + Math.random() * 0.18;
      var r = spotSize * (0.5 + Math.random());
      ctx.beginPath();
      ctx.arc(Math.random() * size, Math.random() * size, r, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    var tx = new THREE.CanvasTexture(cv);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.encoding = THREE.sRGBEncoding;
    return tx;
  }

  /* Dalles de béton d'aérodrome : 2×2 dalles par tuile, joints sombres,
     teinte légèrement différente par dalle + mouchetis. */
  function makeConcreteTexture() {
    var size = 256;
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var ctx = cv.getContext('2d');
    var tints = ['#a8a9a1', '#9fa099', '#b0b1a9', '#a4a59e'];
    for (var sy = 0; sy < 2; sy++) {
      for (var sx = 0; sx < 2; sx++) {
        ctx.fillStyle = tints[(sx + sy * 2)];
        ctx.fillRect(sx * 128, sy * 128, 128, 128);
      }
    }
    // mouchetis + taches d'usure
    for (var i = 0; i < 900; i++) {
      var g = 120 + Math.floor(Math.random() * 90);
      ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + (g - 4) + ')';
      ctx.globalAlpha = 0.10 + Math.random() * 0.16;
      var r = 0.6 + Math.random() * 2.2;
      ctx.beginPath();
      ctx.arc(Math.random() * size, Math.random() * size, r, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 0.10;
    for (var st = 0; st < 8; st++) {
      ctx.fillStyle = '#6e6f68';
      ctx.beginPath();
      ctx.ellipse(Math.random() * size, Math.random() * size, 12 + Math.random() * 26, 5 + Math.random() * 9, Math.random() * 3, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // joints entre dalles
    ctx.strokeStyle = '#6f7069';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 128); ctx.lineTo(size, 128);
    ctx.moveTo(128, 0); ctx.lineTo(128, size);
    ctx.stroke();
    ctx.strokeStyle = '#7d7e76';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, size, size);
    var tx = new THREE.CanvasTexture(cv);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.encoding = THREE.sRGBEncoding;
    return tx;
  }

  function makeTextTexture(text, w, h, fg, bg, border) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 10; ctx.strokeRect(5, 5, w - 10, h - 10); }
    ctx.fillStyle = fg;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var fs = Math.floor(h * 0.52);
    do { ctx.font = '700 ' + fs + 'px system-ui, sans-serif'; fs -= 2; }
    while (ctx.measureText(text).width > w * 0.88 && fs > 8);
    ctx.fillText(text, w / 2, h / 2 + 2);
    var tx = new THREE.CanvasTexture(cv);
    tx.encoding = THREE.sRGBEncoding;
    return tx;
  }

  function Renderer3D(canvas) {
    var renderer = this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 3000);
    this.cameraMode = 0; // 0 poursuite, 1 capot, 2 vue du ciel
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this._camInit = false;
    this.scene = null;
    this.track = null;
  }

  /* Libère proprement la scène courante (changement de circuit). */
  Renderer3D.prototype._disposeScene = function () {
    if (!this.scene) return;
    this.scene.traverse(function (obj) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (var i = 0; i < mats.length; i++) {
          if (mats[i].map) mats[i].map.dispose();
          mats[i].dispose();
        }
      }
    });
    this.scene = null;
  };

  /* Construit (ou reconstruit) toute la scène pour un circuit donné. */
  Renderer3D.prototype.loadTrack = function (track) {
    this._disposeScene();
    this.track = track;
    this._camInit = false;

    var scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9ec8ec);
    scene.fog = new THREE.Fog(0xaed0ea, 350, 1500);

    // --- Lumières ---
    var hemi = new THREE.HemisphereLight(0xcfe6ff, 0x59783f, 0.65);
    scene.add(hemi);
    var sun = this.sun = new THREE.DirectionalLight(0xfff3dd, 1.15);
    sun.position.set(180, 260, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
    sun.shadow.camera.near = 40; sun.shadow.camera.far = 700;
    sun.shadow.camera.updateProjectionMatrix(); // indispensable après modification du frustum
    sun.shadow.bias = -0.0004;
    scene.add(sun); scene.add(sun.target);

    this._buildGround();
    this._buildTrackRibbon();
    this._buildFinishLine();
    this._buildCheckpoints();
    this._buildBales();
    this._buildWalls();
    this._buildSigns();
    this._buildTrees();
    this._buildCar();
  };

  /* ------------------------- Sol ------------------------- */
  Renderer3D.prototype._buildGround = function () {
    var bb = this.track.bbox;
    var cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
    var w = bb.maxX - bb.minX + 700, h = bb.maxY - bb.minY + 700;
    var tex = makeNoiseTexture('#598f3f', ['#4c8036', '#639a47', '#547d31', '#6aa14e'], 256, 260, 9);
    tex.repeat.set(w / 22, h / 22);
    var mat = new THREE.MeshLambertMaterial({ map: tex });
    var geo = new THREE.PlaneGeometry(w, h);
    var mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cx, -0.03, -cy);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  };

  /* --------------------- Ruban de piste --------------------- */
  /* Bande entre deux décalages latéraux (gauche +).
     Sans i0/i1 : boucle fermée complète. Avec i0/i1 : tronçon ouvert
     (utilisé pour les dalles de béton des pistes d'envol). */
  Renderer3D.prototype._ribbonGeometry = function (latA, latB, y, i0, i1, uScale) {
    var samples = this.track.samples, n = samples.length;
    var closed = (i0 === undefined);
    var count = closed ? n + 1 : (i1 - i0 + 1);
    uScale = uScale || 8;
    var pos = new Float32Array(count * 2 * 3);
    var uv = new Float32Array(count * 2 * 2);
    var idx = [];
    var s0 = closed ? 0 : samples[i0].s;
    for (var k = 0; k < count; k++) {
      var sp = closed ? samples[k % n] : samples[i0 + k];
      var nx = -Math.sin(sp.heading), ny = Math.cos(sp.heading);
      var o = k * 6;
      pos[o] = sp.x + nx * latA; pos[o + 1] = y; pos[o + 2] = -(sp.y + ny * latA);
      pos[o + 3] = sp.x + nx * latB; pos[o + 4] = y; pos[o + 5] = -(sp.y + ny * latB);
      var u = ((closed && k === n ? this.track.S : sp.s) - s0) / uScale;
      uv[k * 4] = u; uv[k * 4 + 1] = 0; uv[k * 4 + 2] = u; uv[k * 4 + 3] = 1;
      if (k < count - 1) {
        var a = k * 2, b = k * 2 + 1, c = k * 2 + 2, d = k * 2 + 3;
        idx.push(a, b, c, b, d, c);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };

  Renderer3D.prototype._buildTrackRibbon = function () {
    var W = this.track.width;
    var tex = makeNoiseTexture('#3f4145', ['#37393d', '#46484d', '#3a3c40', '#505257'], 256, 300, 7);
    tex.repeat.set(1, 1);
    var mat = new THREE.MeshLambertMaterial({ map: tex });
    var mesh = new THREE.Mesh(this._ribbonGeometry(W / 2, -W / 2, 0), mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Pistes d'envol en dalles de béton (plages définies par le circuit ;
    // 1948 : Copse → Seagrave et Stowe → Seaman ; dalles ~7 m, joints visibles)
    var runways = this.track.concreteRanges || [];
    if (runways.length) {
      var concMat = new THREE.MeshLambertMaterial({ map: makeConcreteTexture() });
      for (var rw = 0; rw < runways.length; rw++) {
        var rMesh = new THREE.Mesh(
          this._ribbonGeometry(W / 2, -W / 2, 0.012, runways[rw][0], runways[rw][1], 14),
          concMat);
        rMesh.receiveShadow = true;
        this.scene.add(rMesh);
      }
    }

    var lineMat = new THREE.MeshBasicMaterial({ color: 0xe8e6e0 });
    var l1 = new THREE.Mesh(this._ribbonGeometry(W / 2 - 0.25, W / 2 - 0.65, 0.02), lineMat);
    var l2 = new THREE.Mesh(this._ribbonGeometry(-W / 2 + 0.65, -W / 2 + 0.25, 0.02), lineMat);
    this.scene.add(l1); this.scene.add(l2);
  };

  /* --------------------- Ligne d'arrivée --------------------- */
  Renderer3D.prototype._buildFinishLine = function () {
    var f = this.track.finish, W = this.track.width;
    var geo = new THREE.PlaneGeometry(4, W - 0.8); // épaisse : 4 m dans le sens de la course
    var mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -f.heading; // plan XY→XZ : heading 2D autour de -y
    mesh.position.set(f.x, 0.03, -f.y);
    this.scene.add(mesh);

    // petit portique : deux poteaux blancs de part et d'autre
    var postGeo = new THREE.CylinderGeometry(0.12, 0.12, 3.2, 8);
    var postMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    var nx = -Math.sin(f.heading), ny = Math.cos(f.heading);
    for (var s = -1; s <= 1; s += 2) {
      var post = new THREE.Mesh(postGeo, postMat);
      post.position.set(f.x + nx * s * (W / 2 + 1.2), 1.6, -(f.y + ny * s * (W / 2 + 1.2)));
      post.castShadow = true;
      this.scene.add(post);
      var flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75),
        new THREE.MeshBasicMaterial({ map: makeTextTexture('1948', 128, 96, '#111', '#fff'), side: THREE.DoubleSide }));
      flag.position.set(f.x + nx * s * (W / 2 + 1.2), 3.0, -(f.y + ny * s * (W / 2 + 1.2)));
      flag.rotation.y = f.heading + Math.PI / 2;
      this.scene.add(flag);
    }
  };

  /* --------------------- Points de contrôle --------------------- */
  Renderer3D.prototype._buildCheckpoints = function () {
    this.cpMeshes = [];
    for (var i = 0; i < this.track.checkpoints.length; i++) {
      var cp = this.track.checkpoints[i];
      var geo = new THREE.CircleGeometry(cp.rVisual, 40);
      var mat = new THREE.MeshBasicMaterial({ color: 0xd02020, transparent: true, opacity: 0.85 });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cp.x, 0.025, -cp.y);
      this.scene.add(mesh);
      this.cpMeshes.push(mesh);
    }
  };

  Renderer3D.prototype.updateCheckpoints = function (states) {
    for (var i = 0; i < this.cpMeshes.length; i++) {
      this.cpMeshes[i].material.color.setHex(states[i] ? 0x22bb44 : 0xd02020);
    }
  };

  /* --------------------- Bottes de foin --------------------- */
  Renderer3D.prototype._buildBales = function () {
    var bales = this.track.bales, dims = this.track.baleDims;
    var geo = new THREE.BoxGeometry(dims.lx, dims.h, dims.ly);
    var tex = makeNoiseTexture('#d3ab55', ['#c39a45', '#e0bc68', '#b98f3e'], 128, 150, 5);
    var mat = new THREE.MeshLambertMaterial({ map: tex });
    var inst = new THREE.InstancedMesh(geo, mat, bales.length);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    var col = new THREE.Color();
    for (var i = 0; i < bales.length; i++) {
      var b = bales[i];
      q.setFromAxisAngle(up, b.yaw);
      m4.compose(new THREE.Vector3(b.x, dims.h / 2, -b.y), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m4);
      col.setHSL(0.115 + (i % 7) * 0.004, 0.55, 0.55 + (i % 5) * 0.02);
      inst.setColorAt(i, col);
    }
    inst.castShadow = true; inst.receiveShadow = true;
    this.scene.add(inst);
  };

  /* --------------------- Murs --------------------- */
  Renderer3D.prototype._buildWalls = function () {
    var walls = this.track.walls;
    var mat = new THREE.MeshLambertMaterial({ color: 0xf5f5f2 });
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      var len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      var geo = new THREE.BoxGeometry(len, w.height, w.thickness);
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((w.x1 + w.x2) / 2, w.height / 2, -(w.y1 + w.y2) / 2);
      mesh.rotation.y = Math.atan2(w.y2 - w.y1, w.x2 - w.x1); // angle 2D → yaw 3D
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  };

  /* --------------------- Panneaux de virage --------------------- */
  Renderer3D.prototype._buildSigns = function () {
    var signs = this.track.signs;
    var postGeo = new THREE.BoxGeometry(0.14, 2.2, 0.14);
    var postMat = new THREE.MeshLambertMaterial({ color: 0x6b6b6b });
    for (var i = 0; i < signs.length; i++) {
      var sg = signs[i];
      var tex = makeTextTexture(sg.name, 512, 128, '#111111', '#f7f4ea', '#b32020');
      var board = new THREE.Mesh(
        new THREE.PlaneGeometry(4.4, 1.1),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
      );
      board.position.set(sg.x, 2.4, -sg.y);
      board.rotation.y = sg.heading + Math.PI / 2; // face aux pilotes qui arrivent
      this.scene.add(board);
      var post = new THREE.Mesh(postGeo, postMat);
      post.position.set(sg.x, 1.1, -sg.y);
      post.castShadow = true;
      this.scene.add(post);
    }
  };

  /* --------------------- Arbres --------------------- */
  Renderer3D.prototype._buildTrees = function () {
    var trees = this.track.trees;
    if (!trees.length) return;
    var trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.4, 7);
    var crownGeo = new THREE.ConeGeometry(2.6, 6.5, 8);
    var trunkMat = new THREE.MeshLambertMaterial({ color: 0x6d4c2f });
    var crownMat = new THREE.MeshLambertMaterial({ color: 0x2f6023 });
    var ti = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    var ci = new THREE.InstancedMesh(crownGeo, crownMat, trees.length);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (var i = 0; i < trees.length; i++) {
      var t = trees[i], s = t.scale * 1.35;
      m4.compose(new THREE.Vector3(t.x, 1.7 * s, -t.y), q, new THREE.Vector3(s, s, s));
      ti.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(t.x, (3.4 + 2.6) * s, -t.y), q, new THREE.Vector3(s, s, s));
      ci.setMatrixAt(i, m4);
    }
    ti.castShadow = ci.castShadow = true;
    this.scene.add(ti); this.scene.add(ci);
  };

  /* --------------------- Voiture (monoplace moderne) --------------------- */
  Renderer3D.prototype._buildCar = function () {
    var car = this.carGroup = new THREE.Group();
    var body = this.carBody = new THREE.Group();
    car.add(body);

    var red = new THREE.MeshPhongMaterial({ color: 0xc8241a, shininess: 70, specular: 0x774444 });
    var dark = new THREE.MeshPhongMaterial({ color: 0x17171a, shininess: 35 });
    var carbon = new THREE.MeshPhongMaterial({ color: 0x26262b, shininess: 60, specular: 0x555560 });
    var silver = new THREE.MeshPhongMaterial({ color: 0xb9bcc2, shininess: 90, specular: 0x888888 });

    // fond plat
    var floor = new THREE.Mesh(new THREE.BoxGeometry(3.55, 0.08, 1.45), carbon);
    floor.position.set(0.05, 0.16, 0);
    body.add(floor);

    // monocoque centrale
    var mono = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.44, 0.80), red);
    mono.position.set(0.15, 0.44, 0);
    mono.castShadow = true;
    body.add(mono);

    // museau plongeant (pyramide écrasée)
    var nose = new THREE.Mesh(new THREE.ConeGeometry(0.40, 1.45, 4), red);
    nose.rotation.z = -Math.PI / 2;
    nose.rotation.x = Math.PI / 4;
    nose.position.set(1.80, 0.38, 0);
    nose.scale.set(1, 1, 0.62); // aplati en hauteur
    nose.castShadow = true;
    body.add(nose);

    // aileron avant + dérives
    var fwing = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 1.90), carbon);
    fwing.position.set(2.18, 0.14, 0);
    fwing.castShadow = true;
    body.add(fwing);
    for (var e = -1; e <= 1; e += 2) {
      var fplate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.20, 0.045), red);
      fplate.position.set(2.18, 0.24, e * 0.95);
      body.add(fplate);
    }

    // pontons latéraux
    for (var pz = -1; pz <= 1; pz += 2) {
      var pod = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.34, 0.44), red);
      pod.position.set(-0.35, 0.38, pz * 0.62);
      pod.castShadow = true;
      body.add(pod);
      var intake = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.34), dark);
      intake.position.set(0.43, 0.40, pz * 0.62);
      body.add(intake);
    }

    // capot moteur profilé + prise d'air
    var spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.15, 5, 10), red);
    spine.rotation.z = Math.PI / 2;
    spine.position.set(-0.95, 0.62, 0);
    spine.scale.set(1, 0.85, 0.8);
    spine.castShadow = true;
    body.add(spine);
    var airbox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.30), red);
    airbox.position.set(-0.42, 0.86, 0);
    body.add(airbox);

    // casque moderne + halo de protection
    var helmet = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10),
      new THREE.MeshPhongMaterial({ color: 0xf2f0e8, shininess: 80 }));
    helmet.position.set(0.10, 0.78, 0);
    body.add(helmet);
    var visor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.20), dark);
    visor.position.set(0.24, 0.80, 0);
    body.add(visor);
    var halo = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.035, 8, 14, Math.PI), carbon);
    halo.rotation.x = -Math.PI / 2;
    halo.rotation.z = Math.PI;
    halo.position.set(0.10, 0.88, 0);
    body.add(halo);
    var haloPillar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.05), carbon);
    haloPillar.rotation.z = 0.45;
    haloPillar.position.set(0.30, 0.82, 0);
    body.add(haloPillar);

    // aileron arrière (plan principal + volet + dérives + pylône)
    var rwing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.045, 1.50), carbon);
    rwing.position.set(-1.82, 0.92, 0);
    rwing.rotation.z = 0.10;
    rwing.castShadow = true;
    body.add(rwing);
    var rflap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 1.50), red);
    rflap.position.set(-1.95, 1.04, 0);
    rflap.rotation.z = 0.32;
    body.add(rflap);
    for (var re = -1; re <= 1; re += 2) {
      var rplate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.045), red);
      rplate.position.set(-1.86, 0.90, re * 0.75);
      body.add(rplate);
    }
    var pylon = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.42, 0.07), carbon);
    pylon.position.set(-1.80, 0.62, 0);
    body.add(pylon);

    // feu arrière (pluie)
    var rainlight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.10, 0.10),
      new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    rainlight.position.set(-2.02, 0.42, 0);
    body.add(rainlight);

    // numéro sur le museau
    var num = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20),
      new THREE.MeshBasicMaterial({ map: makeTextTexture('1', 96, 96, '#111', '#f5f2e8') }));
    num.rotation.x = -Math.PI / 2;
    num.rotation.z = Math.PI / 2;
    num.position.set(1.15, 0.60, 0);
    body.add(num);

    // roues larges : groupe de direction (yaw) → groupe de rotation (axe Z)
    var wheelGeoF = new THREE.CylinderGeometry(0.35, 0.35, 0.30, 18);
    var wheelGeoR = new THREE.CylinderGeometry(0.36, 0.36, 0.34, 18);
    var rimGeoF = new THREE.CylinderGeometry(0.21, 0.21, 0.31, 14);
    var rimGeoR = new THREE.CylinderGeometry(0.22, 0.22, 0.35, 14);
    var rimMat = new THREE.MeshPhongMaterial({ color: 0x8f9298, shininess: 100, specular: 0x999999 });
    var spokeGeo = new THREE.BoxGeometry(0.40, 0.05, 0.05);
    this.wheels = [];
    var defs = [
      { x: 1.32, z: 0.76, steer: true, front: true }, { x: 1.32, z: -0.76, steer: true, front: true },
      { x: -1.35, z: 0.79, steer: false, front: false }, { x: -1.35, z: -0.79, steer: false, front: false }
    ];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var steerG = new THREE.Group();
      steerG.position.set(d.x, 0.35, d.z);
      var spinG = new THREE.Group();
      var tire = new THREE.Mesh(d.front ? wheelGeoF : wheelGeoR, dark);
      tire.rotation.x = Math.PI / 2;
      tire.castShadow = true;
      spinG.add(tire);
      var rim = new THREE.Mesh(d.front ? rimGeoF : rimGeoR, rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.scale.set(1, 1.02, 1);
      spinG.add(rim);
      for (var sp = 0; sp < 3; sp++) {
        var spoke = new THREE.Mesh(spokeGeo, carbon);
        spoke.rotation.z = sp * Math.PI / 3;
        spoke.position.z = (d.front ? 0.165 : 0.185) * (d.z > 0 ? 1 : -1);
        spinG.add(spoke);
      }
      steerG.add(spinG);
      car.add(steerG);
      this.wheels.push({ steerG: steerG, spinG: spinG, steer: d.steer });
      // triangles de suspension
      var arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, Math.abs(d.z) - 0.35), carbon);
      arm.position.set(d.x, 0.36, d.z / 2);
      car.add(arm);
    }

    this.scene.add(car);
  };

  Renderer3D.prototype.updateCar = function (phys, dt) {
    var g = this.carGroup;
    g.position.set(phys.x, 0, -phys.y);
    g.rotation.y = phys.heading;
    // roulis / plongée simples (retour visuel des efforts)
    var latA = phys.r * phys.vx / 9.81; // ~g latéraux
    this.carBody.rotation.x += ((latA * 0.10) - this.carBody.rotation.x) * Math.min(1, dt * 8);
    var pitch = (phys.throttle * -0.5 + phys.brake * 0.8) * 0.035;
    this.carBody.rotation.z += (pitch - this.carBody.rotation.z) * Math.min(1, dt * 6);

    for (var i = 0; i < this.wheels.length; i++) {
      var w = this.wheels[i];
      w.spinG.rotation.z = -phys.wheelSpin;
      if (w.steer) w.steerG.rotation.y = phys.steer;
    }

    // soleil + ombres qui suivent la voiture
    this.sun.position.set(phys.x + 180, 260, -phys.y + 120);
    this.sun.target.position.set(phys.x, 0, -phys.y);

    this._updateCamera(phys, dt);
  };

  Renderer3D.prototype._updateCamera = function (phys, dt) {
    var cam = this.camera;
    var fwd = new THREE.Vector3(Math.cos(phys.heading), 0, -Math.sin(phys.heading));
    var pos = new THREE.Vector3(phys.x, 0, -phys.y);
    var desired, look;
    var v = Math.hypot(phys.vx, phys.vy);

    if (this.cameraMode === 1) { // capot
      desired = pos.clone().add(fwd.clone().multiplyScalar(0.4)).setY(1.25);
      look = pos.clone().add(fwd.clone().multiplyScalar(30)).setY(0.9);
      cam.position.copy(desired);
      cam.lookAt(look);
      cam.fov = 68; cam.updateProjectionMatrix();
      return;
    }
    if (this.cameraMode === 2) { // vue du ciel
      desired = pos.clone().add(new THREE.Vector3(0, 230 + v, 0.01));
      cam.position.lerp(desired, Math.min(1, dt * 3));
      cam.lookAt(pos);
      cam.fov = 55; cam.updateProjectionMatrix();
      return;
    }
    // poursuite
    var dist = 10.5 + v * 0.12, h = 3.6 + v * 0.03;
    desired = pos.clone().sub(fwd.clone().multiplyScalar(dist)).setY(h);
    if (!this._camInit) { this._camPos.copy(desired); this._camInit = true; }
    this._camPos.lerp(desired, Math.min(1, dt * 4.2));
    look = pos.clone().add(fwd.clone().multiplyScalar(7)).setY(1.2);
    this._camLook.lerp(look, Math.min(1, dt * 6));
    cam.position.copy(this._camPos);
    cam.lookAt(this._camLook);
    cam.fov = 62; cam.updateProjectionMatrix();
  };

  Renderer3D.prototype.resize = function () {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  Renderer3D.prototype.render = function () {
    this.renderer.render(this.scene, this.camera);
  };

  global.Renderer3D = Renderer3D;
})(window);
