// Bot AI: waypoint routes, line-of-sight perception, burst fire with reaction
// time and aim error, hearing, planting and defusing. Bots share the player's
// movement physics (mover) and the combat module's shooting, so a bot fight
// and a player fight resolve by the same rules.
import * as THREE from 'three';
import { createMover } from './mover.js';
import { WEAPONS } from './weapons.js';
import { PALETTE } from './palette.js';

const ALLY_NAMES = ['Sable', 'Kestrel', 'Onyx'];
const ENEMY_NAMES = ['Ash', 'Rook', 'Vex', 'Hale'];

function buildBody(scene, team, name) {
  const teamColor = team === 'V' ? PALETTE.teal : PALETTE.rust;
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.65, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#23262b'), roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a184'), roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), cloth);
  torso.position.y = 1.05;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skin);
  head.position.y = 1.58;
  head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), emissive: new THREE.Color(teamColor), emissiveIntensity: 0.8 }));
  visor.position.set(0, 1.6, -0.14);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), dark);
  legL.position.set(-0.14, 0.31, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), dark);
  gun.position.set(0.22, 1.15, -0.3);
  group.add(torso, head, visor, legL, legR, gun);
  scene.add(group);
  return { group, torso, head, gun };
}

export function createBot(scene, team, index, spawn, skill) {
  const name = team === 'V' ? ALLY_NAMES[index % ALLY_NAMES.length] : ENEMY_NAMES[index % ENEMY_NAMES.length];
  const mover = createMover([], { x: spawn[0], z: spawn[1], walkSpeed: 3.4 + skill * 0.9 });
  // Bots collide with the same world the player does; colliders are injected by the game.
  const body = buildBody(scene, team, name);
  const bot = {
    id: `${team}${index}`,
    team,
    name,
    isPlayer: false,
    hp: 100,
    armor: 0,
    alive: true,
    mover,
    group: body.group,
    headMesh: body.head,
    torsoMesh: body.torso,
    gunMesh: body.gun,
    weapon: 'pistol',
    ammo: { mag: 12, reserve: 36 },
    blindUntil: 0,
    skill,
    state: 'route',
    path: [],
    pathIndex: 0,
    target: null,
    lastSeen: -10,
    lastSeenPos: new THREE.Vector3(),
    heardPos: null,
    heardAt: -10,
    reactionAt: 0,
    burstLeft: 0,
    nextShotAt: 0,
    pauseUntil: 0,
    holdUntil: 0,
    holdPos: null,
    siteTarget: null,
    channel: null, // {kind:'plant'|'defuse', until, site}
    channelProgress: 0,
    strafeDir: 1,
    strafeUntil: 0,
    stuckAt: 0,
    lastPos: new THREE.Vector3(spawn[0], 0, spawn[1]),
    aimError: 0.02 + (1 - skill) * 0.02,
    fall: 0,
    deathTime: 0,
    onDeath: null,
    hasSpike: false,
  };
  body.torso.userData.agent = bot;
  body.torso.userData.part = 'torso';
  body.head.userData.agent = bot;
  body.head.userData.part = 'head';
  return bot;
}

