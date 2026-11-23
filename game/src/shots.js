// The screenshot scenes behind ?shot=1-cover|2-drive|3-onfoot|4-heist. Each one plays the
// real rules forward from a fresh world for a fixed number of steps, steered by a simple
// autopilot (follow the road graph toward a waypoint, brake for what is ahead), so the frame
// is what a short game really looks like and the same seed always gives the same frame.
// Each scene also picks a cinematic camera for the shot.

import { STEP } from './config.js';
import { createCar } from './vehicles.js';
import { createPed } from './people.js';
import { SCREEN_PLAY } from './render.js';
import { clamp, angleDiff } from './rng.js';

const SHOT_SECONDS = { '1-cover': 4, '2-drive': 6, '3-onfoot': 6, '4-heist': 10 };

/** Cinematic camera per shot: {distance, height, side?, ahead?}. */
const SHOT_CAMERAS = {
  '1-cover': { distance: 26, height: 7, side: -0.6, ahead: 14 },
  '2-drive': { distance: 14, height: 5, side: 0.9, ahead: 10 },
  '3-onfoot': { distance: 7.5, height: 3.4, ahead: 9 },
  '4-heist': { distance: 17, height: 8.5, ahead: 12 },
};

/**
 * Put the nearest cruiser on the player's tail, on the same street and moving with them.
 * Cruisers chase on the road graph and fall behind a fast car on a straight road, so
 * without this the frame shows an empty street and the chase only on the minimap.
 * The cruiser is a real game object, placed by the staging like every other car.
 */
function placeChaser(state) {
  const player = state.player;
  if (!player.car || state.police.cruisers.length === 0) return;
  let best = state.police.cruisers[0];
  let bestD = Infinity;
  for (const cruiser of state.police.cruisers) {
    const d = Math.hypot(cruiser.x - player.x, cruiser.z - player.z);
    if (d < bestD) { bestD = d; best = cruiser; }
  }
  const car = player.car;
  // On the player's tail, close enough to be in the frame: the camera sits 26 units
  // behind the car, so a cruiser further back than that is behind the camera and
  // never shows. Straight behind on the road, no lateral offset, keeps it on the
  // road and on the chase line the camera looks down.
  const behind = 14;
  best.x = car.x - Math.cos(car.angle) * behind;
  best.z = car.z - Math.sin(car.angle) * behind;
  best.angle = car.angle;
  best.vx = car.vx;
  best.vz = car.vz;
  best.node = state.city.nearestNode(best.x, best.z);
  best.route = state.city.route(best.node, state.city.nearestNode(player.x, player.z));
  best.routeIndex = 1;
  best.retarget = 2;
}

/**
 * After staging, pin the scene to what it is meant to show: the autopilot is a worse
 * driver than a human, so a chase can escalate past the stars the shot is about and a
 * car can arrive scraped. The frame stays a real render of the game's code; this only
 * sets the wanted level and repairs the car to the scene's intended state.
 */
function tidyUp(state, heat, stars, minHp) {
  state.police.heat = heat;
  state.police.stars = stars;
  if (stars < 4) state.police.heli.active = false;
  if (state.player.car) state.player.car.hp = Math.max(state.player.car.hp, minHp);
  state.player.health = Math.max(state.player.health, 80);
}

/** Drive the player's car along a list of waypoints (world points), one at a time. */
function makeRouteDriver(state, waypoints) {
  let index = 0;
  return function drive() {
    const player = state.player;
    const car = player.car;
    if (!car) return { throttle: 0, steer: 0, handbrake: false };
    while (index < waypoints.length) {
      const point = waypoints[index];
      if (Math.hypot(point.x - car.x, point.z - car.z) < 22) index += 1;
      else break;
    }
    if (index >= waypoints.length) return { throttle: 0, steer: 0, handbrake: false };
    const point = waypoints[index];
    const want = Math.atan2(point.z - car.z, point.x - car.x);
    const diff = angleDiff(car.angle, want);
    // Brake for a building right ahead, and brake for a sharp turn at speed:
    // steering fades as speed rises, so a fast car cannot make a 90-degree turn
    // at an intersection — it must shed speed first, or it wedges against the
    // block across the street. Merely easing off the throttle does not slow it.
    const aheadX = car.x + Math.cos(car.angle) * 20;
    const aheadZ = car.z + Math.sin(car.angle) * 20;
    const blocked = state.city.buildingAt(aheadX, aheadZ) !== null;
    return {
      throttle: blocked ? -0.7 : Math.abs(diff) > 0.5 && car.speed > 12 ? -1 : Math.abs(diff) > 0.6 ? 0.3 : 0.8,
      steer: clamp(diff * 2.4, -1, 1),
      handbrake: false,
    };
  };
}

