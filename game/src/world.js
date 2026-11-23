// The game's rules and state, with no drawing and no browser in it: the player, the cars,
// the people, the police, the missions, the particles. step() advances one fixed step and
// returns what happened as bit flags, so the caller can react without the world knowing
// about screens or sound. The world is built from one seed, so the same seed always gives
// the same city, traffic and missions. Coordinates are x (east) and z (south); y is up.

import { MONEY, PISTOL, PLAYER, RADII, STEP, WANTED } from './config.js';
import { chance, createRandom, int, pick, range } from './rng.js';
import { buildCity } from './city.js';
import { collideCars, collideWorld, createCar, nearestCar, spawnParkedCar, spawnTrafficCar, stepCar, stepTraffic } from './vehicles.js';
import { createPed, spawnPed, stepPed } from './people.js';
import { addHeat, clearWanted, createPolice, policeCanSee, stepPolice } from './police.js';
import { createCombat, firePistol, punch, stepOnFoot } from './combat.js';
import { createMissions, offerTaxiFare, placePackages, startMission, stepMissions } from './missions.js';

export const EVENT_HIT = 1;
export const EVENT_PICKUP = 2;
export const EVENT_WASTED = 4;
export const EVENT_BUSTED = 8;
export const EVENT_MISSION = 16;
export const EVENT_SHOT = 32;
export const EVENT_FAIL = 64;

const TRAFFIC_WANT = 8;
const PED_WANT = 14;

function addParticle(state, x, z, vx, vz, life, color, size) {
  if (state.particles.length > 240) return;
  state.particles.push({ x, z, vx, vz, life, maxLife: life, color, size });
}

function burst(rng, state, x, z, count, color, speed, life) {
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * Math.PI * 2;
    const v = range(rng, speed * 0.4, speed);
    addParticle(state, x, z, Math.cos(angle) * v, Math.sin(angle) * v, range(rng, life * 0.5, life), color, range(rng, 0.2, 0.5));
  }
}

