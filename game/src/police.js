// The wanted system: heat and stars, cruisers that pursue on the road graph, PIT rams,
// roadblocks at three stars and a helicopter at four. A crime only counts when the police
// can see it — heat decays when the player is out of sight.

import { WANTED } from './config.js';
import { createCar, stepCar } from './vehicles.js';
import { createFootCop, stepFootCop } from './people.js';
import { angleDiff, chance, clamp } from './rng.js';

export function createPolice() {
  return {
    heat: 0,
    stars: 0,
    cruisers: [],
    footCops: [],
    heli: { active: false, x: 0, z: 0, angle: 0, height: 55 },
    roadblocks: [],
    spawnTimer: 0,
    seenTimer: 0,
  };
}

export function starsForHeat(heat) {
  let stars = 0;
  for (let s = 0; s < WANTED.thresholds.length; s += 1) {
    if (heat >= WANTED.thresholds[s]) stars = s;
  }
  return Math.min(5, stars);
}

/** Add heat for a crime. `seen` is whether any police witnessed it. */
export function addHeat(police, amount, seen) {
  if (!seen) amount *= 0.4;
  police.heat = Math.min(100, police.heat + amount);
  police.stars = starsForHeat(police.heat);
}

/** Can the police see the player? A cruiser or foot cop within sight, or the helicopter. */
export function policeCanSee(police, player) {
  if (police.heli.active) {
    const d = Math.hypot(police.heli.x - player.x, police.heli.z - player.z);
    if (d < 105) return true;
  }
  for (const cruiser of police.cruisers) {
    if (Math.hypot(cruiser.x - player.x, cruiser.z - player.z) < WANTED.sight) return true;
  }
  for (const cop of police.footCops) {
    if (Math.hypot(cop.x - player.x, cop.z - player.z) < WANTED.sight * 0.7) return true;
  }
  return false;
}

function spawnCruiser(random, city, player) {
  // Appear on a road edge offscreen from the player.
  for (let tries = 0; tries < 8; tries += 1) {
    const spot = city.randomRoadPoint(random);
    const d = Math.hypot(spot.x - player.x, spot.z - player.z);
    if (d > 175 && d < 350) {
      const cruiser = createCar('cruiser', spot.x, spot.z, spot.angle);
      cruiser.driver = 'police';
      cruiser.siren = true;
      cruiser.node = city.nearestNode(spot.x, spot.z);
      cruiser.route = city.route(cruiser.node, city.nearestNode(player.x, player.z));
      cruiser.routeIndex = 1;
      return cruiser;
    }
  }
  return null;
}

function spawnRoadblock(random, city, player) {
  // Two cruisers parked across the road ahead of the player.
  const heading = player.onFoot ? player.angle : (player.car ? player.car.angle : 0);
  const aheadX = player.x + Math.cos(heading) * 105;
  const aheadZ = player.z + Math.sin(heading) * 105;
  const road = city.roadAt(aheadX, aheadZ);
  if (!road) return null;
  const blocks = [];
  for (let i = -1; i <= 1; i += 2) {
    const perp = road.vertical ? 0 : Math.PI / 2;
    const bx = aheadX + Math.cos(perp) * i * 6.5;
    const bz = aheadZ + Math.sin(perp) * i * 6.5;
    const car = createCar('cruiser', bx, bz, road.vertical ? Math.PI / 2 : 0);
    car.driver = 'police';
    car.parked = true;
    car.siren = true;
    blocks.push(car);
  }
  return blocks;
}

