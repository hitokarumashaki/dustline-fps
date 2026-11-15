// Shared first-person movement: acceleration, friction, gravity, crouch and
// jump, resolved as a box against the world's colliders one axis at a time, so
// a wall never swallows the mover. Used by the player and by every bot.
import * as THREE from 'three';

const RADIUS = 0.34;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createMover(colliders, options = {}) {
  const standHeight = options.standHeight ?? 1.72;
  const crouchHeight = options.crouchHeight ?? 1.12;
  const standEye = options.standEye ?? 1.6;
  const crouchEye = options.crouchEye ?? 1.02;
  const walkSpeed = options.walkSpeed ?? 5.2;
  const crouchSpeed = options.crouchSpeed ?? 2.4;
  const groundAccel = options.groundAccel ?? 42;
  const airAccel = options.airAccel ?? 9;
  const friction = options.friction ?? 9;

  const body = {
    position: new THREE.Vector3(options.x ?? 0, 0, options.z ?? 0),
    velocity: new THREE.Vector3(),
    yaw: options.yaw ?? 0,
    pitch: 0,
    eye: standEye,
    onGround: true,
    crouching: false,
    height: standHeight,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return collider;
    }
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  // move: {forward, strafe} in -1..1, already rotated into world space by the
  // caller or in local space with yaw applied here. Local space: forward is -Z
  // when yaw is 0, matching the camera.
  function step(dt, move, wantsJump, wantsCrouch, speedScale = 1) {
    const crouching = wantsCrouch;
    if (crouching && !body.crouching) {
      body.crouching = true;
      body.height = crouchHeight;
    } else if (!crouching && body.crouching && !overlaps(body.position.x, body.position.y, body.position.z, standHeight, 0.02)) {
      body.crouching = false;
      body.height = standHeight;
    }
    const eyeTarget = body.crouching ? crouchEye : standEye;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const sin = Math.sin(body.yaw);
    const cos = Math.cos(body.yaw);
    wish.set(0, 0, 0);
    if (move.forward || move.strafe) {
      wish.set(-sin * move.forward + cos * move.strafe, 0, -cos * move.forward - sin * move.strafe);
      if (wish.lengthSq() > 1) wish.normalize();
    }

    const speed = (body.crouching ? crouchSpeed : walkSpeed) * speedScale;
    const blend = Math.min(1, ((body.onGround ? groundAccel : airAccel) * dt) / speed);
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - friction * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }

    if (wantsJump && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  return {
    body,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    teleport(x, z, yaw) {
      body.position.set(x, 0, z);
      body.velocity.set(0, 0, 0);
      body.yaw = yaw ?? body.yaw;
      body.pitch = 0;
    },
  };
}
