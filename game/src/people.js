// People on foot: pedestrians who stroll the sidewalks and flee from gunfire and crashes,
// and foot police who chase the player at one star and try to bust them when close and slow.
// Nothing here draws; render.js does that. Coordinates are x (east) and z (south).

import { PLAYER } from './config.js';
import { chance, pick, range } from './rng.js';

const SKINS = [0xe8c39e, 0xc98d64, 0x8d5a3b, 0xf0c8a0];
const SHIRTS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0xecf0f1, 0x1abc9c, 0xe67e22];

export function createPed(random, city, x, z) {
  return {
    kind: 'ped',
    x, z,
    angle: range(random, 0, Math.PI * 2),
    speed: range(random, 1.1, 1.9),
    skin: pick(random, SKINS),
    shirt: pick(random, SHIRTS),
    state: 'walk', // walk | flee | down
    target: null,
    wait: range(random, 0, 4),
    node: city.nearestNode(x, z),
    route: [],
    routeIndex: 0,
    downTimer: 0,
    walkPhase: range(random, 0, Math.PI * 2),
  };
}

/** A sidewalk point near a road: pedestrians walk the edges of the road graph. */
function sidewalkPoint(random, city) {
  const node = city.nodes[Math.floor(random() * city.nodes.length)];
  return { x: node.x + range(random, -11, 11), z: node.z + range(random, -11, 11) };
}

export function spawnPed(random, city, nearX, nearZ) {
  const spot = sidewalkPoint(random, city);
  const x = nearX === undefined ? spot.x : nearX + range(random, -75, 75);
  const z = nearZ === undefined ? spot.z : nearZ + range(random, -75, 75);
  return createPed(random, city, x, z);
}

/** One step for a pedestrian. `danger` is {x, z, radius} or null (gunfire / crash nearby). */
export function stepPed(random, city, ped, dt, danger) {
  if (ped.state === 'down') {
    ped.downTimer -= dt;
    if (ped.downTimer <= 0) ped.state = 'walk';
    return;
  }
  if (danger) {
    const dx = ped.x - danger.x;
    const dz = ped.z - danger.z;
    const d = Math.hypot(dx, dz);
    if (d < danger.radius) {
      ped.state = 'flee';
      ped.fleeX = danger.x;
      ped.fleeZ = danger.z;
      ped.fleeTimer = 2.5;
    }
  }
  if (ped.state === 'flee') {
    ped.fleeTimer -= dt;
    if (ped.fleeTimer <= 0) ped.state = 'walk';
    const dx = ped.x - ped.fleeX;
    const dz = ped.z - ped.fleeZ;
    const d = Math.hypot(dx, dz) || 1;
    ped.angle = Math.atan2(dz, dx);
    ped.x += Math.cos(ped.angle) * 3.8 * dt;
    ped.z += Math.sin(ped.angle) * 3.8 * dt;
    ped.walkPhase += dt * 11;
    city.resolveCircle(ped, 0.5);
    return;
  }
  ped.wait -= dt;
  if (ped.wait > 0) return;
  if (!ped.target) {
    ped.target = sidewalkPoint(random, city);
  }
  const dx = ped.target.x - ped.x;
  const dz = ped.target.z - ped.z;
  const d = Math.hypot(dx, dz);
  if (d < 3) {
    ped.target = null;
    ped.wait = range(random, 1, 5);
    return;
  }
  ped.angle = Math.atan2(dz, dx);
  ped.x += Math.cos(ped.angle) * ped.speed * dt;
  ped.z += Math.sin(ped.angle) * ped.speed * dt;
  ped.walkPhase += dt * 7;
  city.resolveCircle(ped, 0.5);
}

export function createFootCop(random, x, z) {
  return {
    kind: 'cop',
    x, z,
    angle: 0,
    speed: 5,
    skin: 0xe8c39e,
    shirt: 0x1a1a2e,
    state: 'chase',
    target: null,
    wait: 0,
    node: -1,
    route: [],
    routeIndex: 0,
    downTimer: 0,
    bustTimer: 0,
    walkPhase: 0,
  };
}

/**
 * One step for a foot cop. Chases the player on foot; when close and the player is slow,
 * counts down to a bust. Returns 'busted' when the bust completes, else null.
 */
export function stepFootCop(city, cop, dt, player) {
  const dx = player.x - cop.x;
  const dz = player.z - cop.z;
  const d = Math.hypot(dx, dz);
  cop.angle = Math.atan2(dz, dx);
  const speed = player.onFoot ? PLAYER.onFootSpeed : 0;
  if (d > 175) {
    // Too far: jog toward the player through the streets.
    cop.x += Math.cos(cop.angle) * cop.speed * dt;
    cop.z += Math.sin(cop.angle) * cop.speed * dt;
  } else if (d > PLAYER.bustDistance) {
    cop.x += Math.cos(cop.angle) * cop.speed * 1.05 * dt;
    cop.z += Math.sin(cop.angle) * cop.speed * 1.05 * dt;
    cop.bustTimer = 0;
  } else if (player.onFoot && speed < PLAYER.bustMaxSpeed) {
    cop.bustTimer += dt;
    if (cop.bustTimer > 1.2) return 'busted';
  } else {
    cop.bustTimer = 0;
  }
  cop.walkPhase += dt * 9;
  city.resolveCircle(cop, 0.5);
  return null;
}