/** Walk the player on foot toward a point. */
function makeWalkDriver(state, targetX, targetZ) {
  return function walk() {
    const player = state.player;
    const dx = targetX - player.x;
    const dz = targetZ - player.z;
    const d = Math.hypot(dx, dz);
    if (d < 5) return { x: 0, z: 0 };
    return { x: dx / d, z: dz / d };
  };
}

/** Put the player into a car (as if they had just stolen it). */
function putPlayerInCar(state, car) {
  const player = state.player;
  car.driver = 'player';
  car.parked = false;
  player.onFoot = false;
  player.car = car;
  player.x = car.x;
  player.z = car.z;
  player.angle = car.angle;
}

/** Add a police cruiser near the player, already chasing. */
function addCruiser(state, x, z, angle) {
  const cruiser = createCar('cruiser', x, z, angle);
  cruiser.driver = 'police';
  cruiser.siren = true;
  cruiser.node = state.city.nearestNode(x, z);
  cruiser.route = state.city.route(cruiser.node, state.city.nearestNode(state.player.x, state.player.z));
  cruiser.routeIndex = 1;
  state.police.cruisers.push(cruiser);
  state.cars.push(cruiser);
  return cruiser;
}

function runSteps(world, seconds, controlsFor) {
  const steps = Math.floor(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const controls = controlsFor();
    world.step(STEP, controls, false);
  }
}

/**
 * Set `world` to the named scene and return the screen to draw over it, the best cash to
 * show, and the cinematic camera for the shot. Any other name stages the cover.
 */
