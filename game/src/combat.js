// Combat: hitscan shooting, damage with armour, tracers, impact sparks,
// grenades (flash + blast), and the agent registry every shooter and target
// shares. The game owns rounds and money; this module only resolves fights.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_LIFE = 0.07;
const SPARK_LIFE = 0.3;

export function createCombat(scene, map, audio, effects) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 120;
  const agents = [];
  const dir = new THREE.Vector3();
  const origin = new THREE.Vector3();

  // Pooled tracers: one thin additive line each, reused, never allocated in a frame.
  const tracers = [];
  for (let i = 0; i < 24; i += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  // Pooled impact sparks: small bright spheres that pop and fade.
  const sparks = [];
  const sparkGeo = new THREE.SphereGeometry(0.07, 6, 5);
  for (let i = 0; i < 16; i += 1) {
    const mesh = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0xffd27d, transparent: true, opacity: 0 }));
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0 });
  }
  let sparkIndex = 0;

  // Pooled muzzle flashes for bots (a sprite that shows for one frame or two).
  const flashes = [];
  for (let i = 0; i < 8; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.visible = false;
    scene.add(mesh);
    flashes.push({ mesh, life: 0 });
  }
  let flashIndex = 0;

  // Pooled explosion visuals: an expanding fireball plus a point light.
  const explosions = [];
  for (let i = 0; i < 4; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff8c2e, transparent: true, opacity: 0, depthWrite: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    const light = new THREE.PointLight(0xff8c2e, 0, 22, 1.4);
    scene.add(light);
    explosions.push({ mesh, light, life: 0, scale: 1 });
  }
  let explosionIndex = 0;

  function explodeAt(pos, scale = 1) {
    const e = explosions[explosionIndex];
    explosionIndex = (explosionIndex + 1) % explosions.length;
    e.mesh.position.copy(pos);
    e.mesh.position.y = Math.max(1, pos.y);
    e.mesh.visible = true;
    e.mesh.scale.setScalar(0.5);
    e.mesh.material.opacity = 0.9;
    e.light.position.copy(e.mesh.position);
    e.light.intensity = 60;
    e.life = 0.6;
    e.scale = scale;
  }

  const grenades = [];

  function spawnTracer(from, to) {
    const t = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % tracers.length;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.material.opacity = 0.85;
    t.life = TRACER_LIFE;
  }

  function spawnSpark(point) {
    const s = sparks[sparkIndex];
    sparkIndex = (sparkIndex + 1) % sparks.length;
    s.mesh.position.copy(point);
    s.mesh.visible = true;
    s.mesh.material.opacity = 1;
    s.mesh.scale.setScalar(1);
    s.life = SPARK_LIFE;
  }

  function spawnFlash(point, yaw) {
    const f = flashes[flashIndex];
    flashIndex = (flashIndex + 1) % flashes.length;
    f.mesh.position.copy(point);
    f.mesh.rotation.y = yaw;
    f.mesh.visible = true;
    f.mesh.material.opacity = 0.95;
    f.life = 0.06;
  }

  function agentMeshes(except) {
    const list = [];
    for (const a of agents) {
      if (!a.alive || a === except) continue;
      list.push(a.headMesh, a.torsoMesh);
    }
    return list;
  }

  function hasLineOfSight(from, to) {
    dir.copy(to).sub(from);
    const dist = dir.length();
    if (dist < 0.01) return true;
    dir.normalize();
    raycaster.set(from, dir);
    raycaster.far = dist;
    const hits = raycaster.intersectObjects(map.shootables, false);
    return hits.length === 0;
  }

  function damageAgent(target, amount, attacker, part) {
    if (!target.alive) return false;
    let remaining = amount;
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, remaining * 0.5);
      target.armor -= absorbed;
      remaining -= absorbed;
    }
    target.hp -= remaining;
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.deathTime = 0; // set from game time on first dead step
      if (target.onDeath) target.onDeath(attacker, part);
      return true;
    }
    return false;
  }

  // One hitscan shot. Returns { hit, agent, part, point, killed }.
  function shoot(shooter, from, aimDir, def, spread, random, now) {
    if (shooter.blindUntil && now < shooter.blindUntil) spread *= 3;
    const pellets = def.pellets || 1;
    let best = null;
    for (let p = 0; p < pellets; p += 1) {
      dir.copy(aimDir);
      dir.x += (random() * 2 - 1) * spread;
      dir.y += (random() * 2 - 1) * spread;
      dir.z += (random() * 2 - 1) * spread;
      dir.normalize();
      origin.copy(from);
      raycaster.set(origin, dir);
      raycaster.far = 120;
      const targets = map.shootables.concat(agentMeshes(shooter));
      const hits = raycaster.intersectObjects(targets, false);
      const hit = hits[0];
      if (!hit) continue;
      const end = hit.point.clone();
      spawnTracer(from, end);
      if (hit.object.userData.agent) {
        const victim = hit.object.userData.agent;
        if (victim !== shooter && victim.alive) {
          const part = hit.object.userData.part || 'torso';
          const amount = def.damage * (part === 'head' ? def.headMult : 1);
          const killed = damageAgent(victim, amount, shooter, part);
          if (!best || killed) best = { hit: true, agent: victim, part, point: end, killed };
          else if (!best) best = { hit: true, agent: victim, part, point: end, killed: false };
          spawnSpark(end);
        }
      } else {
        spawnSpark(end);
        if (!best) best = { hit: true, agent: null, part: null, point: end, killed: false };
      }
    }
    return best || { hit: false, agent: null, part: null, point: null, killed: false };
  }

  function throwGrenade(owner, from, aimDir) {
    const g = {
      owner,
      pos: from.clone(),
      vel: aimDir.clone().multiplyScalar(16).add(new THREE.Vector3(0, 5.5, 0)),
      fuse: 1.7,
      mesh: new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.4, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.6 })),
    };
    g.mesh.position.copy(g.pos);
    scene.add(g.mesh);
    grenades.push(g);
    audio.throwPin();
    return g;
  }

  function detonate(g, now) {
    scene.remove(g.mesh);
    const pos = g.pos;
    audio.explode();
    if (effects.onExplosion) effects.onExplosion(pos);
    explodeAt(pos, 0.6);
    spawnSpark(pos);
    for (const a of agents) {
      if (!a.alive) continue;
      const d = a.mover.body.position.distanceTo(pos) + 1.6;
      if (d < 5) {
        const amount = 70 * (1 - d / 5.5);
        damageAgent(a, amount, g.owner, 'blast');
      }
      if (d < 15) {
        const eye = new THREE.Vector3(a.mover.body.position.x, a.mover.body.position.y + a.mover.body.eye, a.mover.body.position.z);
        if (hasLineOfSight(pos, eye)) {
          a.blindUntil = now + 2.4;
          if (a.isPlayer && effects.onPlayerFlash) effects.onPlayerFlash(2.0);
        }
      }
    }
  }

  function step(dt, now) {
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, (t.life / TRACER_LIFE) * 0.85);
      }
    }
    for (const s of sparks) {
      if (s.life > 0) {
        s.life -= dt;
        s.mesh.material.opacity = Math.max(0, s.life / SPARK_LIFE);
        s.mesh.scale.addScalar(dt * 3);
        if (s.life <= 0) s.mesh.visible = false;
      }
    }
    for (const f of flashes) {
      if (f.life > 0) {
        f.life -= dt;
        f.mesh.material.opacity = Math.max(0, f.life / 0.06) * 0.95;
        if (f.life <= 0) f.mesh.visible = false;
      }
    }
    for (const e of explosions) {
      if (e.life > 0) {
        e.life -= dt;
        const k = 1 - e.life / 0.6;
        e.mesh.scale.setScalar((0.5 + k * 7) * e.scale);
        e.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
        e.light.intensity = Math.max(0, 60 * (1 - k));
        if (e.life <= 0) {
          e.mesh.visible = false;
          e.light.intensity = 0;
        }
      }
    }
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= 14 * dt;
      g.pos.addScaledVector(g.vel, dt);
      if (g.pos.y < 0.1) {
        g.pos.y = 0.1;
        g.vel.y *= -0.35;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      if (g.pos.x < -21.5 || g.pos.x > 21.5) g.vel.x *= -0.4;
      if (g.pos.z < -17.5 || g.pos.z > 17.5) g.vel.z *= -0.4;
      g.mesh.position.copy(g.pos);
      if (g.fuse <= 0) {
        detonate(g, now);
        grenades.splice(i, 1);
      }
    }
  }

  return {
    agents,
    registerAgent(agent) {
      agents.push(agent);
    },
    clearAgents() {
      agents.length = 0;
    },
    shoot,
    damageAgent,
    hasLineOfSight,
    throwGrenade,
    explodeAt,
    spawnFlash,
    spawnTracer,
    step,
  };
}
