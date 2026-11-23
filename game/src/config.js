// Solmar Bay 3D — every tuning number and colour in one place.
// The world is 1200 x 900 units (1 unit is about a metre): the same city layout as the
// 2D design, rescaled for a third-person camera. Nothing below depends on screen size.

export const WORLD = { width: 1200, height: 900 };
export const STEP = 1 / 60;

export const PLAYER = {
  onFootSpeed: 6,
  radius: 0.55,
  height: 1.8,
  health: 100,
  punchDamage: 14,
  punchRange: 1.6,
  punchCooldown: 0.35,
  bustDistance: 2.2,
  bustMaxSpeed: 3,
};

export const PISTOL = {
  damage: 34,
  range: 130,
  ammoStart: 12,
  magSize: 12,
  fireCooldown: 0.22,
  reloadTime: 1.1,
  ammoPrice: 40,
  bulletSpeed: 220,
};

export const WANTED = {
  /** Heat at which each star count begins (index = stars). */
  thresholds: [0, 10, 30, 50, 70, 90],
  /** Heat lost per second while no police can see the player. */
  decayUnseen: 2.4,
  /** Heat lost per second while unseen AND far from any cruiser (hiding). */
  decayHidden: 5.5,
  /** Cruisers on the road at each star count. */
  cruisers: [0, 2, 3, 4, 5, 6],
  /** Heat added by each crime. */
  crime: { steal: 12, speedPast: 4, assault: 10, kill: 18, crashCop: 8, gunshotSeen: 6 },
  /** How far a cruiser or cop can see the player (units). */
  sight: 150,
  /** Heat gained per second while standing in the helicopter spotlight. */
  heliHeat: 6,
};

export const CAR_TYPES = {
  sedan: { accel: 26, topSpeed: 42, reverseTop: 14, grip: 6.5, turn: 2.6, length: 4.6, width: 2.0, hp: 100, colors: [0xc0392b, 0x2e86c1, 0x7d8c99, 0x27ae60, 0xe67e22] },
  taxi: { accel: 24, topSpeed: 40, reverseTop: 13, grip: 6.5, turn: 2.6, length: 4.6, width: 2.0, hp: 100, colors: [0xf1c40f] },
  coupe: { accel: 36, topSpeed: 55, reverseTop: 16, grip: 7.6, turn: 3.0, length: 4.8, width: 2.0, hp: 90, colors: [0x8e44ad, 0xe74c3c] },
  truck: { accel: 19, topSpeed: 32, reverseTop: 11, grip: 5.4, turn: 1.9, length: 6.4, width: 2.4, hp: 160, colors: [0x5d6d7e, 0xa04000] },
  van: { accel: 21, topSpeed: 35, reverseTop: 12, grip: 6.0, turn: 2.1, length: 5.4, width: 2.2, hp: 130, colors: [0xf5f5f5, 0x1abc9c] },
  cruiser: { accel: 32, topSpeed: 50, reverseTop: 16, grip: 7.2, turn: 2.9, length: 4.8, width: 2.0, hp: 140, colors: [0x1a1a2e] },
};

/** Money: fares, rewards, shop prices. */
export const MONEY = {
  taxiBase: 25,
  taxiPerMetre: 0.03,
  tipFast: 15,
  sprayPrice: 100,
  packageReward: 50,
  jumpReward: 25,
  missionReward: [0, 150, 250, 200, 400, 800],
};

export const MISSIONS = [
  { name: 'First Fare', blurb: 'Mama Rosa needs a driver. Pick up the client at the marina, drop him downtown.' },
  { name: 'Borrowed Wheels', blurb: 'The Comet GT is parked at the marina lot. Take it. Quietly, if you can.' },
  { name: 'Heat', blurb: 'You are hot. Lose the two stars — spray shop, or stay out of sight.' },
  { name: 'The Courier', blurb: 'Three drops, one clock. Fast driving pays. Cops do not care about your schedule.' },
  { name: 'The Anchor Job', blurb: 'Lift the case from the port and get it to the safehouse. Four stars and a chopper.' },
];

/** Seconds of play per respect level; cosmetic only, shown on the title screen. */
export const RESPECT_LEVELS = [0, 200, 500, 1000, 2000, 4000];

/** Distances for mission arrival, pickups and shops (units). */
export const RADII = {
  missionArrive: 20,
  package: 3,
  taxiPickup: 4,
  taxiDropoff: 6,
  shop: 8,
  enterCar: 4,
  ramp: 5,
};

/** Chase camera: distance behind the subject and height above it. */
export const CAMERA = {
  carDistance: 11.5,
  carHeight: 5.2,
  footDistance: 8.5,
  footHeight: 4.2,
  lookAhead: 6,
  fov: 62,
};

export const PALETTE = {
  sky: 0x87bfe8,
  horizon: 0xf6d9a0,
  fog: 0xd8e4ea,
  grass: 0x7fae5a,
  sand: 0xe8d5a3,
  sea: 0x2fa8a0,
  seaDeep: 0x1f7f8c,
  asphalt: 0x3d3a38,
  sidewalk: 0xb8b0a0,
  buildingRoof: 0x8a7f8d,
  park: 0x5d8f4e,
  lot: 0x6e6a66,
  container: 0xb03a2e,
  player: 0xf39c12,
  playerShirt: 0xf39c12,
  ped: 0xe8e0d0,
  police: 0x1a1a2e,
  policeLight: 0xe74c3c,
  policeLight2: 0x3498db,
  heli: 0x2c3e50,
  marker: 0xf1c40f,
  health: 0x2ecc71,
  healthLow: 0xe74c3c,
  cash: 0x2ecc71,
  star: 0xf1c40f,
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the save is kept between visits (this browser only). */
export const SAVE_KEY = 'solmar-bay.save';
export const BEST_KEY = 'solmar-bay.best';
