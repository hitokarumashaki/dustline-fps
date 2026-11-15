// DUSTLINE boot: renderer, scene, wiring, and the one loop — a fixed 60 Hz
// simulation feeding a render at the display's rate. ?shot=start|play|end
// with &seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap } from './map.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createWeaponRack } from './weapons.js';
import { createCombat } from './combat.js';
import { createHud } from './hud.js';
import { createGame } from './game.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 78);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
camera.position.set(0, 1.6, 14);
camera.rotation.set(0, 0, 0, 'YXZ');
scene.add(camera);

const map = createMap(scene);
const hud = createHud();
const audio = createAudio();
const weaponRack = createWeaponRack(camera);
const combat = createCombat(scene, map, audio, {
  onPlayerFlash: (seconds) => hud.flashScreen(seconds),
  onExplosion: null,
});
const input = createInput(renderer.domElement, (locked) => game.onLockChange(locked));
const game = createGame(scene, camera, map, combat, hud, input, audio, weaponRack);

// Minimap data: cover boxes projected to the ground plane (the floor excluded).
hud.setMapData({
  minX: -22, maxX: 22, minZ: -18, maxZ: 18,
  walls: map.colliders
    .filter((c) => c.min.y > -0.1 && c.max.y > 1.2)
    .map((c) => ({ x0: c.min.x, z0: c.min.z, x1: c.max.x, z1: c.max.z })),
  sites: map.sites.map((s) => ({ letter: s.letter, x: s.x, z: s.z })),
});

hud.onPlay(() => game.onPlayClick());
hud.onDeploy(() => {
  hud.hideBuyMenu();
  input.requestLock();
});

let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    elapsed += dt;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      game.step(FIXED_STEP, elapsed);
      map.update(elapsed);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) {
    elapsed += FIXED_STEP;
    game.step(FIXED_STEP, elapsed);
    map.update(elapsed);
  }
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (shot) {
  hud.hideOverlay();
  game.setupShot(shot, seed);
  if (shot === 'play') settle(20);
  if (shot === 'end') settle(10);
  if (shot === 'play') game.fireOnce(elapsed);
  paintTwiceThenReady();
} else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