/** One step of the whole wanted system. Returns 'busted' | 'wasted' | null. */
export function stepPolice(random, city, police, dt, player, cars) {
  // Heat decays when unseen; faster when far from every cruiser (properly hidden).
  const seen = policeCanSee(police, player);
  if (seen) police.seenTimer = 0;
  else police.seenTimer += dt;
  if (!seen && police.heat > 0) {
    let nearest = Infinity;
    for (const cruiser of police.cruisers) {
      nearest = Math.min(nearest, Math.hypot(cruiser.x - player.x, cruiser.z - player.z));
    }
    police.heat = Math.max(0, police.heat - (nearest > 175 ? WANTED.decayHidden : WANTED.decayUnseen) * dt);
  }
  if (police.heli.active && seen) {
    const d = Math.hypot(police.heli.x - player.x, police.heli.z - player.z);
    if (d < 105) police.heat = Math.min(100, police.heat + WANTED.heliHeat * dt);
  }
  const stars = starsForHeat(police.heat);
  police.stars = stars;

  // Foot cops at one star: they chase and try to bust the player on foot.
  if (stars === 1 && police.footCops.length < 2 && chance(random, dt * 0.3)) {
    const spot = city.randomRoadPoint(random);
    if (Math.hypot(spot.x - player.x, spot.z - player.z) > 125) {
      police.footCops.push(createFootCop(random, spot.x, spot.z));
    }
  }
  if (stars === 0) police.footCops.length = 0;

  // Cruisers: spawn up to the star count, despawn when the heat is gone.
  police.spawnTimer -= dt;
  const want = WANTED.cruisers[stars];
  if (police.cruisers.length < want && police.spawnTimer <= 0) {
    const cruiser = spawnCruiser(random, city, player);
    if (cruiser) {
      police.cruisers.push(cruiser);
      cars.push(cruiser);
    }
    police.spawnTimer = 2.5;
  }
  if (stars === 0) {
    for (const cruiser of police.cruisers) {
      const index = cars.indexOf(cruiser);
      if (index !== -1) cars.splice(index, 1);
    }
    police.cruisers.length = 0;
    police.roadblocks.length = 0;
    police.heli.active = false;
  }

  // Pursuit: re-route toward the player every couple of seconds, then drive the route.
  for (const cruiser of police.cruisers) {
    cruiser.retarget = (cruiser.retarget ?? 0) - dt;
    if (cruiser.retarget <= 0) {
      cruiser.route = city.route(cruiser.node, city.nearestNode(player.x, player.z));
      cruiser.routeIndex = 1;
      cruiser.retarget = 2;
    }
    if (cruiser.routeIndex >= cruiser.route.length) {
      cruiser.node = city.nearestNode(cruiser.x, cruiser.z);
      cruiser.route = city.route(cruiser.node, city.nearestNode(player.x, player.z));
      cruiser.routeIndex = 1;
    }
    const target = city.nodes[cruiser.route[cruiser.routeIndex]];
    const dx = target.x - cruiser.x;
    const dz = target.z - cruiser.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 7) {
      cruiser.node = cruiser.route[cruiser.routeIndex];
      cruiser.routeIndex += 1;
      continue;
    }
    // Close in: at two stars and above, steer straight at the player to ram — but a
    // ram is a slow shove, not a full-speed slam: within 35 units the cruiser eases off,
    // so a chase stays a chase instead of a wreck in seconds.
    const playerDist = Math.hypot(player.x - cruiser.x, player.z - cruiser.z);
    let wantAngle = Math.atan2(dz, dx);
    if (stars >= 2 && playerDist < 80) wantAngle = Math.atan2(player.z - cruiser.z, player.x - cruiser.x);
    const diff = angleDiff(cruiser.angle, wantAngle);
    const throttle = playerDist < 35 ? 0.45 : 0.85;
    stepCar(cruiser, dt, { throttle, steer: clamp(diff * 2.4, -1, 1), handbrake: false });
  }

  // Roadblocks at three stars: one set, refreshed when the player gets far away.
  if (stars >= 3 && police.roadblocks.length === 0 && chance(random, dt * 0.2)) {
    const blocks = spawnRoadblock(random, city, player);
    if (blocks) {
      for (const block of blocks) {
        police.roadblocks.push(block);
        cars.push(block);
      }
    }
  }

  // Helicopter at four stars: circles the player, spotlight follows.
  if (stars >= 4) {
    police.heli.active = true;
    police.heli.angle += dt * 0.9;
    police.heli.x = player.x + Math.cos(police.heli.angle) * 48;
    police.heli.z = player.z + Math.sin(police.heli.angle) * 48 - 15;
  } else {
    police.heli.active = false;
  }

  // Foot cops step; a completed bust ends the run.
  for (const cop of police.footCops) {
    if (cop.state === 'down') continue;
    const result = stepFootCop(city, cop, dt, player);
    if (result === 'busted') return 'busted';
  }
  return null;
}

/** Clear all heat (spray shop): stars fall to zero and the chase ends. */
export function clearWanted(police, cars) {
  police.heat = 0;
  police.stars = 0;
  for (const cruiser of police.cruisers) {
    const index = cars.indexOf(cruiser);
    if (index !== -1) cars.splice(index, 1);
  }
  police.cruisers.length = 0;
  police.footCops.length = 0;
  police.roadblocks.length = 0;
  police.heli.active = false;
}
