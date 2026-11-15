// Weapons: the numbers and the view models. main.js owns the ray and the
// damage; this module owns magazines, fire rates, spread, recoil and the gun
// the player sees. Buying a weapon refills it; switching keeps its ammo.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 26, headMult: 2,
    mag: 12, reserve: 36, fireGap: 0.15, auto: false, reloadTime: 1.3,
    spreadStill: 0.006, spreadMove: 0.03, recoil: 0.011, speed: 1.0, zoom: 0, pellets: 1,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Rifle', price: 2700, damage: 33, headMult: 2,
    mag: 30, reserve: 90, fireGap: 0.1, auto: true, reloadTime: 1.9,
    spreadStill: 0.004, spreadMove: 0.032, recoil: 0.014, speed: 0.95, zoom: 0, pellets: 1,
  },
  smg: {
    id: 'smg', name: 'Stinger SMG', price: 1500, damage: 24, headMult: 2,
    mag: 25, reserve: 100, fireGap: 0.068, auto: true, reloadTime: 1.5,
    spreadStill: 0.009, spreadMove: 0.04, recoil: 0.008, speed: 1.0, zoom: 0, pellets: 1,
  },
  dmr: {
    id: 'dmr', name: 'Longbow DMR', price: 4200, damage: 88, headMult: 2,
    mag: 5, reserve: 20, fireGap: 0.95, auto: false, reloadTime: 2.6,
    spreadStill: 0.0008, spreadMove: 0.02, recoil: 0.035, speed: 0.9, zoom: 1, pellets: 1,
  },
  shotgun: {
    id: 'shotgun', name: 'Breacher 12', price: 1300, damage: 14, headMult: 2,
    mag: 6, reserve: 24, fireGap: 0.85, auto: false, reloadTime: 2.4,
    spreadStill: 0.03, spreadMove: 0.055, recoil: 0.03, speed: 0.95, zoom: 0, pellets: 8,
  },
};

const GRENADE_PRICE = 300;
const ARMOR_PRICE = 650;

export function createWeaponRack(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#23262b'), roughness: 0.6, metalness: 0.3 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.25 });

  function buildModel(def) {
    const model = new THREE.Group();
    const add = (w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      model.add(m);
      return m;
    };
    if (def.id === 'pistol') {
      add(0.05, 0.09, 0.2, 0, 0, -0.1, bodyMat);
      add(0.045, 0.1, 0.06, 0, -0.08, 0.02, grip);
    } else if (def.id === 'smg') {
      add(0.07, 0.09, 0.34, 0, 0, -0.08, bodyMat);
      add(0.04, 0.04, 0.24, 0, 0.02, -0.32, darkMat);
      add(0.05, 0.12, 0.06, 0, -0.09, -0.02, grip);
      add(0.02, 0.02, 0.1, 0.02, 0.06, -0.1, accentMat);
    } else if (def.id === 'dmr') {
      add(0.07, 0.09, 0.55, 0, 0, -0.16, bodyMat);
      add(0.04, 0.04, 0.5, 0, 0.02, -0.5, darkMat);
      add(0.05, 0.05, 0.14, 0, 0.08, -0.05, darkMat);
      add(0.06, 0.09, 0.2, 0, -0.02, 0.24, grip);
      add(0.015, 0.015, 0.08, 0, 0.07, -0.2, accentMat);
    } else if (def.id === 'shotgun') {
      add(0.08, 0.1, 0.5, 0, 0, -0.1, darkMat);
      add(0.06, 0.06, 0.42, 0, -0.03, -0.36, grip);
      add(0.07, 0.08, 0.22, 0, -0.02, 0.26, bodyMat);
    } else {
      add(0.08, 0.1, 0.44, 0, 0, -0.12, bodyMat);
      add(0.045, 0.045, 0.4, 0, 0.025, -0.46, darkMat);
      add(0.07, 0.09, 0.2, 0, -0.02, 0.28, grip);
      add(0.05, 0.03, 0.12, 0, 0.065, -0.14, accentMat);
    }
    model.position.set(0.26, -0.22, -0.46);
    return model;
  }

  const models = {};
  for (const def of Object.values(WEAPONS)) {
    models[def.id] = buildModel(def);
    models[def.id].visible = false;
    camera.add(models[def.id]);
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.17, 0.17),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.19, -1.0);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.26, -0.16, -0.7);
  camera.add(flashLight);

  const state = {
    weapon: 'pistol',
    ammo: {},
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    zoomed: false,
  };
  for (const def of Object.values(WEAPONS)) {
    state.ammo[def.id] = { mag: def.mag, reserve: def.reserve };
  }
  models.pistol.visible = true;

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.weapon];
    model.position.z = -0.46 + state.kick;
    model.rotation.x = state.kick * 2.0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = WEAPONS[state.weapon];
      model.rotation.x = -0.5 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.ammo[def.id].mag;
        const take = Math.min(need, state.ammo[def.id].reserve);
        state.ammo[def.id].mag += take;
        state.ammo[def.id].reserve -= take;
      }
    }
    flash.visible = state.flash > 0;
    if (state.flash > 0) flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 16 : 0;
  }

  return {
    state,
    def() { return WEAPONS[state.weapon]; },
    ammo() { return state.ammo[state.weapon]; },
    step,
    ready() {
      return state.ammo[state.weapon].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    canFire() {
      return state.ammo[state.weapon].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      const def = WEAPONS[state.weapon];
      state.cooldown = def.fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.ammo[state.weapon].mag <= 0) return false;
      state.ammo[state.weapon].mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[state.weapon];
      const ammo = state.ammo[def.id];
      if (state.reloadLeft > 0 || ammo.mag === def.mag || ammo.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    spread(speed) {
      const def = WEAPONS[state.weapon];
      const base = state.zoomed ? def.spreadStill * 0.5 : def.spreadStill;
      return base + Math.min(1, speed / 5.2) * def.spreadMove;
    },
    equip(id) {
      if (!WEAPONS[id] || state.weapon === id) return false;
      models[state.weapon].visible = false;
      state.weapon = id;
      state.reloadLeft = 0;
      state.cooldown = Math.max(state.cooldown, 0.25);
      models[id].visible = true;
      return true;
    },
    buy(id) {
      if (!WEAPONS[id] || id === 'pistol') return false;
      state.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      return true;
    },
    refillAll() {
      for (const def of Object.values(WEAPONS)) {
        state.ammo[def.id] = { mag: def.mag, reserve: def.reserve };
      }
    },
    setZoomed(on) {
      state.zoomed = on;
    },
  };
}

export const SHOP = {
  grenadePrice: GRENADE_PRICE,
  armorPrice: ARMOR_PRICE,
};
