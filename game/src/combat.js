// On-foot combat: the player's movement, punch and pistol, health and damage. The pistol
// fires toward the mouse; bullets are hitscan with a short tracer, so the feel is instant
// and the code stays deterministic. Movement is camera-relative: WASD moves on the ground
// plane as the camera sees it.

import { PISTOL, PLAYER } from './config.js';

export function createCombat() {
  return {
    ammo: PISTOL.ammoStart,
    reloading: 0,
    fireCooldown: 0,
    punchCooldown: 0,
    muzzle: 0,
    aimX: 0,
    aimZ: 0,
  };
}

/**
 * Move the player on foot. `move` is {x, z} in world space (already camera-relative).
 */
export function stepOnFoot(city, player, combat, dt, move) {
  const length = Math.hypot(move.x, move.z);
  const nx = length > 0 ? move.x / length : 0;
  const nz = length > 0 ? move.z / length : 0;
  player.vx = nx * PLAYER.onFootSpeed;
  player.vz = nz * PLAYER.onFootSpeed;
  player.x += player.vx * dt;
  player.z += player.vz * dt;
  if (length > 0) player.angle = Math.atan2(nz, nx);
  city.resolveCircle(player, PLAYER.radius);
  player.speed = length * PLAYER.onFootSpeed;
  player.walkPhase = (player.walkPhase ?? 0) + dt * (length > 0 ? 9 : 0);
  if (combat.fireCooldown > 0) combat.fireCooldown -= dt;
  if (combat.punchCooldown > 0) combat.punchCooldown -= dt;
  if (combat.muzzle > 0) combat.muzzle -= dt;
  if (combat.reloading > 0) {
    combat.reloading -= dt;
    if (combat.reloading <= 0) combat.ammo = PISTOL.magSize;
  }
}

/** A punch: hits the nearest ped or cop within range in front of the player. */
export function punch(player, combat, targets) {
  if (combat.punchCooldown > 0) return null;
  combat.punchCooldown = PLAYER.punchCooldown;
  const fx = Math.cos(player.angle);
  const fz = Math.sin(player.angle);
  let best = null;
  let bestD = PLAYER.punchRange;
  for (const target of targets) {
    if (target.state === 'down') continue;
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    // Must be roughly in front.
    const dot = (dx * fx + dz * fz) / (d || 1);
    if (dot < 0.3) continue;
    best = target;
    bestD = d;
  }
  if (best) {
    best.state = 'down';
    best.downTimer = 3;
    return best;
  }
  return null;
}

/**
 * Fire the pistol toward (aimX, aimZ) in world space. Hitscan: the first ped, cop, car or
 * building along the line takes the damage. Returns an object describing the shot, or null
 * when it cannot fire (cooling down, reloading, out of ammo).
 */
export function firePistol(city, player, combat, aimX, aimZ, targets, cars) {
  if (combat.fireCooldown > 0 || combat.reloading > 0) return null;
  if (combat.ammo <= 0) {
    combat.reloading = PISTOL.reloadTime;
    return { kind: 'reload' };
  }
  combat.ammo -= 1;
  combat.fireCooldown = PISTOL.fireCooldown;
  combat.muzzle = 0.08;
  const angle = Math.atan2(aimZ - player.z, aimX - player.x);
  const range = PISTOL.range;
  let hitAt = range;
  let hit = null;
  for (const target of targets) {
    if (target.state === 'down') continue;
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    const along = dx * Math.cos(angle) + dz * Math.sin(angle);
    if (along < 0 || along > hitAt) continue;
    const side = Math.abs(-dx * Math.sin(angle) + dz * Math.cos(angle));
    if (side < 0.7) {
      hitAt = along;
      hit = { kind: 'person', target };
    }
  }
  for (const car of cars) {
    const dx = car.x - player.x;
    const dz = car.z - player.z;
    const along = dx * Math.cos(angle) + dz * Math.sin(angle);
    if (along < 0 || along > hitAt) continue;
    const side = Math.abs(-dx * Math.sin(angle) + dz * Math.cos(angle));
    if (side < 1.4) {
      hitAt = along;
      hit = { kind: 'car', target: car };
    }
  }
  // A building stops the bullet.
  const step = 1;
  for (let d = step; d < hitAt; d += step) {
    if (city.buildingAt(player.x + Math.cos(angle) * d, player.z + Math.sin(angle) * d)) {
      hitAt = d;
      hit = { kind: 'wall' };
      break;
    }
  }
  if (hit && hit.kind === 'person') {
    hit.target.state = 'down';
    hit.target.downTimer = 999;
  }
  if (hit && hit.kind === 'car') {
    hit.target.hp -= PISTOL.damage;
    if (hit.target.hp < hit.target.spec.hp * 0.5) hit.target.smoke = 1;
  }
  return {
    kind: 'shot',
    angle,
    length: hitAt,
    hit,
    fromX: player.x,
    fromZ: player.z,
  };
}
