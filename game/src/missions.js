// Missions and side work: the five-story chain for Mama Rosa, taxi fares, twelve hidden
// packages and stunt jumps. Missions are data: steps with a type, a target and a reward.
// The state machine advances steps, fails on a timer, and pays out on completion.

import { MISSIONS, MONEY, RADII } from './config.js';
import { int, pick, range } from './rng.js';

export function createMissions(city) {
  return {
    index: 0, // which story mission is active (0..4); 5 means the story is done
    step: 0,
    state: 'idle', // idle | active | done
    timer: 0,
    deliveriesLeft: 0,
    target: null,
    message: '',
    messageTimer: 0,
    packages: [],
    packagesFound: 0,
    faresDone: 0,
    jumpsDone: 0,
    taxi: null, // { pickup, dropoff, fare, passenger } or null
    dialogue: '',
    dialogueTimer: 0,
  };
}

/** Place the twelve hidden packages around the city (rooftops, alleys, beach, port). */
export function placePackages(random, city, missions) {
  missions.packages = [];
  for (let i = 0; i < 12; i += 1) {
    const node = city.nodes[Math.floor(random() * city.nodes.length)];
    missions.packages.push({
      x: node.x + range(random, -30, 30),
      z: node.z + range(random, -30, 30),
      taken: false,
    });
  }
  // Two of them are always on the beach and in the port, where the eye does not go.
  missions.packages[0] = { x: 45, z: 225, taken: false };
  missions.packages[1] = { x: 625, z: 880, taken: false };
}

function say(missions, text, seconds) {
  missions.dialogue = text;
  missions.dialogueTimer = seconds ?? 4;
}

/**
 * Set the mission marker. By default the point is snapped to the nearest road
 * intersection: a target inside a block (a lot, a parcel, an offset from a spot)
 * can sit behind buildings a car can never reach, and the mission would never
 * complete. A road intersection is always drivable, so the marker always points
 * somewhere the player can actually arrive at. Pass snap=false when the target
 * is a visible thing the player must find (the Comet GT in its lot): snapping
 * would move the marker 40m from the car it points at.
 */
function setTarget(missions, city, x, z, label, snap = true) {
  if (!snap) {
    missions.target = { x, z, label };
    return;
  }
  const node = city.nodes[city.nearestNode(x, z)];
  missions.target = { x: node.x, z: node.z, label };
}

/** Start story mission `index` (0-based). */
export function startMission(missions, city, index) {
  missions.index = index;
  missions.step = 0;
  missions.state = 'active';
  missions.timer = 0;
  const spots = city.spots;
  if (index === 0) {
    setTarget(missions, city, spots.marina.x, spots.marina.z, 'Pick up the client');
    say(missions, 'Mama Rosa: "Jax, my boy. A client waits at the marina. Drive him downtown."', 5);
  } else if (index === 1) {
    // The Comet itself is the target: do not snap the marker to an intersection,
    // or it points 40m from the car it is meant to mark.
    setTarget(missions, city, spots.comet.x, spots.comet.z, 'Steal the Comet GT', false);
    say(missions, 'Mama Rosa: "The Comet GT sits in the marina lot. Borrow it. Permanently."', 5);
  } else if (index === 2) {
    missions.timer = 0;
    setTarget(missions, city, spots.spray.x, spots.spray.z, 'Lose the heat');
    say(missions, 'Mama Rosa: "Two stars, Jax. Get to the spray shop or stay out of sight."', 5);
  } else if (index === 3) {
    missions.deliveriesLeft = 3;
    missions.timer = 150;
    setTarget(missions, city, spots.safehouse.x, spots.safehouse.z, 'Deliver the package');
    say(missions, 'Mama Rosa: "Three drops, two and a half minutes. Do not keep the clients waiting."', 5);
  } else if (index === 4) {
    setTarget(missions, city, spots.portCase.x, spots.portCase.z, 'Lift the case at the port');
    say(missions, 'Mama Rosa: "The Anchor\'s case is at the port. Take it, then run. Do not stop."', 5);
  }
}

function completeMission(missions, player) {
  const reward = MONEY.missionReward[missions.index + 1] ?? 0;
  player.cash += reward;
  player.respect += 100 + missions.index * 50;
  missions.state = 'done';
  missions.target = null;
  say(missions, `Mission complete. +$${reward}.`, 4);
  return reward;
}

function failMission(missions, reason) {
  missions.state = 'idle';
  missions.target = null;
  say(missions, `Mission failed: ${reason}. Talk to Mama Rosa to try again.`, 5);
}

/** Offer a taxi fare: a flagged pedestrian waits at a sidewalk. */
export function offerTaxiFare(random, city, missions, player) {
  if (missions.taxi) return;
  const node = city.nodes[Math.floor(random() * city.nodes.length)];
  const drop = city.nodes[Math.floor(random() * city.nodes.length)];
  if (Math.hypot(node.x - player.x, node.z - player.z) < 125) return;
  const fare = MONEY.taxiBase + Math.round(Math.hypot(drop.x - node.x, drop.z - node.z) * MONEY.taxiPerMetre);
  missions.taxi = {
    pickup: { x: node.x + range(random, -10, 10), z: node.z + range(random, -10, 10) },
    dropoff: { x: drop.x, z: drop.z },
    fare,
    state: 'waiting',
    timer: 60,
  };
  say(missions, 'A fare is waving you down — get to the flag.', 3);
}

/**
 * One step of missions and side work. `world` carries player, cars, peds, police and city.
 * Returns an event string ('mission-complete' | 'mission-failed' | 'package' | 'fare' | 'jump')
 * or null.
 */