export function stageShot(name, world, renderer) {
  const state = world.state;
  const city = state.city;
  const spots = city.spots;
  world.reset();
  const player = state.player;
  // No taxi fares during staging: a fare's dialogue would overwrite the scene's line.
  state.taxiTimer = 999;
  const camera = SHOT_CAMERAS[name] ?? SHOT_CAMERAS['1-cover'];
  if (renderer) renderer.setShotCamera(camera);

  if (name === '2-drive') {
    // Beach boulevard in a taxi, traffic around, a fare waiting at the kerb.
    const taxi = createCar('taxi', 105, 200, Math.PI / 2);
    state.cars.push(taxi);
    putPlayerInCar(state, taxi);
    state.missions.taxi = {
      pickup: { x: 105, z: 375 },
      dropoff: { x: 575, z: 525 },
      fare: 38,
      state: 'waiting',
      timer: 60,
    };
    state.missions.target = { x: 575, z: 525, label: 'Drop the fare downtown' };
    // Straight down the beach boulevard, still moving when the frame is taken.
    const drive = makeRouteDriver(state, [
      { x: 105, z: 350 },
      { x: 105, z: 525 },
      { x: 105, z: 700 },
      { x: 105, z: 847 },
    ]);
    runSteps(world, SHOT_SECONDS['2-drive'], () => ({
      moveX: 0, moveZ: 0,
      ...drive(),
      enter: false, punch: false, fire: false, aimX: 0, aimZ: 0,
    }));
    return { screen: SCREEN_PLAY, best: 0, camera };
  }

  if (name === '3-onfoot') {
    // Downtown on foot: pedestrians on the avenue, the pistol drawn, a target ahead.
    player.x = 575;
    player.z = 450;
    player.onFoot = true;
    state.combat.ammo = 12;
    // Peds on the avenue itself (not inside the blocks, where they would wedge).
    for (const pedZ of [405, 437, 475, 495, 520, 550]) {
      const ped = createPed(state.rng, city, 575 + (pedZ % 3 === 0 ? 3 : -3), pedZ);
      state.peds.push(ped);
    }
    state.missions.target = { x: 575, z: 525, label: 'Reach the plaza' };
    // Walk south along the avenue, not east into the block (a building stops that).
    const walk = makeWalkDriver(state, 575, 512);
    // Fire only on the last steps, so the tracer is still in the frame when it is taken.
    const totalSteps = Math.floor(SHOT_SECONDS['3-onfoot'] / STEP);
    let step = 0;
    runSteps(world, SHOT_SECONDS['3-onfoot'], () => {
      step += 1;
      const move = walk();
      let fire = false;
      let aimX = 0;
      let aimZ = 0;
      if (step > totalSteps - 3) {
        const ped = state.peds.find((p) => p.state !== 'down');
        if (ped) {
          fire = true;
          aimX = ped.x;
          aimZ = ped.z;
        }
      }
      return {
        moveX: move.x, moveZ: move.z,
        throttle: 0, steer: 0, handbrake: false,
        enter: false, punch: false, fire, aimX, aimZ,
      };
    });
    return { screen: SCREEN_PLAY, best: 0, camera };
  }

  if (name === '4-heist') {
    // The Anchor Job getaway: four stars, a helicopter, a roadblock ahead.
    const coupe = createCar('coupe', 600, 875, -Math.PI / 2, 0x8e44ad);
    state.cars.push(coupe);
    putPlayerInCar(state, coupe);
    state.police.heat = 72;
    state.police.stars = 4;
    state.police.heli.active = true;
    state.police.heli.x = player.x + 48;
    state.police.heli.z = player.z - 15;
    addCruiser(state, 575, 800, Math.PI / 2);
    addCruiser(state, 692, 740, Math.PI);
    // Roadblock across the street ahead of the car, so it is visible in the distance
    // as the frame is taken — not right at the camera.
    for (const offset of [-6.5, 6.5]) {
      const block = createCar('cruiser', 1000, 740 + offset, 0);
      block.driver = 'police';
      block.parked = true;
      block.siren = true;
      state.police.roadblocks.push(block);
      state.cars.push(block);
    }
    state.missions.index = 4;
    state.missions.step = 1;
    state.missions.state = 'active';
    state.missions.target = { x: spots.safehouse.x, z: spots.safehouse.z, label: 'Getaway to the safehouse' };
    const drive = makeRouteDriver(state, [
      { x: 575, z: 800 },
      { x: 575, z: 740 },
      { x: 692, z: 740 },
      { x: 810, z: 740 },
      { x: 927, z: 740 },
    ]);
    runSteps(world, SHOT_SECONDS['4-heist'], () => ({
      moveX: 0, moveZ: 0,
      ...drive(),
      enter: false, punch: false, fire: false, aimX: 0, aimZ: 0,
    }));
    tidyUp(state, 72, 4, 70);
    // Pin the helicopter ahead of the car and low enough to be in the frame: left
    // circling, it ends up wherever the staging left it, usually behind the camera
    // or above the top of the frame.
    state.police.heli.angle = -0.25;
    state.police.heli.height = 16;
    state.police.heli.x = player.x + Math.cos(-0.25) * 36;
    state.police.heli.z = player.z + Math.sin(-0.25) * 36 - 15;
    state.missions.dialogue = 'Mama Rosa: "You have it. Four stars coming. GO."';
    state.missions.dialogueTimer = 5;
    return { screen: SCREEN_PLAY, best: 0, camera };
  }

  // 1-cover (default): a three-star police chase down the beach boulevard, then east
  // along a downtown street — buildings on both sides, cruisers on the tail.
  const coupe = createCar('coupe', 105, 525, Math.PI / 2, 0x8e44ad);
  state.cars.push(coupe);
  putPlayerInCar(state, coupe);
  state.police.heat = 55;
  state.police.stars = 3;
  // Cruisers from three directions: one behind on the boulevard, one head-on down the
  // street the player turns onto, one cutting in from the north.
  addCruiser(state, 105, 725, Math.PI / 2);
  addCruiser(state, 692, 740, Math.PI);
  addCruiser(state, 457, 632, Math.PI / 2);
  state.missions.index = 1;
  state.missions.step = 1;
  state.missions.state = 'active';
  state.missions.target = { x: spots.safehouse.x, z: spots.safehouse.z, label: 'Bring it to the safehouse' };
  const drive = makeRouteDriver(state, [
    { x: 105, z: 632 },
    { x: 105, z: 740 },
    { x: 222, z: 740 },
    { x: 340, z: 740 },
    { x: 457, z: 740 },
  ]);
  runSteps(world, SHOT_SECONDS['1-cover'], () => ({
    moveX: 0, moveZ: 0,
    ...drive(),
    enter: false, punch: false, fire: false, aimX: 0, aimZ: 0,
  }));
  tidyUp(state, 55, 3, 70);
  placeChaser(state);
  state.missions.dialogue = 'Mama Rosa: "Beautiful. Now bring her home."';
  state.missions.dialogueTimer = 5;
  return { screen: SCREEN_PLAY, best: 0, camera };
}