export function createWorld(random, seed) {
  const state = {
    seed,
    elapsed: 0,
    player: null,
    cars: [],
    peds: [],
    police: null,
    missions: null,
    combat: null,
    city: null,
    particles: [],
    tracers: [],
    airTime: 0,
    cash: 0,
    respect: 0,
    sprayCooldown: 0,
    ammoCooldown: 0,
    trafficTimer: 0,
    pedTimer: 0,
    taxiTimer: 8,
    over: false,
  };

  function build() {
    const rng = createRandom(seed);
    state.rng = createRandom(seed + 1);
    state.city = buildCity(rng);
    state.police = createPolice();
    state.missions = createMissions(state.city);
    state.combat = createCombat();
    state.particles = [];
    state.tracers = [];
    state.elapsed = 0;
    state.airTime = 0;
    state.sprayCooldown = 0;
    state.ammoCooldown = 0;
    state.trafficTimer = 0;
    state.pedTimer = 0;
    state.taxiTimer = 8;
    state.over = false;

    const spots = state.city.spots;
    state.player = {
      x: spots.player.x, z: spots.player.z,
      angle: 0, vx: 0, vz: 0,
      onFoot: true, health: PLAYER.health,
      cash: 50, respect: 0, speed: 0,
      car: null, invuln: 0, walkPhase: 0,
    };

    // The Comet GT waits in the marina lot; other parked cars fill the lots.
    state.cars = [];
    const comet = createCar('coupe', spots.comet.x, spots.comet.z, Math.PI / 2, 0x8e44ad);
    comet.parked = true;
    state.cars.push(comet);
    const parkedTypes = ['sedan', 'sedan', 'van', 'truck', 'sedan'];
    for (const type of parkedTypes) {
      state.cars.push(spawnParkedCar(rng, state.city, type));
    }
    for (let i = 0; i < TRAFFIC_WANT; i += 1) {
      state.cars.push(spawnTrafficCar(rng, state.city, pick(rng, ['sedan', 'sedan', 'taxi', 'van', 'truck'])));
    }

    state.peds = [];
    for (let i = 0; i < PED_WANT; i += 1) {
      state.peds.push(spawnPed(rng, state.city));
    }

    placePackages(rng, state.city, state.missions);
    startMission(state.missions, state.city, 0);
  }

  function reset() {
    build();
  }

  function damagePlayer(amount, cause) {
    const player = state.player;
    if (player.invuln > 0) return 0;
    player.health -= amount;
    player.invuln = 0.6;
    if (player.health <= 0) {
      player.health = 0;
      state.over = true;
      return EVENT_WASTED;
    }
    return EVENT_HIT;
  }

  function enterCar() {
    const player = state.player;
    if (!player.onFoot) return;
    const car = nearestCar(state.cars, player.x, player.z, RADII.enterCar);
    if (!car || car.driver === 'police') return;
    const wasParked = car.parked;
    const wasTraffic = car.driver === 'traffic';
    car.driver = 'player';
    car.parked = false;
    player.onFoot = false;
    player.car = car;
    player.x = car.x;
    player.z = car.z;
    player.angle = car.angle;
    if (wasParked || wasTraffic) {
      addHeat(state.police, WANTED.crime.steal, policeCanSee(state.police, player));
      state.missions.dialogue = car.type === 'coupe' ? 'Nice ride. It is yours now.' : 'Borrowed. Keep it moving.';
      state.missions.dialogueTimer = 3;
    }
  }

  function exitCar() {
    const player = state.player;
    if (player.onFoot || !player.car) return;
    const car = player.car;
    car.driver = null;
    car.parked = true;
    car.vx = 0;
    car.vz = 0;
    player.onFoot = true;
    player.car = null;
    player.x = car.x + Math.cos(car.angle + Math.PI / 2) * 3;
    player.z = car.z + Math.sin(car.angle + Math.PI / 2) * 3;
    player.vx = 0;
    player.vz = 0;
    state.city.resolveCircle(player, PLAYER.radius);
  }

  function step(dt, controls, harmless) {
    let events = 0;
    state.elapsed += dt;
    const player = state.player;
    const city = state.city;
    const police = state.police;

    if (player.invuln > 0) player.invuln -= dt;
    if (state.sprayCooldown > 0) state.sprayCooldown -= dt;
    if (state.ammoCooldown > 0) state.ammoCooldown -= dt;
    if (state.airTime > 0) state.airTime -= dt;

    // One-shot actions.
    if (controls.enter) {
      if (player.onFoot) enterCar();
      else exitCar();
    }

    if (player.onFoot) {
      stepOnFoot(city, player, state.combat, dt, { x: controls.moveX, z: controls.moveZ });
      if (controls.punch) {
        const hit = punch(player, state.combat, [...state.peds, ...police.footCops]);
        if (hit) {
          addHeat(police, WANTED.crime.assault, policeCanSee(police, player));
          burst(state.rng, state, hit.x, hit.z, 6, 0xf1c40f, 12, 0.4);
        }
      }
      if (controls.fire) {
        const shot = firePistol(city, player, state.combat, controls.aimX, controls.aimZ, [...state.peds, ...police.footCops], state.cars);
        if (shot && shot.kind === 'shot') {
          events |= EVENT_SHOT;
          state.tracers.push({ x1: shot.fromX, z1: shot.fromZ, x2: shot.fromX + Math.cos(shot.angle) * shot.length, z2: shot.fromZ + Math.sin(shot.angle) * shot.length, life: 0.07 });
          addParticle(state, player.x + Math.cos(shot.angle) * 2, player.z + Math.sin(shot.angle) * 2, 0, 0, 0.08, 0xffd700, 0.5);
          if (shot.hit && shot.hit.kind === 'person') {
            const seen = policeCanSee(police, player);
            addHeat(police, shot.hit.target.kind === 'cop' ? WANTED.crime.kill : WANTED.crime.assault, seen);
            burst(state.rng, state, shot.hit.target.x, shot.hit.target.z, 10, 0xc0392b, 16, 0.5);
          }
          // Everyone nearby hears the shot and runs.
          state.danger = { x: player.x, z: player.z, radius: 80 };
        }
      }
    } else if (player.car) {
      const car = player.car;
      const speedBefore = car.speed;
      stepCar(car, dt, { throttle: controls.throttle, steer: controls.steer, handbrake: controls.handbrake });
      player.x = car.x;
      player.z = car.z;
      player.angle = car.angle;
      player.vx = car.vx;
      player.vz = car.vz;
      player.speed = car.speed;
      const hitWall = collideWorld(city, car);
      if (hitWall && speedBefore > 26) {
        events |= damagePlayer((speedBefore - 26) * 0.6, 'crash');
        burst(state.rng, state, car.x, car.z, 8, 0xf39c12, 20, 0.4);
      }
      // Spray shop: drive in slowly with a wanted level and enough cash.
      if (state.sprayCooldown <= 0 && police.stars > 0 && player.cash >= MONEY.sprayPrice) {
        const spray = city.spots.spray;
        if (Math.hypot(spray.x - player.x, spray.z - player.z) < RADII.shop) {
          player.cash -= MONEY.sprayPrice;
          clearWanted(police, state.cars);
          state.sprayCooldown = 6;
          state.missions.dialogue = `Resprayed for $${MONEY.sprayPrice}. The cops lost you.`;
          state.missions.dialogueTimer = 4;
        }
      }
      // Ammo shop: drive through to top up the pistol.
      if (state.ammoCooldown <= 0 && state.combat.ammo < PISTOL.magSize && player.cash >= PISTOL.ammoPrice) {
        const ammo = city.spots.ammo;
        if (Math.hypot(ammo.x - player.x, ammo.z - player.z) < RADII.shop) {
          player.cash -= PISTOL.ammoPrice;
          state.combat.ammo = PISTOL.magSize;
          state.ammoCooldown = 6;
          state.missions.dialogue = `Ammo restocked for $${PISTOL.ammoPrice}.`;
          state.missions.dialogueTimer = 3;
        }
      }
    }

    // Traffic keeps driving; the police keep hunting; people keep walking.
    const traffic = state.cars.filter((car) => car.driver === 'traffic');
    for (const car of traffic) {
      stepTraffic(state.rng, city, car, dt, traffic);
      collideWorld(city, car);
    }
    // Car-vs-car collisions (player's car included).
    for (let i = 0; i < state.cars.length; i += 1) {
      for (let j = i + 1; j < state.cars.length; j += 1) {
        const a = state.cars[i];
        const b = state.cars[j];
        if (a.parked && b.parked) continue;
        if (collideCars(a, b)) {
          if ((a === player.car || b === player.car) && player.car && player.car.speed > 24) {
            events |= damagePlayer(6, 'crash');
          }
          const other = a === player.car ? b : b === player.car ? a : null;
          if (other && other.driver === 'police') {
            addHeat(police, WANTED.crime.crashCop, true);
          }
        }
      }
    }

    if (!harmless) {
      const result = stepPolice(state.rng, city, police, dt, player, state.cars);
      if (result === 'busted') {
        state.over = true;
        events |= EVENT_BUSTED;
      }
    }

    // Pedestrians: flee from gunfire, from fast cars, and get knocked down by them.
    for (const ped of state.peds) {
      stepPed(state.rng, city, ped, dt, state.danger ?? null);
      if (ped.state !== 'down') {
        for (const car of state.cars) {
          if (car.parked || car.speed < 12) continue;
          if (Math.hypot(car.x - ped.x, car.z - ped.z) < 2.6) {
            ped.state = 'down';
            ped.downTimer = 6;
            if (!harmless) addHeat(police, WANTED.crime.kill, policeCanSee(police, player));
            burst(state.rng, state, ped.x, ped.z, 8, 0xc0392b, 14, 0.5);
            break;
          }
        }
      }
    }
    state.danger = null;

    // Keep the streets busy: top traffic and pedestrians up near the player.
    state.trafficTimer -= dt;
    if (state.trafficTimer <= 0) {
      state.trafficTimer = 2;
      const trafficCount = state.cars.filter((car) => car.driver === 'traffic').length;
      if (trafficCount < TRAFFIC_WANT) {
        const car = spawnTrafficCar(state.rng, city, pick(state.rng, ['sedan', 'taxi', 'van']));
        state.cars.push(car);
      }
      for (let i = state.cars.length - 1; i >= 0; i -= 1) {
        const car = state.cars[i];
        if (car.driver === 'traffic' && Math.hypot(car.x - player.x, car.z - player.z) > 450) {
          state.cars.splice(i, 1);
        }
      }
    }
    state.pedTimer -= dt;
    if (state.pedTimer <= 0) {
      state.pedTimer = 3;
      if (state.peds.length < PED_WANT) {
        state.peds.push(spawnPed(state.rng, city, player.x, player.z));
      }
      for (let i = state.peds.length - 1; i >= 0; i -= 1) {
        const ped = state.peds[i];
        if (Math.hypot(ped.x - player.x, ped.z - player.z) > 375) state.peds.splice(i, 1);
      }
    }

    // Taxi fares show up now and then when the player is driving.
    state.taxiTimer -= dt;
    if (state.taxiTimer <= 0) {
      state.taxiTimer = 25;
      if (!player.onFoot && !harmless) offerTaxiFare(state.rng, city, state.missions, player);
    }

    // Missions and side work.
    if (!harmless) {
      const missionEvent = stepMissions(state.rng, city, state.missions, dt, {
        player, police, city, cars: state.cars, airTime: state.airTime,
      });
      if (missionEvent === 'mission-complete') events |= EVENT_MISSION;
      else if (missionEvent === 'mission-failed') events |= EVENT_FAIL;
      else if (missionEvent === 'package' || missionEvent === 'fare' || missionEvent === 'jump') events |= EVENT_PICKUP;
    }

    // Smoke from wrecked cars.
    for (const car of state.cars) {
      if (car.smoke > 0 && chance(state.rng, dt * 8)) {
        addParticle(state, car.x + range(state.rng, -0.8, 0.8), car.z + range(state.rng, -0.8, 0.8), range(state.rng, -1, 1), range(state.rng, -3, -1), 0.8, 0x7f8c8d, 0.5);
      }
    }

    // Particles and tracers age out.
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const p = state.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      if (p.life <= 0) state.particles.splice(i, 1);
    }
    for (let i = state.tracers.length - 1; i >= 0; i -= 1) {
      state.tracers[i].life -= dt;
      if (state.tracers[i].life <= 0) state.tracers.splice(i, 1);
    }

    // Speeding past a cruiser adds a little heat.
    if (!harmless && !player.onFoot && player.car && player.car.speed > 46) {
      for (const cruiser of police.cruisers) {
        if (Math.hypot(cruiser.x - player.x, cruiser.z - player.z) < 75) {
          addHeat(police, WANTED.crime.speedPast * dt, true);
          break;
        }
      }
    }

    return events;
  }

  build();
  return { state, reset, step };
}