export function stepMissions(random, city, missions, dt, world) {
  const player = world.player;
  if (missions.dialogueTimer > 0) missions.dialogueTimer -= dt;
  if (missions.messageTimer > 0) missions.messageTimer -= dt;

  // Packages: walk or drive over one to collect it.
  for (const pack of missions.packages) {
    if (pack.taken) continue;
    if (Math.hypot(pack.x - player.x, pack.z - player.z) < RADII.package) {
      pack.taken = true;
      missions.packagesFound += 1;
      player.cash += MONEY.packageReward;
      player.respect += 25;
      say(missions, `Hidden package ${missions.packagesFound}/12. +$${MONEY.packageReward}.`, 3);
      return 'package';
    }
  }

  // Taxi fares.
  if (missions.taxi) {
    const taxi = missions.taxi;
    taxi.timer -= dt;
    if (taxi.timer <= 0) {
      missions.taxi = null;
      say(missions, 'The fare got tired of waiting.', 3);
    } else if (taxi.state === 'waiting') {
      if (Math.hypot(taxi.pickup.x - player.x, taxi.pickup.z - player.z) < RADII.taxiPickup && !player.onFoot) {
        taxi.state = 'riding';
        say(missions, 'Passenger: "Downtown, and step on it."', 3);
      }
    } else if (taxi.state === 'riding') {
      if (Math.hypot(taxi.dropoff.x - player.x, taxi.dropoff.z - player.z) < RADII.taxiDropoff && !player.onFoot) {
        const tip = world.player.car && world.player.car.speed > 30 ? MONEY.tipFast : 0;
        player.cash += taxi.fare + tip;
        player.respect += 10;
        missions.faresDone += 1;
        missions.taxi = null;
        say(missions, `Fare paid: $${taxi.fare}${tip ? ` + $${tip} tip` : ''}.`, 3);
        return 'fare';
      }
    }
  }

  // Stunt jumps: hit a ramp fast while driving.
  for (const ramp of city.ramps) {
    if (ramp.cooldown > 0) { ramp.cooldown -= dt; continue; }
    if (!player.onFoot && player.car && player.car.speed > 36) {
      if (Math.hypot(ramp.x - player.x, ramp.z - player.z) < RADII.ramp) {
        ramp.cooldown = 8;
        missions.jumpsDone += 1;
        player.cash += MONEY.jumpReward;
        player.respect += 15;
        world.airTime = 0.9;
        say(missions, `Stunt jump! +$${MONEY.jumpReward}.`, 3);
        return 'jump';
      }
    }
  }

  // Story missions.
  if (missions.state !== 'active') return null;
  const target = missions.target;
  const atTarget = target && Math.hypot(target.x - player.x, target.z - player.z) < RADII.missionArrive;

  if (missions.index === 0) {
    if (missions.step === 0 && atTarget) {
      if (player.onFoot) {
        // The client needs a car: say so and wait. Without this the mission
        // looks finished at 0m while nothing happens — a new player walks here
        // first and would be stuck with no idea why. The line repeats only
        // after it expires, so it never locks the dialogue.
        if (missions.dialogueTimer <= 0) {
          say(missions, 'Client: "You came on foot? Get a car and come back for me."', 4);
        }
      } else {
        missions.step = 1;
        setTarget(missions, city, city.spots.safehouse.x - 200, city.spots.safehouse.z - 100, 'Drop the client downtown');
        say(missions, 'Client: "Downtown, by the towers. And careful with the paint."', 4);
      }
    } else if (missions.step === 1 && atTarget && !player.onFoot) {
      completeMission(missions, player);
      return 'mission-complete';
    }
  } else if (missions.index === 1) {
    if (missions.step === 0 && player.car && player.car.type === 'coupe') {
      missions.step = 1;
      setTarget(missions, city, city.spots.safehouse.x, city.spots.safehouse.z, 'Bring it to the safehouse');
      say(missions, 'Mama Rosa: "Beautiful. Now bring her home."', 4);
    } else if (missions.step === 1 && atTarget && !player.onFoot) {
      completeMission(missions, player);
      return 'mission-complete';
    }
  } else if (missions.index === 2) {
    if (world.police.stars === 0) {
      completeMission(missions, player);
      return 'mission-complete';
    }
  } else if (missions.index === 3) {
    missions.timer -= dt;
    if (missions.timer <= 0) {
      failMission(missions, 'the clock ran out');
      return 'mission-failed';
    }
    if (atTarget && !player.onFoot) {
      missions.deliveriesLeft -= 1;
      if (missions.deliveriesLeft <= 0) {
        completeMission(missions, player);
        return 'mission-complete';
      }
      missions.timer += 40;
      const node = city.nodes[Math.floor(random() * city.nodes.length)];
      setTarget(missions, city, node.x, node.z, `Deliver the package (${missions.deliveriesLeft} left)`);
      say(missions, `Drop ${3 - missions.deliveriesLeft} done. Next one — move.`, 3);
    }
  } else if (missions.index === 4) {
    if (missions.step === 0 && atTarget && player.onFoot) {
      missions.step = 1;
      setTarget(missions, city, city.spots.safehouse.x, city.spots.safehouse.z, 'Getaway to the safehouse');
      say(missions, 'Mama Rosa: "You have it. Four stars coming. GO."', 4);
      world.police.heat = 72;
    } else if (missions.step === 1 && atTarget && !player.onFoot) {
      completeMission(missions, player);
      return 'mission-complete';
    }
  }
  return null;
}

/** The next story mission's name, or null when the story is done. */
export function nextMissionName(missions) {
  if (missions.index >= MISSIONS.length) return null;
  return MISSIONS[missions.index].name;
}
