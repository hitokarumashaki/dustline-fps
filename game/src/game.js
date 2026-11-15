// DUSTLINE match: the state machine. Menu -> buy -> round -> round end,
// first to 5 rounds takes the yard. Vanguard (the player + 3 bots) attacks
// and plants the spike; Cinder (4 bots) holds the sites and defuses. Money,
// the buy menu, the spike, spectating and the deterministic screenshot setups
// all live here; shooting resolves in combat.js, bot brains in bots.js.
import * as THREE from 'three';
import { createMover } from './mover.js';
import { WEAPONS, SHOP } from './weapons.js';
import { createBot, createBotController } from './bots.js';

const BUY_SECONDS = 15;
const ROUND_SECONDS = 100;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;
const DETONATE_SECONDS = 35;
const ROUNDS_TO_WIN = 5;
const START_MONEY = 800;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame(scene, camera, map, combat, hud, input, audio, weaponRack) {
  const random = mulberry32((Math.random() * 1e9) | 0);
  const bots = createBotController(combat, map, audio, random);
  const raycaster = new THREE.Raycaster();
  const aimDir = new THREE.Vector3();
  const camPos = new THREE.Vector3();

  // The player is an agent like any bot, with invisible hit meshes bots can
  // shoot at (raycast ignores visibility). Their group is never rendered.
  const playerBody = (() => {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), new THREE.MeshBasicMaterial());
    torso.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial());
    head.position.y = 1.58;
    group.add(torso, head);
    group.visible = false;
    scene.add(group);
    return { group, torso, head };
  })();

  const player = {
    id: 'P0',
    team: 'V',
    name: 'You',
    isPlayer: true,
    hp: 100,
    armor: 0,
    alive: true,
    mover: createMover(map.colliders, { x: 0, z: 14, walkSpeed: 5.2 }),
    group: playerBody.group,
    headMesh: playerBody.head,
    torsoMesh: playerBody.torso,
    weapon: 'pistol',
    grenades: 0,
    blindUntil: 0,
    deathTime: 0,
    onDeath: null,
  };
  playerBody.torso.userData.agent = player;
  playerBody.torso.userData.part = 'torso';
  playerBody.head.userData.agent = player;
  playerBody.head.userData.part = 'head';

  const state = {
    phase: 'menu', // menu | buy | round | roundEnd | matchEnd
    round: 1,
    scoreV: 0,
    scoreC: 0,
    money: START_MONEY,
    lossStreak: 0,
    buyLeft: BUY_SECONDS,
    roundLeft: ROUND_SECONDS,
    spike: { carrier: null, planted: false, site: null, x: 0, z: 0, detonateLeft: 0, defuseBy: null },
    roundEndLeft: 0,
    roundEndText: '',
    spectate: null,
    owned: new Set(['pistol']),
    kills: 0,
    deaths: 0,
    started: false,
    shotMode: null,
  };

  let allAgents = [];
  let allyBots = [];
  let enemyBots = [];
  let plantProgress = 0;
  let defuseProgress = 0;
  let lastStepSound = 0;
  let lastDry = -1;
  let minimapTimer = 0;
  let fovTarget = 74;

  function makeBots() {
    // Remove old bot bodies.
    for (const b of [...allyBots, ...enemyBots]) scene.remove(b.group);
    allyBots = [];
    enemyBots = [];
    combat.clearAgents();
    combat.registerAgent(player);
    const vSpawns = map.vanguardSpawns;
    const cSpawns = map.cinderSpawns;
    for (let i = 0; i < 3; i += 1) {
      const bot = createBot(scene, 'V', i, vSpawns[(i + 1) % vSpawns.length], 0.55 + random() * 0.2);
      bot.mover = createMover(map.colliders, { x: vSpawns[(i + 1) % vSpawns.length][0], z: vSpawns[(i + 1) % vSpawns.length][1], walkSpeed: 3.6 + bot.skill });
      bot.onDeath = (attacker, part) => onKill(bot, attacker, part);
      allyBots.push(bot);
      combat.registerAgent(bot);
    }
    for (let i = 0; i < 4; i += 1) {
      const bot = createBot(scene, 'C', i, cSpawns[i % cSpawns.length], 0.5 + random() * 0.25);
      bot.mover = createMover(map.colliders, { x: cSpawns[i % cSpawns.length][0], z: cSpawns[i % cSpawns.length][1], walkSpeed: 3.6 + bot.skill });
      bot.onDeath = (attacker, part) => onKill(bot, attacker, part);
      enemyBots.push(bot);
      combat.registerAgent(bot);
    }
    allAgents = [player, ...allyBots, ...enemyBots];
  }

  function botLoadout(bot, round) {
    let weapon = 'pistol';
    if (round >= 4) weapon = random() < 0.7 ? 'rifle' : 'smg';
    else if (round >= 2) weapon = random() < 0.6 ? 'smg' : 'rifle';
    if (bot.team === 'C' && bot.id === 'C0' && round >= 3) weapon = 'dmr';
    if (bot.team === 'V' && bot.id === 'V2' && round >= 3) weapon = 'shotgun';
    const def = WEAPONS[weapon];
    bot.weapon = weapon;
    bot.ammo = { mag: def.mag, reserve: def.reserve };
    bot.armor = round >= 3 ? 50 : 0;
    bot.hp = 100;
  }

  function resetPositions() {
    player.mover.teleport(map.vanguardSpawns[0][0], map.vanguardSpawns[0][1], 0);
    allyBots.forEach((b, i) => {
      const s = map.vanguardSpawns[(i + 1) % map.vanguardSpawns.length];
      b.mover.teleport(s[0], s[1], 0);
      b.group.rotation.set(0, 0, 0);
      b.group.position.set(s[0], 0, s[1]);
      b.fall = 0;
      b.channel = null;
      b.target = null;
      b.path = [];
      b.hasSpike = false;
      b.siteTarget = null;
    });
    enemyBots.forEach((b, i) => {
      const s = map.cinderSpawns[i % map.cinderSpawns.length];
      b.mover.teleport(s[0], s[1], Math.PI);
      b.group.rotation.set(0, 0, 0);
      b.group.position.set(s[0], 0, s[1]);
      b.fall = 0;
      b.channel = null;
      b.target = null;
      b.path = [];
      b.hasSpike = false;
    });
  }

  function startBuyPhase() {
    state.phase = 'buy';
    state.buyLeft = BUY_SECONDS;
    state.spike = { carrier: null, planted: false, site: null, x: 0, z: 0, detonateLeft: 0, defuseBy: null };
    resetPositions();
    // Survivors keep weapons; the dead restart with a pistol.
    if (!player.alive) {
      player.alive = true;
      player.hp = 100;
      player.armor = 0;
      state.owned = new Set(['pistol']);
      weaponRack.equip('pistol');
      weaponRack.refillAll();
      player.weapon = 'pistol';
    } else {
      player.hp = 100;
    }
    for (const b of [...allyBots, ...enemyBots]) {
      if (!b.alive) {
        b.alive = true;
        b.hp = 100;
        b.group.rotation.set(0, 0, 0);
        b.group.position.y = 0;
      } else b.hp = 100;
      botLoadout(b, state.round);
    }
    // Spike carrier: the player, unless the player is out (never at round start).
    state.spike.carrier = player;
    hud.setSpike('SPIKE — you carry it. Plant at A or B with E.');
    hud.showBanner(`ROUND ${state.round}`, state.round === 1 ? 'Vanguard attacks — plant the spike at A or B' : 'Buy up with B, then take a site', '#efe8d8');
    hud.setRoundScore(state.scoreV, state.scoreC, state.round);
    hud.hideBuyMenu();
  }

  function startRound() {
    state.phase = 'round';
    state.roundLeft = ROUND_SECONDS;
    hud.hideBuyMenu();
    hud.setHint('');
    if (!input.state.locked && state.phase === 'round' && !state.shotMode) {
      hud.showOverlay('paused');
    }
  }

  function endRound(winner, reason) {
    if (state.phase !== 'round') return;
    state.phase = 'roundEnd';
    state.roundEndLeft = 4;
    state.roundEndText = reason;
    if (winner === 'V') {
      state.scoreV += 1;
      state.money += 3250;
      state.lossStreak = 0;
      audio.roundWin();
      hud.showBanner('VANGUARD WINS', reason, '#2ec4b6');
    } else {
      state.scoreC += 1;
      state.lossStreak += 1;
      state.money += 1900 + Math.min(2, state.lossStreak - 1) * 500;
      audio.roundLose();
      hud.showBanner('CINDER WINS', reason, '#ff5a3c');
    }
    hud.setRoundScore(state.scoreV, state.scoreC, state.round);
    hud.setMoney(state.money);
    hud.setSpike('');
    hud.setHint('');
    hud.setPlantProgress(null);
    plantProgress = 0;
    defuseProgress = 0;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function endMatch() {
    state.phase = 'matchEnd';
    const won = state.scoreV > state.scoreC;
    audio.matchWin();
    hud.showOverlay('match', won ? `VANGUARD TAKES THE YARD ${state.scoreV}–${state.scoreC}` : `CINDER HOLDS THE YARD ${state.scoreC}–${state.scoreV}`);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function onKill(victim, attacker, part) {
    const headshot = part === 'head';
    hud.killfeed(attacker ? attacker.name : '—', attacker ? attacker.team : 'V', victim.name, victim.team, headshot);
    if (attacker === player) {
      state.money += 300;
      state.kills += 1;
      hud.setMoney(state.money);
      audio.kill();
    }
    if (victim === player) {
      state.deaths += 1;
      audio.hurt();
      // Spectate a living ally.
      state.spectate = allyBots.find((b) => b.alive) || null;
    }
    if (victim === state.spike.carrier) {
      // Spike drops where the carrier fell; nearest living attacker picks it up.
      const carriers = [player, ...allyBots].filter((a) => a.alive);
      for (const b of allyBots) b.hasSpike = false;
      if (carriers.length) {
        let best = carriers[0];
        let bestD = Infinity;
        for (const c of carriers) {
          const d = c.mover.body.position.distanceTo(victim.mover.body.position);
          if (d < bestD) { bestD = d; best = c; }
        }
        state.spike.carrier = best;
        if (best !== player) best.hasSpike = true;
        if (best === player) hud.setSpike('SPIKE — you carry it. Plant at A or B with E.');
      } else state.spike.carrier = null;
    }
    const vAlive = [player, ...allyBots].some((a) => a.alive);
    const cAlive = enemyBots.some((a) => a.alive);
    if (state.phase === 'round') {
      if (!vAlive) endRound('C', 'Vanguard wiped out.');
      else if (!cAlive && !state.spike.planted) endRound('V', 'Cinder wiped out.');
    }
  }

  function onChannelDone(bot, kind, site) {
    if (kind === 'plant' && state.phase === 'round' && !state.spike.planted) {
      state.spike.planted = true;
      state.spike.site = site;
      state.spike.x = site.x;
      state.spike.z = site.z;
      state.spike.detonateLeft = DETONATE_SECONDS;
      state.spike.carrier = null;
      audio.plantBeep();
      hud.showBanner('SPIKE PLANTED', `Detonation in ${DETONATE_SECONDS}s — Cinder must defuse`, '#ff9a3c');
      hud.setSpike(`SPIKE PLANTED AT ${site.letter} — ${DETONATE_SECONDS}s`);
    } else if (kind === 'defuse' && state.phase === 'round' && state.spike.planted) {
      state.spike.planted = false;
      endRound('C', 'Spike defused.');
    }
  }

  function enemiesOf(bot) {
    return bot.team === 'V' ? enemyBots.concat(player.team === 'C' ? [player] : []) : allyBots.concat([player]);
  }

  function objective(bot, now) {
    const spike = state.spike;
    if (bot.team === 'V') {
      if (spike.planted) return { kind: 'hold', at: [spike.x, spike.z], face: [0, 0] };
      if (bot.hasSpike || spike.carrier === bot) {
        const site = bot.siteTarget || (bot.siteTarget = random() < 0.5 ? map.sites[0] : map.sites[1]);
        return { kind: 'plant', site };
      }
      if (bot.id === 'V0') return { kind: 'hold', at: [-6, 6], face: [0, -8] };
      if (bot.id === 'V1') return { kind: 'hold', at: [6, 6], face: [0, -8] };
      const site = bot.siteTarget || (bot.siteTarget = random() < 0.5 ? map.sites[0] : map.sites[1]);
      return { kind: 'plant', site };
    }
    // Cinder defends.
    if (spike.planted) {
      if (bot.id === 'C3') return { kind: 'hold', at: [spike.x + 4, spike.z + 4], face: [spike.x, spike.z] };
      return { kind: 'defuse', site: spike.site };
    }
    if (bot.id === 'C0') return { kind: 'hold', at: [-13, -8], face: [0, 0] };
    if (bot.id === 'C1') return { kind: 'hold', at: [13, -8], face: [0, 0] };
    if (bot.id === 'C2') return { kind: 'hold', at: [0, -8], face: [0, 8] };
    return { kind: 'hold', at: [6, -4], face: [0, 8] };
  }

  function buy(item) {
    if (state.phase !== 'buy') return;
    if (item.kind === 'weapon') {
      if (state.owned.has(item.id)) {
        weaponRack.equip(item.id);
        player.weapon = item.id;
        audio.buy();
        return;
      }
      if (state.money < item.price) { audio.denied(); return; }
      state.money -= item.price;
      state.owned.add(item.id);
      weaponRack.buy(item.id);
      weaponRack.equip(item.id);
      player.weapon = item.id;
      audio.buy();
    } else if (item.kind === 'armor') {
      if (state.money < item.price || player.armor >= 50) { audio.denied(); return; }
      state.money -= item.price;
      player.armor = 50;
      audio.buy();
    } else if (item.kind === 'grenade') {
      if (state.money < item.price || player.grenades >= 2) { audio.denied(); return; }
      state.money -= item.price;
      player.grenades += 1;
      audio.buy();
    } else if (item.kind === 'ammo') {
      if (state.money < item.price) { audio.denied(); return; }
      state.money -= item.price;
      weaponRack.refillAll();
      audio.buy();
    }
    hud.setMoney(state.money);
    hud.refreshBuy(state.money);
  }

  function playerShoot(now) {
    const def = weaponRack.def();
    if (!weaponRack.canFire()) {
      if (weaponRack.ammo().mag <= 0 && weaponRack.state.cooldown === 0 && now - lastDry > 0.3) {
        lastDry = now;
        audio.dry();
      }
      return;
    }
    if (!weaponRack.takeRound()) return;
    camera.getWorldDirection(aimDir);
    camPos.copy(camera.position);
    const spread = weaponRack.spread(player.mover.groundSpeed());
    const result = combat.shoot(player, camPos, aimDir, def, spread, random, now);
    weaponRack.pullTrigger();
    player.mover.recoil(def.recoil, (random() * 2 - 1) * def.recoil * 0.3);
    audio.shot(def.id);
    if (result && result.agent) {
      hud.hitMarker(result.killed);
      if (result.agent.team === 'C') audio.hit();
    }
    hud.setAmmo(weaponRack.ammo().mag, weaponRack.ammo().reserve, def.name);
  }

  function updatePlayer(dt, now) {
    if (!player.alive) {
      input.consumePresses();
      return;
    }
    const keys = input.state.keys;
    const move = {
      forward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      strafe: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
    };
    const walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    const speedScale = weaponRack.def().speed * (walking ? 0.55 : 1);
    player.mover.step(dt, move, keys.has('Space'), crouching, speedScale);
    const look = input.takeLook();
    const sens = weaponRack.state.zoomed ? 0.0009 : 0.0022;
    player.mover.look(look.x, look.y, sens);

    // Footsteps.
    if (player.mover.groundSpeed() > 1 && player.mover.body.onGround && now - lastStepSound > 0.38) {
      lastStepSound = now;
      audio.step();
    }

    // Weapon switching.
    const slots = ['pistol', 'rifle', 'smg', 'dmr', 'shotgun'];
    for (let i = 0; i < slots.length; i += 1) {
      if (input.wasPressed(`Digit${i + 1}`) && state.owned.has(slots[i])) {
        weaponRack.equip(slots[i]);
        player.weapon = slots[i];
        audio.click();
        hud.setAmmo(weaponRack.ammo().mag, weaponRack.ammo().reserve, weaponRack.def().name);
      }
    }
    if (input.wasPressed('KeyR') && weaponRack.reload()) audio.reload();
    if (input.wasPressed('KeyG') && player.grenades > 0 && state.phase === 'round') {
      player.grenades -= 1;
      camera.getWorldDirection(aimDir);
      combat.throwGrenade(player, camera.position, aimDir);
    }
    // Zoom for the DMR.
    const wantZoom = input.state.aiming && weaponRack.def().zoom === 1;
    if (wantZoom !== weaponRack.state.zoomed) {
      weaponRack.setZoomed(wantZoom);
      fovTarget = wantZoom ? 30 : 74;
      hud.setScope(wantZoom);
    }

    // Firing.
    const def = weaponRack.def();
    if (state.phase === 'round' && player.alive) {
      if (def.auto) {
        if (input.state.firing) playerShoot(now);
      } else if (input.state.firing && weaponRack.state.cooldown === 0) {
        playerShoot(now);
        input.state.firing = false;
      }
    }

    // Plant / defuse with E (hold). The player attacks, so only planting.
    const nearSite = map.sites.find((s) => Math.hypot(player.mover.body.position.x - s.x, player.mover.body.position.z - s.z) < 3.4);
    if (state.phase === 'round' && player.alive && state.spike.carrier === player && !state.spike.planted && nearSite && keys.has('KeyE')) {
      plantProgress += dt;
      hud.setPlantProgress(`PLANTING SPIKE — ${nearSite.letter}`, plantProgress / PLANT_SECONDS);
      if (plantProgress >= PLANT_SECONDS) {
        plantProgress = 0;
        hud.setPlantProgress(null);
        onChannelDone(player, 'plant', nearSite);
      }
    } else {
      if (plantProgress > 0) hud.setPlantProgress(null);
      plantProgress = 0;
      if (state.phase === 'round' && player.alive && state.spike.carrier === player && !state.spike.planted && nearSite) {
        hud.setHint('Hold E to plant the spike');
      } else hud.setHint('');
    }

    // Buy menu: number keys buy while it is open.
    if (hud.isBuyOpen()) {
      for (let i = 1; i <= 8; i += 1) {
        if (input.wasPressed(`Digit${i}`)) hud.buyKey(i);
      }
    }
    // Buy menu.
    if (input.wasPressed('KeyB') && state.phase === 'buy') {
      if (hud.isBuyOpen()) {
        hud.hideBuyMenu();
        input.requestLock();
      } else {
        hud.showBuyMenu(state.money, buy);
        if (document.pointerLockElement) document.exitPointerLock();
      }
    }
    if (input.wasPressed('KeyB') && state.phase === 'round') {
      hud.showBuyMenu(state.money, () => {});
      setTimeout(() => hud.hideBuyMenu(), 1200);
      hud.setHint('Buying is only open between rounds');
    }
  }

  function syncPlayerBody() {
    const b = player.mover.body;
    player.group.position.set(b.position.x, b.position.y, b.position.z);
    player.group.rotation.y = b.yaw;
  }

  function syncCamera() {
    const b = player.mover.body;
    if (player.alive) {
      camera.position.set(b.position.x, b.position.y + b.eye, b.position.z);
      camera.rotation.set(b.pitch, b.yaw, 0, 'YXZ');
    } else if (state.spectate) {
      const s = state.spectate.mover.body;
      camera.position.set(s.position.x, s.position.y + s.eye, s.position.z);
      camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
    }
    const targetFov = fovTarget;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * 0.2;
      camera.updateProjectionMatrix();
    }
  }

  function step(dt, now) {
    if (state.phase === 'menu' || state.phase === 'matchEnd') return;
    if (state.phase === 'buy') {
      state.buyLeft -= dt;
      hud.setTimer(state.buyLeft, false);
      updatePlayer(dt, now);
      for (const b of [...allyBots, ...enemyBots]) {
        b.group.position.set(b.mover.body.position.x, b.mover.body.position.y, b.mover.body.position.z);
        b.group.rotation.y = b.mover.body.yaw;
      }
      if (state.buyLeft <= 0) startRound();
    } else if (state.phase === 'round') {
      state.roundLeft -= dt;
      // Spike detonation.
      if (state.spike.planted) {
        state.spike.detonateLeft -= dt;
        hud.setTimer(state.spike.detonateLeft, true);
        hud.setSpike(`SPIKE PLANTED AT ${state.spike.site.letter} — ${Math.ceil(state.spike.detonateLeft)}s`);
        if (Math.floor(state.spike.detonateLeft) !== Math.floor(state.spike.detonateLeft + dt)) audio.spikeBeep(state.spike.detonateLeft < 10);
        if (state.spike.detonateLeft <= 0) {
          combat.explodeAt(new THREE.Vector3(state.spike.x, 1, state.spike.z), 1);
          audio.explode();
          endRound('V', 'Spike detonated.');
        }
      } else {
        hud.setTimer(state.roundLeft, false);
        if (state.roundLeft <= 0) endRound('C', 'Time expired — spike never planted.');
      }
      if (state.phase === 'round') {
        updatePlayer(dt, now);
        // Bots.
        const ctx = { enemiesOf, objective, onChannelDone };
        for (const b of [...allyBots, ...enemyBots]) {
          bots.stepBot(b, dt, now, ctx);
          b.group.position.set(b.mover.body.position.x, b.mover.body.position.y, b.mover.body.position.z);
          if (b.alive) b.group.rotation.y = b.mover.body.yaw;
        }
        // Bot channel progress display when a bot plants/defuses.
        const channelBot = [...allyBots, ...enemyBots].find((b) => b.channel);
        if (channelBot && channelBot.channel.kind === 'plant') {
          hud.setPlantProgress('ENEMY PLANTING — stop them!', channelBot.channelProgress / PLANT_SECONDS);
        } else if (!plantProgress) hud.setPlantProgress(null);
      }
    } else if (state.phase === 'roundEnd') {
      state.roundEndLeft -= dt;
      for (const b of [...allyBots, ...enemyBots]) {
        if (!b.alive && b.fall >= 1 && now - b.deathTime > 4) b.group.position.y -= dt * 0.2;
      }
      if (state.roundEndLeft <= 0) {
        if (state.scoreV >= ROUNDS_TO_WIN || state.scoreC >= ROUNDS_TO_WIN) endMatch();
        else {
          state.round += 1;
          startBuyPhase();
        }
      }
    }
    syncPlayerBody();
    syncCamera();
    weaponRack.step(dt);
    combat.step(dt, now);

    // HUD.
    hud.setHealth(player.hp, player.armor);
    hud.setAmmo(weaponRack.ammo().mag, weaponRack.ammo().reserve, weaponRack.def().name);
    hud.setMoney(state.money);
    hud.setRoundScore(state.scoreV, state.scoreC, state.round);
    hud.setCrosshairSpread(weaponRack.spread(player.mover.groundSpeed()) * 900 + 4);
    minimapTimer += dt;
    if (minimapTimer > 0.1) {
      minimapTimer = 0;
      hud.drawMinimap(allAgents, player, state.spike.planted ? { planted: true, x: state.spike.x, z: state.spike.z } : null);
    }
  }

  function startMatch() {
    makeBots();
    state.round = 1;
    state.scoreV = 0;
    state.scoreC = 0;
    state.money = START_MONEY;
    state.lossStreak = 0;
    state.kills = 0;
    state.deaths = 0;
    state.owned = new Set(['pistol']);
    player.alive = true;
    player.hp = 100;
    player.armor = 0;
    player.grenades = 0;
    weaponRack.equip('pistol');
    weaponRack.refillAll();
    player.weapon = 'pistol';
    state.started = true;
    state.spectate = null;
    startBuyPhase();
  }

  // Deterministic setups for screenshots: ?shot=start|play|end&seed=N.
  function setupShot(name, seed) {
    const rng = mulberry32(seed || 1);
    state.shotMode = name;
    makeBots();
    state.round = name === 'end' ? 2 : 1;
    state.scoreV = name === 'end' ? 1 : 0;
    state.scoreC = 0;
    state.money = name === 'start' ? 800 : 3250;
    state.owned = new Set(['pistol', 'rifle', 'smg']);
    weaponRack.buy('rifle');
    weaponRack.equip('rifle');
    player.weapon = 'rifle';
    player.alive = true;
    player.hp = name === 'play' ? 76 : 100;
    player.armor = 50;
    player.grenades = 1;
    for (const b of [...allyBots, ...enemyBots]) {
      botLoadout(b, 3);
      b.alive = true;
      b.hp = 100;
    }
    if (name === 'start') {
      state.phase = 'buy';
      state.buyLeft = 12;
      resetPositions();
      player.mover.teleport(0.6, 14, 0);
      player.mover.body.pitch = 0;
      hud.setRoundScore(0, 0, 1);
      hud.setMoney(800);
      hud.showOverlay('start');
      return;
    }
    state.phase = 'round';
    state.roundLeft = name === 'end' ? 12 : 68;
    if (name === 'play') {
      // Mid-round firefight west of mid: the player looks down the open lane
      // at two Cinder bots in the clear, an ally on the flank. The shot
      // itself is fired after the settle (see fireOnce), so the tracer and
      // muzzle flash are still alive in the captured frame.
      resetPositions();
      player.mover.teleport(-2, 9.5, 0);
      const e0 = enemyBots[0];
      const e1 = enemyBots[1];
      e0.mover.teleport(-3.5, 3, Math.PI);
      e1.mover.teleport(-8, 2, Math.PI);
      allyBots[0].mover.teleport(-8.5, 4, 0);
      allyBots[1].mover.teleport(7.5, 6, 0);
      allyBots[2].mover.teleport(-3, 12, 0);
      enemyBots[2].mover.teleport(-13, -8, Math.PI);
      enemyBots[3].mover.teleport(13, -8, Math.PI);
      for (const b of [...allyBots, ...enemyBots]) {
        b.group.position.set(b.mover.body.position.x, 0, b.mover.body.position.z);
        b.group.rotation.y = b.mover.body.yaw;
      }
      // Aim at the first enemy; fireOnce() pulls the trigger after the settle.
      const target = new THREE.Vector3(-3.5, 1.2, 3);
      const pp = player.mover.body.position;
      player.mover.body.yaw = Math.atan2(-(target.x - pp.x), -(target.z - pp.z));
      player.mover.body.pitch = 0.02;
      syncPlayerBody();
      syncCamera();
      hud.setHealth(76, 50);
      hud.setMoney(3250);
      hud.setRoundScore(0, 0, 1);
      hud.setTimer(68, false);
      hud.setAmmo(weaponRack.ammo().mag, weaponRack.ammo().reserve, weaponRack.def().name);
      hud.hideOverlay();
      return;
    }
    // end: round won, banner up, one enemy down in view.
    resetPositions();
    player.mover.teleport(-2, 6, 0);
    const e0 = enemyBots[0];
    e0.mover.teleport(-4.5, -2, Math.PI);
    e0.alive = false;
    e0.fall = 1;
    e0.group.rotation.x = -1.45;
    e0.group.position.set(-4.5, -0.1, -2);
    enemyBots[1].mover.teleport(4, -4, Math.PI);
    for (const b of [...allyBots, ...enemyBots]) {
      if (b.alive) {
        b.group.position.set(b.mover.body.position.x, 0, b.mover.body.position.z);
        b.group.rotation.y = b.mover.body.yaw;
      }
    }
    const target = new THREE.Vector3(-4.5, 1.2, -2);
    const pp = player.mover.body.position;
    player.mover.body.yaw = Math.atan2(-(target.x - pp.x), -(target.z - pp.z));
    syncPlayerBody();
    syncCamera();
    state.scoreV = 1;
    hud.setRoundScore(1, 0, 2);
    hud.setMoney(4050);
    hud.setHealth(100, 25);
    hud.showBanner('VANGUARD WINS', 'Cinder wiped out.', '#2ec4b6');
    hud.hideOverlay();
  }

  return {
    state,
    player,
    step,
    startMatch,
    setupShot,
    // Screenshot helper: fire one round from the player's weapon right before
    // the frame is captured, so the tracer and muzzle flash are still alive.
    fireOnce(now) {
      if (state.phase === 'round' && player.alive) playerShoot(now);
    },
    onLockChange(locked) {
      if (state.shotMode) return;
      if (locked) {
        if (state.phase === 'menu') {
          hud.hideOverlay();
          startMatch();
        } else if (state.phase === 'matchEnd') {
          hud.hideOverlay();
          startMatch();
        } else {
          hud.hideOverlay();
        }
      } else if (state.phase === 'round' || state.phase === 'buy') {
        if (!hud.isBuyOpen()) hud.showOverlay('paused');
      }
    },
    onPlayClick() {
      if (state.phase === 'menu' || state.phase === 'matchEnd') {
        audio.unlock();
        input.requestLock();
      } else {
        input.requestLock();
      }
    },
  };
}
