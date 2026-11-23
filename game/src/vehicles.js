// Cars: arcade 3D physics (velocity split forward/lateral, strong lateral grip that the
// handbrake loosens for drift), the car types, traffic that follows the road graph, and
// getting in and out of a car. Nothing here draws; render.js does that. Coordinates are
// x (east) and z (south); a car's heading is the angle whose forward is (cos, sin) in
// (x, z). A mesh built facing local +x needs rotation.y = -angle.

import { CAR_TYPES, WORLD } from './config.js';
import { angleDiff, chance, clamp, pick, range } from './rng.js';

let nextId = 1;

function makeCar(type, x, z, angle, color) {
  const spec = CAR_TYPES[type];
  return {
    id: nextId,
    type,
    x, z,
    angle,
    vx: 0, vz: 0,
    color: color ?? pick(Math.random, spec.colors),
    spec,
    hp: spec.hp,
    driver: null, // 'player' | 'traffic' | 'police' | null (parked)
    parked: false,
    smoke: 0,
    node: -1,
    route: [],
    routeIndex: 0,
    brakeLight: false,
    siren: false,
    speed: 0,
    steerVis: 0,
    wheelSpin: 0,
  };
}

export function createCar(type, x, z, angle, color) {
  const car = makeCar(type, x, z, angle, color);
  nextId += 1;
  return car;
}

/**
 * One physics step for a driven car. `drive` is { throttle: -1..1, steer: -1..1, handbrake }.
 * Forward velocity gets the engine; lateral velocity is damped hard (grip) unless the
 * handbrake is held, which is what makes the car drift.
 */
export function stepCar(car, dt, drive) {
  const forwardX = Math.cos(car.angle);
  const forwardZ = Math.sin(car.angle);
  const rightX = -forwardZ;
  const rightZ = forwardX;

  let forwardSpeed = car.vx * forwardX + car.vz * forwardZ;
  let lateralSpeed = car.vx * rightX + car.vz * rightZ;

  const grip = drive.handbrake ? 1.6 : car.spec.grip;
  lateralSpeed *= Math.exp(-grip * dt);

  if (drive.throttle > 0) forwardSpeed += car.spec.accel * drive.throttle * dt;
  else if (drive.throttle < 0) {
    if (forwardSpeed > 2) forwardSpeed -= car.spec.accel * 1.4 * dt; // brake
    else forwardSpeed += car.spec.accel * 0.55 * drive.throttle * dt; // reverse
  } else {
    forwardSpeed -= forwardSpeed * 0.6 * dt; // rolling drag
  }

  const top = forwardSpeed >= 0 ? car.spec.topSpeed : car.spec.reverseTop;
  forwardSpeed = clamp(forwardSpeed, -top, top);

  // Steering authority grows from a standstill, then fades as speed rises: a car
  // that can still turn at 3 rad/s at top speed spins in circles instead of
  // cornering — full lock at 55 u/s must be a wide fast arc, not a donut. The
  // low-speed end stays strong so the car can still turn out of a parking lot.
  const absSpeed = Math.abs(forwardSpeed);
  const steerAuthority = (Math.min(1, absSpeed / 6) / (1 + absSpeed / 28));
  const reverse = forwardSpeed < 0 ? -1 : 1;
  car.angle += drive.steer * car.spec.turn * steerAuthority * reverse * dt;
  car.steerVis += (clamp(drive.steer, -1, 1) - car.steerVis) * Math.min(1, dt * 8);

  const fx = Math.cos(car.angle);
  const fz = Math.sin(car.angle);
  const rx = -fz;
  const rz = fx;
  car.vx = fx * forwardSpeed + rx * lateralSpeed;
  car.vz = fz * forwardSpeed + rz * lateralSpeed;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.speed = Math.abs(forwardSpeed);
  car.wheelSpin += forwardSpeed * dt;
  car.brakeLight = drive.throttle < 0;
}

/** A parked car, placed on a road edge, facing along the road. */
export function spawnParkedCar(random, city, type) {
  const spot = city.randomRoadPoint(random);
  const car = createCar(type, spot.x, spot.z, spot.angle);
  car.parked = true;
  return car;
}

