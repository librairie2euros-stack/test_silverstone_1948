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

  function Renderer3D(canvas, track) {
    this.track = track;
    var renderer = this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    var scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9ec8ec);
    scene.fog = new THREE.Fog(0xaed0ea, 350, 1500);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 3000);
    this.cameraMode = 0; // 0 poursuite, 1 capot, 2 vue du ciel
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this._camInit = false;

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
  }

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
  Renderer3D.prototype._ribbonGeometry = function (latA, latB, y) {
    // bande entre deux décalages latéraux (gauche +), boucle fermée
    var samples = this.track.samples, n = samples.length;
    var pos = new Float32Array((n + 1) * 2 * 3);
    var uv = new Float32Array((n + 1) * 2 * 2);
    var idx = [];
    for (var i = 0; i <= n; i++) {
      var sp = samples[i % n];
      var nx = -Math.sin(sp.heading), ny = Math.cos(sp.heading);
      var o = i * 6;
      pos[o] = sp.x + nx * latA; pos[o + 1] = y; pos[o + 2] = -(sp.y + ny * latA);
      pos[o + 3] = sp.x + nx * latB; pos[o + 4] = y; pos[o + 5] = -(sp.y + ny * latB);
      var u = (i === n ? this.track.S : sp.s) / 8;
      uv[i * 4] = u; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = u; uv[i * 4 + 3] = 1;
      if (i < n) {
        var a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
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

  /* --------------------- Voiture --------------------- */
  Renderer3D.prototype._buildCar = function () {
    var car = this.carGroup = new THREE.Group();
    var body = this.carBody = new THREE.Group();
    car.add(body);

    var red = new THREE.MeshPhongMaterial({ color: 0xc0281c, shininess: 55, specular: 0x664444 });
    var dark = new THREE.MeshPhongMaterial({ color: 0x1c1c1e, shininess: 30 });
    var silver = new THREE.MeshPhongMaterial({ color: 0xb9bcc2, shininess: 90, specular: 0x888888 });

    // fuselage « cigare »
    var hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.44, 3.0, 6, 14), red);
    hull.rotation.z = Math.PI / 2;
    hull.position.set(0.05, 0.58, 0);
    hull.scale.set(1, 0.78, 0.92);
    hull.castShadow = true;
    body.add(hull);

    // nez conique
    var nose = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.85, 14), red);
    nose.rotation.z = -Math.PI / 2;
    nose.position.set(2.15, 0.54, 0);
    nose.castShadow = true;
    body.add(nose);

    // calandre
    var grille = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 14), dark);
    grille.rotation.z = Math.PI / 2;
    grille.position.set(2.22, 0.52, 0);
    body.add(grille);

    // cockpit (rebord) + queue effilée
    var cockpit = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.06, 8, 16), red);
    cockpit.rotation.x = Math.PI / 2;
    cockpit.position.set(-0.25, 0.92, 0);
    body.add(cockpit);
    var tail = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.15, 12), red);
    tail.rotation.z = Math.PI / 2;
    tail.position.set(-2.05, 0.56, 0);
    tail.scale.set(1, 0.75, 0.9);
    tail.castShadow = true;
    body.add(tail);

    // pilote : tête + casque cuir + lunettes
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0x9a6b46 }));
    head.position.set(-0.25, 1.02, 0);
    body.add(head);
    var goggles = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.24), dark);
    goggles.position.set(-0.11, 1.05, 0);
    body.add(goggles);

    // pare-brise saute-vent
    var screen = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.17),
      new THREE.MeshPhongMaterial({ color: 0xcfe8ef, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    screen.position.set(0.26, 0.97, 0);
    screen.rotation.z = -0.5;
    screen.rotation.y = Math.PI / 2;
    body.add(screen);

    // échappement
    var pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), silver);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(-0.7, 0.42, -0.55);
    body.add(pipe);

    // numéro sur le nez
    var num = new THREE.Mesh(new THREE.CircleGeometry(0.24, 20),
      new THREE.MeshBasicMaterial({ map: makeTextTexture('1', 96, 96, '#111', '#f5f2e8') }));
    num.rotation.x = -Math.PI / 2;
    num.position.set(1.30, 0.87, 0);
    body.add(num);

    // roues : groupe de direction (yaw) → groupe de rotation (axe Z)
    var wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.2, 16);
    var spokeGeo = new THREE.BoxGeometry(0.5, 0.05, 0.04);
    var hubMat = new THREE.MeshPhongMaterial({ color: 0xd8d5c8, shininess: 80 });
    this.wheels = [];
    var defs = [
      { x: 1.30, z: 0.66, steer: true }, { x: 1.30, z: -0.66, steer: true },
      { x: -1.30, z: 0.70, steer: false }, { x: -1.30, z: -0.70, steer: false }
    ];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var steerG = new THREE.Group();
      steerG.position.set(d.x, 0.34, d.z);
      var spinG = new THREE.Group();
      var tire = new THREE.Mesh(wheelGeo, dark);
      tire.rotation.x = Math.PI / 2;
      tire.castShadow = true;
      spinG.add(tire);
      for (var sp = 0; sp < 3; sp++) {
        var spoke = new THREE.Mesh(spokeGeo, hubMat);
        spoke.rotation.z = sp * Math.PI / 3;
        spinG.add(spoke);
      }
      steerG.add(spinG);
      car.add(steerG);
      this.wheels.push({ steerG: steerG, spinG: spinG, steer: d.steer });
      // petit bras de suspension
      var arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, Math.abs(d.z)), silver);
      arm.position.set(d.x, 0.38, d.z / 2);
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
