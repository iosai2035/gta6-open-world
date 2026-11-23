// Solmar Bay's city, built once from the seed: a grid of avenues and streets, BSP-subdivided
// blocks (glass towers downtown, pastel houses in the suburbs), a beach on the west edge, a
// port on the south edge, parks, parking lots and palm-lined boulevards. It also owns the
// road graph the AI drives on, and the circle-vs-building collision the cars and people
// share. Coordinates are x (east) and z (south); y is up.

import { WORLD } from './config.js';
import { chance, int, pick, range } from './rng.js';

const ROAD_W = 16;
const AVENUES = [105, 222, 340, 457, 575, 692, 810, 927, 1045, 1162];
const STREETS = [95, 202, 310, 417, 525, 632, 740, 847];
const BEACH_X = 65;
const SEA_X = 27;
const PORT_Y = 855;
const CENTRE = { x: 600, z: 450 };

const ROOFS = [0xc9a0a0, 0xa0b8c9, 0xc9b18a, 0x9fb89a, 0xb5a6c9, 0xd0c0a0, 0xb0a090];
const GLASS = [0x5a7a9a, 0x7a9ab0, 0x6a8a9a, 0x4a6a8a];
const TREE_COLORS = [0x3f7d44, 0x4c8a3f, 0x35703a];