export function createBotController(combat, map, audio, random) {
  const eye = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const aimDir = new THREE.Vector3();
  const muzzle = new THREE.Vector3();

  function eyePos(bot) {
    const p = bot.mover.body.position;
    eye.set(p.x, p.y + bot.mover.body.eye, p.z);
    return eye;
  }

  function chestPos(agent) {
    const p = agent.mover.body.position;
    return new THREE.Vector3(p.x, p.y + 1.15, p.z);
  }

  function canSee(bot, enemy, now) {
    const from = eyePos(bot).clone();
    const to = chestPos(enemy);
    const d = from.distanceTo(to);
    if (d > 46) return false;
    if (bot.blindUntil > now) return false;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const ang = Math.atan2(-dx, -dz);
    let diff = ang - bot.mover.body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const recentlySeen = now - bot.lastSeen < 2.5;
    if (!recentlySeen && Math.abs(diff) > 1.1) return false;
    return combat.hasLineOfSight(from, to);
  }

  function nearestVisibleEnemy(bot, enemies, now) {
    let best = null;
    let bestD = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = bot.mover.body.position.distanceTo(e.mover.body.position);
      if (d < bestD && canSee(bot, e, now)) { best = e; bestD = d; }
    }
    return best;
  }

  function faceToward(bot, x, z, dt, rate = 6) {
    const dx = x - bot.mover.body.position.x;
    const dz = z - bot.mover.body.position.z;
    const want = Math.atan2(-dx, -dz);
    let diff = want - bot.mover.body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.mover.body.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
  }

  function followPath(bot, dt, speedScale) {
    if (!bot.path.length || bot.pathIndex >= bot.path.length) return false;
    const [tx, tz] = bot.path[bot.pathIndex];
    const dx = tx - bot.mover.body.position.x;
    const dz = tz - bot.mover.body.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) {
      bot.pathIndex += 1;
      return bot.pathIndex < bot.path.length;
    }
    faceToward(bot, tx, tz, dt, 5);
    const sin = Math.sin(bot.mover.body.yaw);
    const cos = Math.cos(bot.mover.body.yaw);
    const fwd = -sin * dx + -cos * dz;
    const str = cos * dx + -sin * dz;
    const len = Math.hypot(fwd, str) || 1;
    bot.mover.step(dt, { forward: fwd / len, strafe: str / len }, false, false, speedScale);
    return true;
  }

  function setPath(bot, toX, toZ) {
    const p = bot.mover.body.position;
    bot.path = map.findPath(p.x, p.z, toX, toZ);
    bot.pathIndex = 0;
  }

  function botShoot(bot, target, now) {
    const def = WEAPONS[bot.weapon];
    if (bot.ammo.mag <= 0) {
      bot.ammo.mag = def.mag;
      bot.ammo.reserve = Math.max(0, bot.ammo.reserve - def.mag);
      if (bot.ammo.reserve <= 0 && bot.ammo.mag <= 0) return;
      bot.pauseUntil = now + def.reloadTime;
      return;
    }
    if (now < bot.nextShotAt || now < bot.pauseUntil) return;
    const from = eyePos(bot).clone();
    const to = chestPos(target);
    if (Math.random() < 0.22) to.y = 1.58; // aim for the head sometimes
    aimDir.copy(to).sub(from).normalize();
    const dist = from.distanceTo(to);
    const moving = target.mover ? target.mover.groundSpeed() : 0;
    const err = bot.aimError * (0.7 + dist / 40 + moving / 12);
    muzzle.copy(from).addScaledVector(aimDir, 0.7);
    muzzle.y -= 0.15;
    combat.spawnFlash(muzzle, bot.mover.body.yaw);
    const result = combat.shoot(bot, from, aimDir, def, err, random, now);
    bot.ammo.mag -= 1;
    bot.nextShotAt = now + def.fireGap * (1.6 + random() * 0.9);
    audio.shot(def.id, dist > 18);
    if (result && result.agent && result.agent.isPlayer && result.agent.alive === false) {
      // kill credit handled by the game's onDeath
    }
    if (bot.burstLeft > 0) {
      bot.burstLeft -= 1;
      if (bot.burstLeft === 0) bot.pauseUntil = now + 0.45 + random() * 0.6;
    }
  }

  function stepBot(bot, dt, now, ctx) {
    const body = bot.mover.body;
    if (!bot.alive) {
      if (bot.deathTime === 0) bot.deathTime = now;
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.1;
      } else if (now - bot.deathTime > 4) {
        bot.group.position.y -= dt * 0.25;
      }
      return;
    }
    const enemies = ctx.enemiesOf(bot);
    const blind = now < bot.blindUntil;

    // Perception, staggered by bot id hash.
    const tick = Math.floor(now * 8 + bot.id.charCodeAt(0)) !== Math.floor((now - dt) * 8 + bot.id.charCodeAt(0));
    if (tick && !blind) {
      const seen = nearestVisibleEnemy(bot, enemies, now);
      if (seen) {
        if (!bot.target) bot.reactionAt = now + 0.35 + (1 - bot.skill) * 0.45 + random() * 0.2;
        bot.target = seen;
        bot.lastSeen = now;
        bot.lastSeenPos.copy(seen.mover.body.position);
      } else if (bot.target && now - bot.lastSeen > 2.2) {
        bot.target = null;
      }
    }

    // Channeling (plant / defuse) breaks on damage or on spotting an enemy.
    if (bot.channel) {
      if (bot.target || blind) {
        bot.channel = null;
        bot.channelProgress = 0;
      } else {
        bot.channelProgress += dt;
        const dur = bot.channel.kind === 'plant' ? 3 : 5;
        if (bot.channelProgress >= dur) {
          const done = bot.channel;
          bot.channel = null;
          bot.channelProgress = 0;
          ctx.onChannelDone(bot, done.kind, done.site);
        }
        return;
      }
    }

    if (blind) {
      bot.target = null;
      bot.mover.step(dt, { forward: 0, strafe: 0 }, false, false, 1);
      return;
    }

    if (bot.target && bot.target.alive && now >= bot.reactionAt) {
      const tp = bot.target.mover.body.position;
      faceToward(bot, tp.x, tp.z, dt, 8);
      // Strafe in bursts while fighting.
      if (now > bot.strafeUntil) {
        bot.strafeDir = random() < 0.5 ? -1 : 1;
        bot.strafeUntil = now + 0.5 + random() * 0.9;
      }
      const dist = body.position.distanceTo(tp);
      let fwd = 0;
      if (dist > 16) fwd = 0.8;
      else if (dist < 4) fwd = -0.6;
      bot.mover.step(dt, { forward: fwd, strafe: bot.strafeDir * 0.7 }, false, false, 0.7);
      if (bot.burstLeft === 0 && now >= bot.pauseUntil) bot.burstLeft = 3 + Math.floor(random() * 3);
      if (bot.burstLeft > 0) botShoot(bot, bot.target, now);
      return;
    }

    // No fight: work the objective.
    const order = ctx.objective(bot, now);
    if (order.kind === 'plant') {
      const site = order.site;
      const d = Math.hypot(body.position.x - site.x, body.position.z - site.z);
      if (d < 2.6) {
        bot.channel = { kind: 'plant', site };
        bot.channelProgress = 0;
        return;
      }
      if (!bot.path.length || bot.pathIndex >= bot.path.length) setPath(bot, site.x, site.z);
      followPath(bot, dt, 1);
    } else if (order.kind === 'defuse') {
      const site = order.site;
      const d = Math.hypot(body.position.x - site.x, body.position.z - site.z);
      if (d < 2.2) {
        bot.channel = { kind: 'defuse', site };
        bot.channelProgress = 0;
        return;
      }
      if (!bot.path.length || bot.pathIndex >= bot.path.length) setPath(bot, site.x, site.z);
      followPath(bot, dt, 1);
    } else if (order.kind === 'hold') {
      const [hx, hz] = order.at;
      const d = Math.hypot(body.position.x - hx, body.position.z - hz);
      if (d > 1.2) {
        if (!bot.path.length || bot.pathIndex >= bot.path.length) setPath(bot, hx, hz);
        followPath(bot, dt, 0.9);
      } else {
        faceToward(bot, order.face[0], order.face[1], dt, 3);
        bot.mover.step(dt, { forward: 0, strafe: 0 }, false, false, 1);
      }
    } else if (order.kind === 'hunt') {
      if (!bot.path.length || bot.pathIndex >= bot.path.length) setPath(bot, order.at[0], order.at[1]);
      followPath(bot, dt, 1);
    }

    // Stuck detection: no progress while routing.
    const moved = Math.hypot(body.position.x - bot.lastPos.x, body.position.z - bot.lastPos.z);
    if (moved < 0.05 && bot.path.length && bot.pathIndex < bot.path.length) {
      bot.stuckAt += dt;
      if (bot.stuckAt > 1.6) {
        bot.path = [];
        bot.stuckAt = 0;
      }
    } else bot.stuckAt = 0;
    bot.lastPos.copy(body.position);

    // Keep the 3D body glued to the mover.
    bot.group.position.set(body.position.x, body.position.y, body.position.z);
    bot.group.rotation.y = body.yaw;
  }

  return {
    stepBot,
    setPath,
    eyePos,
    chestPos,
  };
}
