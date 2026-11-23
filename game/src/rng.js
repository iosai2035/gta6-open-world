// Seeded random numbers (mulberry32) and small helpers, so one seed always builds
// the same city, the same traffic and the same missions.

export function createRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A float in [min, max). */
export function range(random, min, max) {
  return min + random() * (max - min);
}

/** An integer in [min, max]. */
export function int(random, min, max) {
  return Math.floor(range(random, min, max + 1));
}

/** One element of an array. */
export function pick(random, array) {
  return array[Math.floor(random() * array.length)];
}

/** True with probability p. */
export function chance(random, p) {
  return random() < p;
}

/** Clamp a value into [min, max]. */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Shortest signed angle from `from` to `to`, in (-PI, PI]. */
export function angleDiff(from, to) {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff <= -Math.PI) diff += Math.PI * 2;
  return diff;
}