function distance(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

/** Downtown intensity 1 at the core, 0 in the far suburbs. */
function intensity(x, z) {
  const d = distance(x, z, CENTRE.x, CENTRE.z);
  return Math.max(0, 1 - d / 480);
}

/** Split a block rectangle into parcels by recursive cuts (BSP-style). */
function subdivide(random, rect, depth, out) {
  const wide = rect.w > 62;
  const tall = rect.h > 52;
  if (depth >= 2 || (!wide && !tall)) {
    out.push(rect);
    return;
  }
  if (wide && (!tall || chance(random, 0.6))) {
    const cut = range(random, 0.35, 0.65) * rect.w;
    subdivide(random, { x: rect.x, z: rect.z, w: cut, h: rect.h }, depth + 1, out);
    subdivide(random, { x: rect.x + cut, z: rect.z, w: rect.w - cut, h: rect.h }, depth + 1, out);
  } else {
    const cut = range(random, 0.35, 0.65) * rect.h;
    subdivide(random, { x: rect.x, z: rect.z, w: rect.w, h: cut }, depth + 1, out);
    subdivide(random, { x: rect.x, z: rect.z + cut, w: rect.w, h: rect.h - cut }, depth + 1, out);
  }
}

export function buildCity(random) {
  const buildings = [];
  const parks = [];
  const lots = [];
  const palms = [];
  const lamps = [];
  const containers = [];
  const nodes = [];
  const nodeIndex = new Map();
  const adjacency = [];

  // Intersections are the graph nodes; edges run along each road between neighbours.
  for (let j = 0; j < STREETS.length; j += 1) {
    for (let i = 0; i < AVENUES.length; i += 1) {
      const id = nodes.length;
      nodes.push({ id, x: AVENUES[i], z: STREETS[j] });
      nodeIndex.set(`${i},${j}`, id);
      adjacency.push([]);
    }
  }
  function link(a, b) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  for (let j = 0; j < STREETS.length; j += 1) {
    for (let i = 0; i < AVENUES.length; i += 1) {
      if (i + 1 < AVENUES.length) link(nodeIndex.get(`${i},${j}`), nodeIndex.get(`${i + 1},${j}`));
      if (j + 1 < STREETS.length) link(nodeIndex.get(`${i},${j}`), nodeIndex.get(`${i},${j + 1}`));
    }
  }

  // Blocks between the roads, subdivided into parcels.
  for (let j = 0; j < STREETS.length - 1; j += 1) {
    for (let i = 0; i < AVENUES.length - 1; i += 1) {
      const block = {
        x: AVENUES[i] + ROAD_W / 2 + 1.5,
        z: STREETS[j] + ROAD_W / 2 + 1.5,
        w: AVENUES[i + 1] - AVENUES[i] - ROAD_W - 3,
        h: STREETS[j + 1] - STREETS[j] - ROAD_W - 3,
      };
      const parcels = [];
      subdivide(random, block, 0, parcels);
      for (const parcel of parcels) {
        const cx = parcel.x + parcel.w / 2;
        const cz = parcel.z + parcel.h / 2;
        const roll = random();
        if (roll < 0.16) {
          const trees = [];
          const count = int(random, 3, 7);
          for (let t = 0; t < count; t += 1) {
            trees.push({ x: range(random, parcel.x + 3, parcel.x + parcel.w - 3), z: range(random, parcel.z + 3, parcel.z + parcel.h - 3), r: range(random, 1.6, 2.8), color: pick(random, TREE_COLORS) });
          }
          parks.push({ x: parcel.x, z: parcel.z, w: parcel.w, h: parcel.h, trees });
        } else if (roll < 0.30) {
          lots.push({ x: parcel.x, z: parcel.z, w: parcel.w, h: parcel.h, slots: Math.max(2, Math.floor(parcel.w / 8)) });
        } else {
          const inten = intensity(cx, cz);
          const tall = inten > 0.55 && chance(random, 0.8);
          const height = tall
            ? range(random, 14, 14 + inten * 18)
            : range(random, 2.5, 3.5 + (1 - inten) * 3.5);
          const color = tall ? pick(random, GLASS) : pick(random, ROOFS);
          buildings.push({
            x: parcel.x + 1.5, z: parcel.z + 1.5,
            w: parcel.w - 3, h: parcel.h - 3,
            height, color, tall,
          });
        }
      }
    }
  }

  // Palm trees along the beach boulevard and the marina road.
  for (let z = 110; z < 840; z += 34) {
    palms.push({ x: 82, z: z + range(random, -4, 4), s: range(random, 0.9, 1.3) });
    if (chance(random, 0.6)) palms.push({ x: 128, z: z + 17, s: range(random, 0.9, 1.2) });
  }
  // Street lamps at every other intersection.
  for (let j = 0; j < STREETS.length; j += 1) {
    for (let i = 0; i < AVENUES.length; i += 1) {
      if ((i + j) % 2 === 0) lamps.push({ x: AVENUES[i] + ROAD_W / 2 + 1, z: STREETS[j] + ROAD_W / 2 + 1 });
    }
  }
  // Shipping containers stacked in the port.
  for (let i = 0; i < 26; i += 1) {
    containers.push({
      x: range(random, 700, 1120), z: range(random, 862, 890),
      w: range(random, 6, 12), h: range(random, 2.4, 3.2), d: 2.6,
      color: pick(random, [0xb03a2e, 0x2e86c1, 0x27ae60, 0xe67e22, 0x8e44ad]),
      angle: chance(random, 0.5) ? 0 : Math.PI / 2,
    });
  }

  // Fixed points of interest, picked from real lots and intersections so they sit on the map.
  // A lot only counts if a car can drive into it from the road: its centre must be close
  // enough to an avenue or a street that the lot touches the road.
  function roadDist(lot) {
    const cx = lot.x + lot.w / 2;
    const cz = lot.z + lot.h / 2;
    let best = Infinity;
    for (const ax of AVENUES) best = Math.min(best, Math.abs(cx - ax));
    for (const sy of STREETS) best = Math.min(best, Math.abs(cz - sy));
    return best;
  }
  const roadLots = lots.filter((lot) => roadDist(lot) <= 28);
  const pickLots = roadLots.length > 0 ? roadLots : lots;
  const marinaLot = pickLots.find((lot) => lot.x < 230 && lot.z < 230) ?? pickLots[0];
  const downtownLot = pickLots.reduce((best, lot) => {
    const d = distance(lot.x, lot.z, CENTRE.x, CENTRE.z);
    return d < best.d ? { lot, d } : best;
  }, { lot: pickLots[0], d: Infinity }).lot;
  const suburbLot = pickLots.reduce((best, lot) => {
    const d = distance(lot.x, lot.z, CENTRE.x, CENTRE.z);
    return d > best.d ? { lot, d } : best;
  }, { lot: pickLots[0], d: -1 }).lot;

  const spots = {
    player: { x: AVENUES[1], z: STREETS[1] + 22 },
    marina: { x: marinaLot.x + marinaLot.w / 2, z: marinaLot.z + marinaLot.h / 2 },
    comet: { x: marinaLot.x + marinaLot.w / 2, z: marinaLot.z + marinaLot.h / 2 },
    spray: { x: downtownLot.x + downtownLot.w / 2, z: downtownLot.z + downtownLot.h / 2 },
    ammo: { x: suburbLot.x + suburbLot.w / 2, z: suburbLot.z + suburbLot.h / 2 },
    safehouse: { x: AVENUES[8], z: STREETS[6] + 22 },
    portCase: { x: 600, z: 875 },
    beachRoad: { x: 105, z: 525 },
  };

  const ramps = [
    { x: 575, z: 310, angle: 0 },
    { x: 340, z: 632, angle: Math.PI / 2 },
    { x: 927, z: 202, angle: 0 },
  ];

  const city = {
    buildings, parks, lots, palms, lamps, containers,
    nodes, adjacency, spots, ramps,
    avenues: AVENUES, streets: STREETS, roadW: ROAD_W,
    beachX: BEACH_X, seaX: SEA_X, portY: PORT_Y,
  };

  /** The road rectangle containing (x, z), or null. */
  city.roadAt = function roadAt(x, z) {
    for (const ax of AVENUES) {
      if (Math.abs(x - ax) <= ROAD_W / 2 && z >= STREETS[0] - ROAD_W / 2 && z <= STREETS[STREETS.length - 1] + ROAD_W / 2) {
        return { vertical: true, at: ax };
      }
    }
    for (const sy of STREETS) {
      if (Math.abs(z - sy) <= ROAD_W / 2 && x >= AVENUES[0] - ROAD_W / 2 && x <= AVENUES[AVENUES.length - 1] + ROAD_W / 2) {
        return { vertical: false, at: sy };
      }
    }
    return null;
  };

  city.isRoad = function isRoad(x, z) {
    return city.roadAt(x, z) !== null;
  };

  /** The building containing (x, z), or null. */
  city.buildingAt = function buildingAt(x, z) {
    for (const b of buildings) {
      if (x >= b.x && x <= b.x + b.w && z >= b.z && z <= b.z + b.h) return b;
    }
    return null;
  };

  /** Push a circle out of buildings and the world edge. Returns true when it hit something. */
  city.resolveCircle = function resolveCircle(pos, r) {
    let hit = false;
    if (pos.x < r) { pos.x = r; hit = true; }
    if (pos.x > WORLD.width - r) { pos.x = WORLD.width - r; hit = true; }
    if (pos.z < r) { pos.z = r; hit = true; }
    if (pos.z > WORLD.height - r) { pos.z = WORLD.height - r; hit = true; }
    for (const b of buildings) {
      const cx = Math.max(b.x, Math.min(pos.x, b.x + b.w));
      const cz = Math.max(b.z, Math.min(pos.z, b.z + b.h));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * r;
          pos.z = cz + (dz / d) * r;
        } else {
          // Dead centre: push out along the smallest overlap.
          const left = pos.x - b.x + r;
          const right = b.x + b.w - pos.x + r;
          const top = pos.z - b.z + r;
          const bottom = b.z + b.h - pos.z + r;
          const m = Math.min(left, right, top, bottom);
          if (m === left) pos.x = b.x - r;
          else if (m === right) pos.x = b.x + b.w + r;
          else if (m === top) pos.z = b.z - r;
          else pos.z = b.z + b.h + r;
        }
      }
    }
    return hit;
  };

  city.nearestNode = function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (const node of nodes) {
      const d = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (d < bestD) { bestD = d; best = node.id; }
    }
    return best;
  };

  /** Breadth-first route between two nodes (list of node ids, start included). */
  city.route = function route(from, to) {
    if (from === to) {
      // A route must have somewhere to go: step to the first neighbour, deterministically.
      const next = adjacency[from][0];
      return next === undefined ? [from, from] : [from, next];
    }
    const prev = new Map([[from, -1]]);
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of adjacency[current]) {
        if (prev.has(next)) continue;
        prev.set(next, current);
        if (next === to) {
          const path = [to];
          let step = to;
          while (prev.get(step) !== -1) {
            step = prev.get(step);
            path.unshift(step);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [from];
  };

  /** A random point on a random road, with a right-hand lane offset. */
  city.randomRoadPoint = function randomRoadPoint(random) {
    const vertical = chance(random, 0.5);
    if (vertical) {
      const ax = pick(random, AVENUES);
      const z = range(random, STREETS[0], STREETS[STREETS.length - 1]);
      return { x: ax + 4, z, angle: chance(random, 0.5) ? Math.PI / 2 : -Math.PI / 2 };
    }
    const sy = pick(random, STREETS);
    const x = range(random, AVENUES[0], AVENUES[AVENUES.length - 1]);
    return { x, z: sy + 4, angle: chance(random, 0.5) ? 0 : Math.PI };
  };

  return city;
}
