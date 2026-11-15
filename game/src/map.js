// DUSTLINE's map: a dusk industrial yard, 44 x 36 m, flat so bots and the
// player share the same ground. Two bomb sites (A west, B east), three lanes
// (A-long, mid, B-long), containers, crates and silos as cover. All art is
// procedural canvas textures or styled geometry: no external assets.
// Waypoints form a nav graph bots walk with BFS; every node is clear of cover.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function canvasTexture(size, draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(ctx, size, base, dots, alpha) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < dots; i += 1) {
    const v = Math.random();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha * 1.6})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}

function groundTexture() {
  return canvasTexture(512, (ctx, s) => {
    speckle(ctx, s, '#3a332b', 9000, 0.05);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i += 1) {
      ctx.beginPath();
      let x = Math.random() * s;
      let y = Math.random() * s;
      ctx.moveTo(x, y);
      for (let j = 0; j < 4; j += 1) { x += (Math.random() - 0.5) * 120; y += (Math.random() - 0.5) * 120; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,154,60,0.16)';
    ctx.fillRect(0, s * 0.48, s, 6);
  }, 5, 4);
}

function containerTexture(base, label) {
  return canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 32) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, 0, 6, s);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x + 6, 0, 4, s);
    }
    for (let i = 0; i < 260; i += 1) {
      ctx.fillStyle = `rgba(60,30,10,${0.05 + Math.random() * 0.16})`;
      const w = 6 + Math.random() * 30;
      const h = 4 + Math.random() * 18;
      ctx.fillRect(Math.random() * s, Math.random() * s, w, h);
    }
    ctx.fillStyle = 'rgba(240,235,220,0.85)';
    ctx.font = `bold ${Math.floor(s / 6)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, s / 2, s / 2);
    ctx.font = `bold ${Math.floor(s / 14)}px monospace`;
    ctx.fillText('DUSTLINE YARD', s / 2, s / 2 + s / 8);
  });
}

function crateTexture() {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#6b5232';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 42) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, y, s, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(0, y + 3, s, 2);
    }
    ctx.strokeStyle = 'rgba(30,18,8,0.7)';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, s - 10, s - 10);
    ctx.beginPath();
    ctx.moveTo(5, 5);
    ctx.lineTo(s - 5, s - 5);
    ctx.moveTo(s - 5, 5);
    ctx.lineTo(5, s - 5);
    ctx.stroke();
  });
}

function concreteTexture() {
  return canvasTexture(256, (ctx, s) => speckle(ctx, s, '#57503f', 5200, 0.07));
}

function hazardTexture() {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#d8a020';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#1a1a1a';
    for (let x = -s; x < s * 2; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, s);
      ctx.lineTo(x + 32, 0);
      ctx.lineTo(x + 64, 0);
      ctx.lineTo(x + 32, s);
      ctx.closePath();
      ctx.fill();
    }
  }, 6, 1);
}

function letterTexture(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = color;
  ctx.font = 'bold 190px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 138);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Waypoints: [x, z] nodes, edges as index pairs. Kept clear of every box.
const WAYPOINTS = [
  [-5, 14], [0, 14], [5, 14], // 0-2 Vanguard spawn
  [-5, -14], [0, -14], [5, -14], // 3-5 Cinder spawn
  [-10, 10], [10, 10], // 6-7 south mid
  [-6, 4.2], [6, 4.2], // 8-9
  [-18, 8], [18, 8], // 10-11 long south
  [-18, 0], [18, 0], // 12-13 long mid
  [-18, -6], [18, -6], // 14-15 long north
  [-13, -8], [13, -8], // 16-17 sites A / B
  [-6, -4], [6, -4], // 18-19
  [-6, -10], [6, -10], // 20-21 north mid
  [-10, -13], [10, -13], // 22-23
  [0, 8], [0, -8], // 24-25 centre
  [-12, 4], [12, 4], // 26-27
];
const EDGES = [
  [0, 6], [1, 6], [1, 7], [2, 7], [6, 10], [7, 11], [6, 8], [7, 9],
  [8, 26], [9, 27], [26, 10], [27, 11], [12, 14], [13, 15],
  [14, 16], [15, 17], [16, 20], [17, 21], [8, 18], [9, 19],
  [18, 20], [19, 21], [20, 22], [21, 23], [22, 3], [23, 5],
  [3, 22], [4, 22], [4, 23], [5, 23], [6, 24], [7, 24], [24, 8], [24, 9],
  [25, 18], [25, 19], [25, 20], [25, 21], [0, 24], [2, 24],
  [10, 12], [11, 13], [16, 14], [17, 15], [20, 16], [21, 17],
  [8, 6], [9, 7], [18, 8], [19, 9], [26, 10], [27, 11],
];

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];

  const groundMat = new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0.02 });
  const concreteMat = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.9, metalness: 0.02 });
  const rustMat = new THREE.MeshStandardMaterial({ map: containerTexture('#7a4a28', 'DL-07'), roughness: 0.75, metalness: 0.25 });
  const tealMat = new THREE.MeshStandardMaterial({ map: containerTexture('#2e5f66', 'DL-12'), roughness: 0.75, metalness: 0.25 });
  const sandMat = new THREE.MeshStandardMaterial({ map: containerTexture('#8a6a3c', 'DL-03'), roughness: 0.8, metalness: 0.2 });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.9, metalness: 0.02 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.9, metalness: 0.05 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.85 });

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Floor and perimeter (walls 5 m high).
  box(44.4, 0.4, 36.4, 0, -0.2, 0, groundMat, false);
  shootables.push(group.children[0]);
  colliders.push(new THREE.Box3(new THREE.Vector3(-22.2, -0.4, -18.2), new THREE.Vector3(22.2, 0, 18.2)));
  box(0.4, 5, 36.4, -22.2, 2.5, 0, concreteMat);
  box(0.4, 5, 36.4, 22.2, 2.5, 0, concreteMat);
  box(44.4, 5, 0.4, 0, 2.5, -18.2, concreteMat);
  box(44.4, 5, 0.4, 0, 2.5, 18.2, concreteMat);

  // Mid cross-stack: the map's landmark.
  box(6, 2.6, 2.6, 0, 1.3, 0, rustMat);
  box(2.6, 2.6, 6, 0, 3.9, 0, tealMat);
  // Long-lane container walls: a horizontal bar across each long lane, with
  // gaps on both sides, so the sites stay reachable from the west/east lanes.
  box(6, 2.6, 2.6, -14, 1.3, -4, tealMat);
  box(2.6, 2.6, 6, -14, 1.3, 2, sandMat);
  box(6, 2.6, 2.6, 14, 1.3, -4, sandMat);
  box(2.6, 2.6, 6, 14, 1.3, 2, tealMat);
  // Site back containers.
  box(6, 2.6, 2.6, -18, 1.3, -12, rustMat);
  box(6, 2.6, 2.6, 18, 1.3, -12, rustMat);
  // South cover container, tucked into the south-east corner so it never
  // swallows the south-mid waypoint at (10, 10).
  box(6, 2.6, 2.6, 14, 1.3, 12, tealMat);

  // Crates (1.1 m cubes) scattered as crouch cover. None sits on a waypoint
  // or on a nav edge: the lane crates hug the walls instead of blocking the
  // long lanes, and the mid crates sit clear of the centre routes.
  const crates = [
    [-4, 4], [4, 4], [-8, -2], [8, -2], [-10, 6], [10, 6], [-2, -8], [2, -8],
    [-16, 0], [16, 0], [0, 10], [-20, -5], [20, -5], [-13, -10], [13, -10], [-9, -15], [9, -15],
  ];
  for (const [x, z] of crates) box(1.1, 1.1, 1.1, x, 0.55, z, crateMat);
  // Double-stacked crates at mid-south, clear of the centre routes.
  box(1.1, 1.1, 1.1, -6.5, 0.55, 8.5, crateMat);
  box(1.1, 1.1, 1.1, -6.5, 1.65, 8.5, crateMat);
  box(1.1, 1.1, 1.1, 6.5, 0.55, 8.5, crateMat);
  box(1.1, 1.1, 1.1, 6.5, 1.65, 8.5, crateMat);

  // Concrete barriers.
  box(2.4, 1.0, 0.6, -8, 0.5, 11, concreteMat);
  box(2.4, 1.0, 0.6, 8, 0.5, 11, concreteMat);
  box(2.4, 1.0, 0.6, -8, 0.5, -10, concreteMat);
  box(2.4, 1.0, 0.6, 8, 0.5, -10, concreteMat);

  // Silos at site B: cylinders with box colliders.
  const siloMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#7d838c'), roughness: 0.45, metalness: 0.6 });
  for (const [x, z] of [[19, -15], [13, -15.5]]) {
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 5.4, 20), siloMat);
    silo.position.set(x, 2.7, z);
    silo.castShadow = true;
    silo.receiveShadow = true;
    group.add(silo);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 1.6, 0, z - 1.6), new THREE.Vector3(x + 1.6, 5.4, z + 1.6)));
    shootables.push(silo);
  }

  // Bomb sites: hazard border + letter + pulsing ring.
  const sites = [];
  const rings = [];
  for (const [letter, cx, cz, color] of [['A', -16, -8, PALETTE.accent], ['B', 16, -8, PALETTE.accent]]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.2, 3.9, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, 0.03, cz);
    group.add(ring);
    rings.push(ring);
    const letterMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: letterTexture(letter, color), transparent: true, depthWrite: false }),
    );
    letterMesh.rotation.x = -Math.PI / 2;
    letterMesh.position.set(cx, 0.04, cz);
    group.add(letterMesh);
    for (const [hx, hz, hw] of [[cx, cz - 4.1, 8.2], [cx, cz + 4.1, 8.2]]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(hw, 0.06, 0.5), hazardMat);
      strip.position.set(hx, 0.03, hz);
      strip.receiveShadow = true;
      group.add(strip);
    }
    sites.push({ letter, x: cx, z: cz, radius: 4 });
  }

  // Distant skyline + low sun, outside the walls so the horizon reads.
  const skylineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#241c16') });
  const skyline = [
    [-40, 6, -40, 10, 12, 8], [30, 8, -46, 14, 16, 8], [52, 5, -20, 8, 10, 8],
    [-52, 7, 10, 8, 14, 10], [44, 4, 30, 12, 8, 8], [-30, 5, 44, 10, 10, 8],
  ];
  for (const [x, y, z, w, h, d] of skyline) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), skylineMat);
    m.position.set(x, y, z);
    group.add(m);
  }
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(7, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8c2e'), fog: false }),
  );
  sun.position.set(-58, 13, -70);
  sun.lookAt(0, 2, 0);
  group.add(sun);

  // Light: warm low sun from the west, cool sky fill, dim ambient.
  const hemi = new THREE.HemisphereLight(new THREE.Color('#7d94b5'), new THREE.Color('#3a2c1e'), 1.05);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 2.6);
  key.position.set(-28, 16, -18);
  key.target.position.set(4, 0, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -30;
  key.shadow.camera.far = 90;
  key.shadow.bias = -0.0005;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5f7ea6'), 0.75);
  fill.position.set(20, 12, 16);
  scene.add(fill);
  // Warm point lights over the two sites, so they read at a glance.
  for (const site of sites) {
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 14, 16, 1.6);
    lamp.position.set(site.x, 4.2, site.z);
    group.add(lamp);
  }

  const adjacency = WAYPOINTS.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < WAYPOINTS.length; i += 1) {
      const d = (WAYPOINTS[i][0] - x) ** 2 + (WAYPOINTS[i][1] - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // BFS over the nav graph. Returns an array of [x, z] waypoints, start excluded.
  function findPath(fromX, fromZ, toX, toZ) {
    const start = nearestNode(fromX, fromZ);
    const goal = nearestNode(toX, toZ);
    if (start === goal) return [[toX, toZ]];
    const prev = new Array(WAYPOINTS.length).fill(-1);
    const queue = [start];
    prev[start] = start;
    while (queue.length) {
      const cur = queue.shift();
      if (cur === goal) break;
      for (const next of adjacency[cur]) {
        if (prev[next] === -1) { prev[next] = cur; queue.push(next); }
      }
    }
    if (prev[goal] === -1) return [[toX, toZ]];
    const nodes = [];
    let cur = goal;
    while (cur !== start) { nodes.unshift(cur); cur = prev[cur]; }
    const path = nodes.map((i) => [WAYPOINTS[i][0], WAYPOINTS[i][1]]);
    const lastPt = path[path.length - 1];
    if (Math.hypot(lastPt[0] - toX, lastPt[1] - toZ) > 0.01) path.push([toX, toZ]);
    return path;
  }

  return {
    colliders,
    shootables,
    sites,
    waypoints: WAYPOINTS,
    findPath,
    vanguardSpawns: [[-5, 14], [-2, 14], [1, 14], [4, 14]],
    cinderSpawns: [[-5, -14], [-2, -14], [1, -14], [4, -14]],
    update(time) {
      for (const ring of rings) ring.material.opacity = 0.4 + 0.2 * Math.sin(time * 2.2);
    },
  };
}