/** Traffic: a car on the road graph, following edges toward its route's end. */
export function spawnTrafficCar(random, city, type) {
  const spot = city.randomRoadPoint(random);
  const car = createCar(type, spot.x, spot.z, spot.angle);
  car.driver = 'traffic';
  car.node = city.nearestNode(car.x, car.z);
  car.route = [car.node];
  car.routeIndex = 0;
  return car;
}

/** Pick a new route for a traffic car: a random node a few edges away. */
function retargetTraffic(random, city, car) {
  const nodes = city.nodes;
  const target = Math.floor(random() * nodes.length);
  car.route = city.route(car.node, target);
  car.routeIndex = 1;
}

/** Steer a traffic car along its route (lane offset to the right of travel). */
export function stepTraffic(random, city, car, dt, traffic) {
  if (car.routeIndex >= car.route.length) retargetTraffic(random, city, car);
  const target = city.nodes[car.route[car.routeIndex]];
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 7) {
    car.node = car.route[car.routeIndex];
    car.routeIndex += 1;
    return;
  }
  const want = Math.atan2(dz, dx);
  const diff = angleDiff(car.angle, want);
  // Slow down for a car ahead on the same road.
  let ahead = false;
  for (const other of traffic) {
    if (other === car) continue;
    const ox = other.x - car.x;
    const oz = other.z - car.z;
    const along = ox * Math.cos(car.angle) + oz * Math.sin(car.angle);
    const side = Math.abs(-ox * Math.sin(car.angle) + oz * Math.cos(car.angle));
    if (along > 0 && along < 18 && side < 8) { ahead = true; break; }
  }
  const throttle = ahead ? -0.6 : 0.55;
  stepCar(car, dt, { throttle, steer: clamp(diff * 2.2, -1, 1), handbrake: false });
}

/** Circle-vs-circle push between two cars; returns true when they touched. */
export function collideCars(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const min = (a.spec.length + b.spec.length) * 0.45;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min || d2 < 0.0001) return false;
  const d = Math.sqrt(d2);
  const push = (min - d) / 2;
  const nx = dx / d;
  const nz = dz / d;
  a.x -= nx * push;
  a.z -= nz * push;
  b.x += nx * push;
  b.z += nz * push;
  const impact = Math.abs((b.vx - a.vx) * nx + (b.vz - a.vz) * nz);
  if (impact > 6) {
    a.hp -= impact * 0.25;
    b.hp -= impact * 0.25;
    if (a.hp < a.spec.hp * 0.5) a.smoke = 1;
    if (b.hp < b.spec.hp * 0.5) b.smoke = 1;
  }
  return true;
}

/** Keep a car out of buildings and inside the world; returns true when it hit a wall. */
export function collideWorld(city, car) {
  const before = { x: car.x, z: car.z };
  const hit = city.resolveCircle(car, car.spec.length * 0.42);
  if (hit) {
    // A wall hit kills the speed into the wall, not the speed along it.
    const moved = Math.hypot(car.x - before.x, car.z - before.z);
    if (moved < 0.25) {
      car.vx *= 0.4;
      car.vz *= 0.4;
    }
    // Scraping a wall wears the car slowly; the hard-hit damage to the driver is
    // charged by the caller, not here.
    car.hp -= 0.1;
    if (car.hp < car.spec.hp * 0.5) car.smoke = 1;
  }
  if (car.x < 5 || car.x > WORLD.width - 5 || car.z < 5 || car.z > WORLD.height - 5) {
    car.vx *= 0.5;
    car.vz *= 0.5;
  }
  return hit;
}

/** The nearest car to (x, z) within `radius`, or null. */
export function nearestCar(cars, x, z, radius) {
  let best = null;
  let bestD = radius * radius;
  for (const car of cars) {
    const d = (car.x - x) ** 2 + (car.z - z) ** 2;
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

/** A car the player can steal: parked, or traffic with no police around. */
export function stealableCar(cars, x, z) {
  return nearestCar(cars, x, z, 16);
}
