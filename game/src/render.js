// Drawing only: the world's state and the current screen in, pixels out. A Three.js scene
// — sun-soaked low-poly city, chase camera, particles, helicopter, HUD and minimap —
// painted from the simulation's x/z state. No images, no network: every texture is drawn
// on a canvas at startup. A mesh built facing local +x needs rotation.y = -angle.

import { CAMERA, PALETTE, RADII, WORLD } from './config.js';
import { nearestCar } from './vehicles.js';

const THREE = window.THREE;

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_MISSION = 'mission';

/** A seeded-looking deterministic pick, for texture details (not the game's seed). */
function hashNoise(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function cssColor(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** A facade texture: a flat base with a grid of windows. */
function facadeTexture(base, windowColor, cols, rows, lit) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  const cw = 128 / cols;
  const ch = 128 / rows;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const n = hashNoise(c * 7 + 1, r * 13 + 2);
      if (n < 0.18) continue; // some windows are blank wall
      ctx.fillStyle = n < 0.18 + lit ? '#ffd98a' : windowColor;
      ctx.fillRect(c * cw + cw * 0.22, r * ch + ch * 0.25, cw * 0.56, ch * 0.5);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** The ground texture: grass, beach, roads with dashes, sidewalks, parks, lots, port. */
function groundTexture(city) {
  const scale = 1.7;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(WORLD.width * scale);
  canvas.height = Math.ceil(WORLD.height * scale);
  const ctx = canvas.getContext('2d');
  const X = (x) => x * scale;
  const Z = (z) => z * scale;
  ctx.fillStyle = '#5d9c46';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Beach sand west of the boulevard.
  ctx.fillStyle = cssColor(PALETTE.sand);
  ctx.fillRect(0, 0, X(city.beachX), canvas.height);
  // Port concrete on the south edge.
  ctx.fillStyle = '#8a8d90';
  ctx.fillRect(0, Z(city.portY), canvas.width, canvas.height - Z(city.portY));
  // Parks.
  ctx.fillStyle = cssColor(PALETTE.park);
  for (const park of city.parks) ctx.fillRect(X(park.x), Z(park.z), park.w * scale, park.h * scale);
  // Parking lots.
  ctx.fillStyle = cssColor(PALETTE.lot);
  for (const lot of city.lots) ctx.fillRect(X(lot.x), Z(lot.z), lot.w * scale, lot.h * scale);
  // Sidewalk borders along the roads.
  ctx.fillStyle = cssColor(PALETTE.sidewalk);
  for (const ax of city.avenues) ctx.fillRect(X(ax - city.roadW / 2 - 2), 0, (city.roadW + 4) * scale, canvas.height);
  for (const sy of city.streets) ctx.fillRect(0, Z(sy - city.roadW / 2 - 2), canvas.width, (city.roadW + 4) * scale);
  // Asphalt.
  ctx.fillStyle = '#33302d';
  for (const ax of city.avenues) ctx.fillRect(X(ax - city.roadW / 2), 0, city.roadW * scale, canvas.height);
  for (const sy of city.streets) ctx.fillRect(0, Z(sy - city.roadW / 2), canvas.width, city.roadW * scale);
  // Centre dashes: short and narrow, like real lane paint.
  ctx.fillStyle = '#d8c86a';
  for (const ax of city.avenues) {
    for (let z = 0; z < WORLD.height; z += 10) ctx.fillRect(X(ax) - 0.4, Z(z), 0.8, 3.5 * scale);
  }
  for (const sy of city.streets) {
    for (let x = 0; x < WORLD.width; x += 10) ctx.fillRect(X(x), Z(sy) - 0.4, 3.5 * scale, 0.8);
  }
  // Crosswalks at every intersection (small, subtle).
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  for (const node of city.nodes) {
    for (let i = -2; i <= 2; i += 1) {
      ctx.fillRect(X(node.x - 3), Z(node.z + i * 2.4 - 0.7), 6 * scale, 1.4 * scale);
      ctx.fillRect(X(node.x + i * 2.4 - 0.7), Z(node.z - 3), 1.4 * scale, 6 * scale);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

/** Build a low-poly car from boxes. Forward is local +x. */
function buildCarMesh(type, color) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1c2833 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const spec = { sedan: [4.6, 0.7, 2.0], taxi: [4.6, 0.7, 2.0], coupe: [4.8, 0.62, 2.0], truck: [6.4, 0.9, 2.4], van: [5.4, 1.1, 2.2], cruiser: [4.8, 0.7, 2.0] }[type];
  const [len, h, wid] = spec;
  const body = new THREE.Mesh(new THREE.BoxGeometry(len, h, wid), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  if (type === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, wid * 0.95), bodyMat);
    cab.position.set(len / 2 - 0.9, 1.1, 0);
    cab.castShadow = true;
    group.add(cab);
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(len - 2.2, 1.5, wid), new THREE.MeshLambertMaterial({ color: 0xd5d8dc }));
    cargo.position.set(-0.6, 1.35, 0);
    cargo.castShadow = true;
    group.add(cargo);
  } else if (type === 'van') {
    const top = new THREE.Mesh(new THREE.BoxGeometry(len * 0.8, 0.9, wid * 0.92), bodyMat);
    top.position.set(-0.2, 1.45, 0);
    top.castShadow = true;
    group.add(top);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, wid * 0.8), glassMat);
    glass.position.set(len / 2 - 0.1, 1.35, 0);
    group.add(glass);
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(len * 0.48, 0.55, wid * 0.86), glassMat);
    cabin.position.set(-len * 0.05, h + 0.28, 0);
    cabin.castShadow = true;
    group.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len * 0.44, 0.08, wid * 0.8), bodyMat);
    roof.position.set(-len * 0.05, h + 0.58, 0);
    group.add(roof);
  }
  // Wheels.
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
  wheelGeo.rotateX(Math.PI / 2);
  const wheels = [];
  for (const [wx, wz] of [[len * 0.32, wid / 2], [len * 0.32, -wid / 2], [-len * 0.32, wid / 2], [-len * 0.32, -wid / 2]]) {
    const wheel = new THREE.Mesh(wheelGeo, darkMat);
    wheel.position.set(wx, 0.36, wz);
    wheel.castShadow = true;
    group.add(wheel);
    wheels.push(wheel);
  }
  // Headlights and taillights.
  const headMat = new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xaa9955 });
  const tailMat = new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0x550000 });
  for (const wz of [wid * 0.32, -wid * 0.32]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.3), headMat);
    head.position.set(len / 2, 0.6, wz);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.3), tailMat);
    tail.position.set(-len / 2, 0.6, wz);
    group.add(tail);
  }
  if (type === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.5), new THREE.MeshLambertMaterial({ color: 0xfff176, emissive: 0x665500 }));
    sign.position.set(0, h + 0.72, 0);
    group.add(sign);
  }
  let lightBar = null;
  if (type === 'cruiser') {
    lightBar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0xaa0000 }));
    red.position.z = 0.45;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), new THREE.MeshLambertMaterial({ color: 0x2266ff, emissive: 0x0022aa }));
    blue.position.z = -0.45;
    lightBar.add(red);
    lightBar.add(blue);
    lightBar.position.set(0, h + 0.68, 0);
    group.add(lightBar);
  }
  group.userData.wheels = wheels;
  group.userData.lightBar = lightBar;
  return group;
}

/** Build a low-poly person from boxes. Forward is local +x. */
function buildPersonMesh(skin, shirt, cap) {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
  const legs = [];
  for (const z of [0.14, -0.14]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.2), pantsMat);
    leg.position.set(0, 0.4, z);
    leg.castShadow = true;
    group.add(leg);
    legs.push(leg);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.5), shirtMat);
  torso.position.set(0, 1.15, 0);
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skinMat);
  head.position.set(0, 1.68, 0);
  head.castShadow = true;
  group.add(head);
  if (cap) {
    const capMesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.38), new THREE.MeshLambertMaterial({ color: 0xf39c12 }));
    capMesh.position.set(0.04, 1.9, 0);
    group.add(capMesh);
  }
  const arms = [];
  for (const z of [0.32, -0.32]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.18), shirtMat);
    arm.position.set(0, 1.15, z);
    group.add(arm);
    arms.push(arm);
  }
  group.userData.legs = legs;
  group.userData.arms = arms;
  return group;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 140, 480);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 1200);
  camera.position.set(600, 40, 500);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe8c0, 1.15);
  sun.position.set(200, 260, 120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);

  // Shared materials and geometries.
  const glassTex = facadeTexture('#7a9ab0', '#2c4a66', 6, 10, 0.12);
  const pastelTex = facadeTexture('#e8ddc8', '#5a6a7a', 4, 4, 0.06);
  const roofMat = new THREE.MeshLambertMaterial({ color: PALETTE.buildingRoof });
  const glassMats = new Map();
  const pastelMats = new Map();
  function facadeMat(color, tall) {
    const cache = tall ? glassMats : pastelMats;
    if (!cache.has(color)) {
      cache.set(color, new THREE.MeshLambertMaterial({ color, map: tall ? glassTex : pastelTex }));
    }
    return cache.get(color);
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);

  let cityGroup = null;
  let carMeshes = new Map();
  let personMeshes = new Map();
  let playerMesh = null;
  let heliMesh = null;
  let heliSpot = null;
  let heliCircle = null;
  let markerMesh = null;
  let markerBeam = null;
  let taxiMarker = null;
  let packageMeshes = [];
  let particlePoints = null;
  let particleGeo = null;
  let tracerLines = null;
  let tracerGeo = null;
  let seaMesh = null;
  let clouds = [];
  let builtCity = null;

  const camPos = new THREE.Vector3(600, 40, 500);
  const camLook = new THREE.Vector3(600, 0, 450);
  let shake = 0;
  let shotCam = null;

  const hud = {
    cash: document.getElementById('hud-cash'),
    respect: document.getElementById('hud-respect'),
    stars: document.getElementById('hud-stars'),
    healthFill: document.getElementById('hud-health-fill'),
    healthLabel: document.getElementById('hud-health-label'),
    objective: document.getElementById('hud-objective'),
    dialogue: document.getElementById('hud-dialogue'),
    prompt: document.getElementById('hud-prompt'),
    speed: document.getElementById('hud-speed'),
    ammo: document.getElementById('hud-ammo'),
    crosshair: document.getElementById('hud-crosshair'),
    minimap: document.getElementById('hud-minimap'),
    topLeft: document.getElementById('hud-top-left'),
    bottomLeft: document.getElementById('hud-bottom-left'),
    bottomCenter: document.getElementById('hud-bottom-center'),
    bottomRight: document.getElementById('hud-bottom-right'),
    title: document.getElementById('screen-title'),
    paused: document.getElementById('screen-paused'),
    over: document.getElementById('screen-over'),
    overTitle: document.getElementById('over-title'),
    overText: document.getElementById('over-text'),
    mission: document.getElementById('screen-mission'),
    missionText: document.getElementById('mission-text'),
    titlePrompt: document.getElementById('title-prompt'),
  };
  const minimapCtx = hud.minimap.getContext('2d');

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function buildCityMeshes(city) {
    if (cityGroup) scene.remove(cityGroup);
    cityGroup = new THREE.Group();
    builtCity = city;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.width, WORLD.height),
      new THREE.MeshLambertMaterial({ map: groundTexture(city) }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(WORLD.width / 2, 0, WORLD.height / 2);
    ground.receiveShadow = true;
    cityGroup.add(ground);

    // The sea, west of the beach, with a second deeper plane below for colour depth.
    seaMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(city.seaX + 40, WORLD.height + 80),
      new THREE.MeshLambertMaterial({ color: PALETTE.sea, transparent: true, opacity: 0.92 }),
    );
    seaMesh.rotation.x = -Math.PI / 2;
    seaMesh.position.set(city.seaX / 2 - 20, 0.15, WORLD.height / 2);
    cityGroup.add(seaMesh);
    const deep = new THREE.Mesh(
      new THREE.PlaneGeometry(city.seaX + 40, WORLD.height + 80),
      new THREE.MeshLambertMaterial({ color: PALETTE.seaDeep }),
    );
    deep.rotation.x = -Math.PI / 2;
    deep.position.set(city.seaX / 2 - 20, 0.05, WORLD.height / 2);
    cityGroup.add(deep);

    // Buildings.
    for (const b of city.buildings) {
      const mat = facadeMat(b.color, b.tall);
      const mesh = new THREE.Mesh(boxGeo, [mat, mat, roofMat, roofMat, mat, mat]);
      mesh.position.set(b.x + b.w / 2, 0, b.z + b.h / 2);
      mesh.scale.set(b.w, b.height, b.h);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      cityGroup.add(mesh);
    }

    // Trees and palms as instanced meshes (two draw calls for the whole city).
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6);
    trunkGeo.translate(0, 1.1, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1.6, 0);
    crownGeo.scale(1, 0.8, 1);
    crownGeo.translate(0, 3.1, 0);
    const palmTrunkGeo = new THREE.CylinderGeometry(0.14, 0.24, 5.5, 6);
    palmTrunkGeo.translate(0, 2.75, 0);
    const palmCrownGeo = new THREE.ConeGeometry(2.2, 1.6, 7);
    palmCrownGeo.scale(1, 0.55, 1);
    palmCrownGeo.translate(0, 6.0, 0);
    const treePositions = [];
    for (const park of city.parks) for (const t of park.trees) treePositions.push({ x: t.x, z: t.z, s: t.r / 2, color: t.color });
    const dummy = new THREE.Object3D();
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
    const crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treePositions.length);
    treePositions.forEach((t, i) => {
      dummy.position.set(t.x, 0, t.z);
      dummy.scale.setScalar(t.s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      crowns.setMatrixAt(i, dummy.matrix);
      crowns.setColorAt(i, new THREE.Color(t.color));
    });
    trunks.castShadow = true;
    crowns.castShadow = true;
    cityGroup.add(trunks);
    cityGroup.add(crowns);
    const palmTrunks = new THREE.InstancedMesh(palmTrunkGeo, trunkMat, city.palms.length);
    const palmCrowns = new THREE.InstancedMesh(palmCrownGeo, new THREE.MeshLambertMaterial({ color: 0x3f7d44 }), city.palms.length);
    city.palms.forEach((p, i) => {
      dummy.position.set(p.x, 0, p.z);
      dummy.scale.setScalar(p.s);
      dummy.rotation.set(0, hashNoise(i, 3) * Math.PI, 0);
      dummy.updateMatrix();
      palmTrunks.setMatrixAt(i, dummy.matrix);
      palmCrowns.setMatrixAt(i, dummy.matrix);
    });
    palmTrunks.castShadow = true;
    palmCrowns.castShadow = true;
    cityGroup.add(palmTrunks);
    cityGroup.add(palmCrowns);

    // Street lamps.
    const lampPoleGeo = new THREE.CylinderGeometry(0.09, 0.12, 4.5, 6);
    lampPoleGeo.translate(0, 2.25, 0);
    const lampHeadGeo = new THREE.SphereGeometry(0.28, 8, 6);
    lampHeadGeo.translate(0, 4.6, 0);
    const lampPoles = new THREE.InstancedMesh(lampPoleGeo, new THREE.MeshLambertMaterial({ color: 0x2c3e50 }), city.lamps.length);
    const lampHeads = new THREE.InstancedMesh(lampHeadGeo, new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0x887733 }), city.lamps.length);
    city.lamps.forEach((l, i) => {
      dummy.position.set(l.x, 0, l.z);
      dummy.scale.setScalar(1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      lampPoles.setMatrixAt(i, dummy.matrix);
      lampHeads.setMatrixAt(i, dummy.matrix);
    });
    cityGroup.add(lampPoles);
    cityGroup.add(lampHeads);

    // Shipping containers and two cranes in the port.
    const containerGeo = new THREE.BoxGeometry(1, 1, 1);
    containerGeo.translate(0, 0.5, 0);
    for (const c of city.containers) {
      const mesh = new THREE.Mesh(containerGeo, new THREE.MeshLambertMaterial({ color: c.color }));
      mesh.position.set(c.x, 0, c.z);
      mesh.scale.set(c.w, c.h, c.d);
      mesh.rotation.y = c.angle;
      mesh.castShadow = true;
      cityGroup.add(mesh);
    }
    const craneMat = new THREE.MeshLambertMaterial({ color: 0xe67e22 });
    for (const cx of [820, 1020]) {
      const crane = new THREE.Group();
      for (const lx of [-4, 4]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 18, 1), craneMat);
        leg.position.set(lx, 9, 0);
        leg.castShadow = true;
        crane.add(leg);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(26, 1.4, 1.4), craneMat);
      beam.position.set(4, 18, 0);
      beam.castShadow = true;
      crane.add(beam);
      const cable = new THREE.Mesh(new THREE.BoxGeometry(0.15, 8, 0.15), new THREE.MeshLambertMaterial({ color: 0x222222 }));
      cable.position.set(12, 13, 0);
      crane.add(cable);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 2), new THREE.MeshLambertMaterial({ color: 0xb03a2e }));
      hook.position.set(12, 8.5, 0);
      crane.add(hook);
      crane.position.set(cx, 0, 872);
      cityGroup.add(crane);
    }

    // Beach umbrellas.
    const umbrellaMat = new THREE.MeshLambertMaterial({ color: 0xe74c3c });
    for (let i = 0; i < 6; i += 1) {
      const ux = 42 + i * 3;
      const uz = 180 + i * 110;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), trunkMat);
      pole.position.set(ux, 1.2, uz);
      cityGroup.add(pole);
      const top = new THREE.Mesh(new THREE.ConeGeometry(2.2, 0.9, 8), umbrellaMat);
      top.position.set(ux, 2.7, uz);
      top.castShadow = true;
      cityGroup.add(top);
    }

    // Stunt ramps.
    for (const ramp of city.ramps) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 4), new THREE.MeshLambertMaterial({ color: 0xe67e22 }));
      mesh.position.set(ramp.x, 0.8, ramp.z);
      mesh.rotation.y = -ramp.angle;
      mesh.rotation.z = 0.28;
      mesh.castShadow = true;
      cityGroup.add(mesh);
    }

    // Shop signs: orange for the respray shop, green for ammo.
    function shopSign(x, z, color) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 6), new THREE.MeshLambertMaterial({ color: 0x2c3e50 }));
      pole.position.set(x, 3, z);
      cityGroup.add(pole);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 0.3), new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.45 }));
      sign.position.set(x, 6.4, z);
      cityGroup.add(sign);
    }
    shopSign(city.spots.spray.x, city.spots.spray.z, 0xe67e22);
    shopSign(city.spots.ammo.x, city.spots.ammo.z, 0x2ecc71);

    // Clouds: flat white puffs drifting over the city.
    clouds = [];
    for (let i = 0; i < 10; i += 1) {
      const cloud = new THREE.Group();
      const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
      for (let j = 0; j < 3; j += 1) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + hashNoise(i, j) * 6, 8, 6), cm);
        puff.position.set(j * 7 - 7, hashNoise(j, i) * 2, hashNoise(i + j, 1) * 4 - 2);
        puff.scale.y = 0.45;
        cloud.add(puff);
      }
      cloud.position.set(100 + hashNoise(i, 9) * 1000, 90 + hashNoise(i, 5) * 30, 60 + hashNoise(i, 7) * 780);
      cityGroup.add(cloud);
      clouds.push(cloud);
    }

    // Mission marker: a pulsing octahedron on a beam of light.
    markerMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.6),
      new THREE.MeshLambertMaterial({ color: PALETTE.marker, emissive: 0xaa8800 }),
    );
    cityGroup.add(markerMesh);
    markerBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.0, 1.0, 34, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: PALETTE.marker, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    );
    cityGroup.add(markerBeam);
    taxiMarker = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.1),
      new THREE.MeshLambertMaterial({ color: 0xfff176, emissive: 0x886600 }),
    );
    cityGroup.add(taxiMarker);

    // Hidden packages: small golden boxes.
    packageMeshes = [];
    for (let i = 0; i < 12; i += 1) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.9, 0.9),
        new THREE.MeshLambertMaterial({ color: 0xffd700, emissive: 0x886600 }),
      );
      mesh.castShadow = true;
      cityGroup.add(mesh);
      packageMeshes.push(mesh);
    }

    // Particles (one Points cloud) and tracers (one LineSegments).
    particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(240 * 3), 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(240 * 3), 3));
    particlePoints = new THREE.Points(particleGeo, new THREE.PointsMaterial({ size: 0.9, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    particlePoints.frustumCulled = false;
    cityGroup.add(particlePoints);
    tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 2 * 3), 3));
    tracerLines = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.9 }));
    tracerLines.frustumCulled = false;
    cityGroup.add(tracerLines);

    // The helicopter (hidden until 4 stars).
    heliMesh = new THREE.Group();
    const heliBody = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.8, 2.4), new THREE.MeshLambertMaterial({ color: PALETTE.heli }));
    heliBody.castShadow = true;
    heliMesh.add(heliBody);
    const heliTail = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.7, 0.7), new THREE.MeshLambertMaterial({ color: PALETTE.heli }));
    heliTail.position.set(-4.4, 0.4, 0);
    heliMesh.add(heliTail);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.12, 0.5), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    rotor.position.y = 1.2;
    heliMesh.add(rotor);
    heliMesh.userData.rotor = rotor;
    const skidMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    for (const z of [1.1, -1.1]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 0.12), skidMat);
      skid.position.set(0, -1.15, z);
      heliMesh.add(skid);
    }
    heliMesh.visible = false;
    cityGroup.add(heliMesh);
    heliSpot = new THREE.Mesh(
      new THREE.ConeGeometry(7, 55, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
    );
    heliSpot.visible = false;
    cityGroup.add(heliSpot);
    heliCircle = new THREE.Mesh(
      new THREE.CircleGeometry(6, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    heliCircle.rotation.x = -Math.PI / 2;
    heliCircle.position.y = 0.1;
    heliCircle.visible = false;
    cityGroup.add(heliCircle);

    scene.add(cityGroup);
  }

  function getCarMesh(car) {
    let mesh = carMeshes.get(car.id);
    if (!mesh) {
      mesh = buildCarMesh(car.type, car.color);
      carMeshes.set(car.id, mesh);
      scene.add(mesh);
    }
    return mesh;
  }

  function getPersonMesh(ped) {
    let mesh = personMeshes.get(ped);
    if (!mesh) {
      mesh = buildPersonMesh(ped.skin, ped.shirt, false);
      personMeshes.set(ped, mesh);
      scene.add(mesh);
    }
    return mesh;
  }

  function syncCars(state, dt, elapsed) {
    const alive = new Set();
    for (const car of state.cars) {
      alive.add(car.id);
      const mesh = getCarMesh(car);
      mesh.position.set(car.x, 0, car.z);
      mesh.rotation.y = -car.angle;
      // Body roll with steering, pitch with throttle.
      mesh.rotation.z = car.steerVis * Math.min(1, car.speed / 30) * 0.05;
      mesh.rotation.x = car.brakeLight ? 0.02 : 0;
      const wheels = mesh.userData.wheels;
      for (let i = 0; i < wheels.length; i += 1) {
        wheels[i].rotation.z = car.wheelSpin;
        if (i < 2) wheels[i].rotation.y = car.steerVis * 0.35;
      }
      const bar = mesh.userData.lightBar;
      if (bar) {
        const on = Math.floor(elapsed * 6) % 2 === 0;
        bar.children[0].material.emissive.setHex(on ? 0xff0000 : 0x220000);
        bar.children[1].material.emissive.setHex(on ? 0x000022 : 0x0033ff);
      }
      // Smoke: a dark puff above a wrecked car.
      if (car.smoke > 0 && Math.random() < dt * 6) {
        // (particles come from the world; the mesh just shows the damage)
      }
    }
    for (const [id, mesh] of carMeshes) {
      if (!alive.has(id)) {
        scene.remove(mesh);
        carMeshes.delete(id);
      }
    }
  }

  function syncPeople(state) {
    const alive = new Set();
    for (const ped of state.peds) {
      alive.add(ped);
      const mesh = getPersonMesh(ped);
      mesh.position.set(ped.x, 0, ped.z);
      if (ped.state === 'down') {
        mesh.rotation.y = -ped.angle;
        mesh.rotation.z = Math.PI / 2;
        mesh.position.y = 0.25;
      } else {
        mesh.rotation.y = -ped.angle;
        mesh.rotation.z = 0;
        mesh.position.y = 0;
        const swing = Math.sin(ped.walkPhase) * 0.5;
        mesh.userData.legs[0].rotation.z = swing;
        mesh.userData.legs[1].rotation.z = -swing;
        mesh.userData.arms[0].rotation.z = -swing * 0.7;
        mesh.userData.arms[1].rotation.z = swing * 0.7;
      }
    }
    for (const cop of state.police.footCops) {
      alive.add(cop);
      const mesh = getPersonMesh(cop);
      mesh.position.set(cop.x, 0, cop.z);
      mesh.rotation.y = -cop.angle;
      mesh.rotation.z = 0;
      const swing = Math.sin(cop.walkPhase) * 0.5;
      mesh.userData.legs[0].rotation.z = swing;
      mesh.userData.legs[1].rotation.z = -swing;
      mesh.userData.arms[0].rotation.z = -swing * 0.7;
      mesh.userData.arms[1].rotation.z = swing * 0.7;
    }
    for (const [ped, mesh] of personMeshes) {
      if (!alive.has(ped)) {
        scene.remove(mesh);
        personMeshes.delete(ped);
      }
    }
  }

  function syncPlayer(state) {
    const player = state.player;
    if (!playerMesh) {
      playerMesh = buildPersonMesh(0xe8c39e, PALETTE.playerShirt, true);
      scene.add(playerMesh);
    }
    if (player.onFoot) {
      playerMesh.visible = true;
      playerMesh.position.set(player.x, 0, player.z);
      playerMesh.rotation.y = -player.angle;
      playerMesh.rotation.z = 0;
      const swing = Math.sin(player.walkPhase) * 0.55;
      playerMesh.userData.legs[0].rotation.z = swing;
      playerMesh.userData.legs[1].rotation.z = -swing;
      playerMesh.userData.arms[0].rotation.z = -swing * 0.7;
      playerMesh.userData.arms[1].rotation.z = swing * 0.7;
      if (state.combat.muzzle > 0) {
        playerMesh.userData.arms[0].rotation.z = -1.2;
      }
    } else {
      playerMesh.visible = false;
    }
  }

  function syncMarkers(state, elapsed) {
    const missions = state.missions;
    if (missions.target && markerMesh) {
      const bob = Math.sin(elapsed * 3) * 0.5;
      markerMesh.visible = true;
      markerBeam.visible = true;
      markerMesh.position.set(missions.target.x, 5 + bob, missions.target.z);
      markerMesh.rotation.y = elapsed * 1.5;
      markerBeam.position.set(missions.target.x, 17, missions.target.z);
    } else if (markerMesh) {
      markerMesh.visible = false;
      markerBeam.visible = false;
    }
    if (missions.taxi && taxiMarker) {
      const spot = missions.taxi.state === 'waiting' ? missions.taxi.pickup : missions.taxi.dropoff;
      taxiMarker.visible = true;
      taxiMarker.position.set(spot.x, 3 + Math.sin(elapsed * 3) * 0.3, spot.z);
      taxiMarker.rotation.y = elapsed * 2;
    } else if (taxiMarker) {
      taxiMarker.visible = false;
    }
    for (let i = 0; i < packageMeshes.length; i += 1) {
      const pack = missions.packages[i];
      const mesh = packageMeshes[i];
      if (!pack) continue;
      mesh.visible = !pack.taken;
      mesh.position.set(pack.x, 0.9 + Math.sin(elapsed * 2 + i) * 0.25, pack.z);
      mesh.rotation.y = elapsed + i;
    }
  }

  function syncEffects(state, dt) {
    const pos = particleGeo.attributes.position.array;
    const col = particleGeo.attributes.color.array;
    const color = new THREE.Color();
    for (let i = 0; i < 240; i += 1) {
      const p = state.particles[i];
      if (p) {
        const rise = (1 - p.life / p.maxLife) * 1.6;
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = 0.6 + rise;
        pos[i * 3 + 2] = p.z;
        color.setHex(p.color);
        col[i * 3] = color.r;
        col[i * 3 + 1] = color.g;
        col[i * 3 + 2] = color.b;
      } else {
        pos[i * 3 + 1] = -100;
      }
    }
    particleGeo.attributes.position.needsUpdate = true;
    particleGeo.attributes.color.needsUpdate = true;
    const tpos = tracerGeo.attributes.position.array;
    for (let i = 0; i < 64; i += 1) {
      const t = state.tracers[i];
      if (t) {
        tpos[i * 6] = t.x1;
        tpos[i * 6 + 1] = 1.2;
        tpos[i * 6 + 2] = t.z1;
        tpos[i * 6 + 3] = t.x2;
        tpos[i * 6 + 4] = 1.2;
        tpos[i * 6 + 5] = t.z2;
      } else {
        tpos[i * 6 + 1] = -100;
        tpos[i * 6 + 4] = -100;
      }
    }
    tracerGeo.attributes.position.needsUpdate = true;
    // Helicopter.
    const heli = state.police.heli;
    if (heli.active && heliMesh) {
      heliMesh.visible = true;
      heliSpot.visible = true;
      heliCircle.visible = true;
      heliMesh.position.set(heli.x, heli.height, heli.z);
      heliMesh.rotation.y = -state.player.angle;
      heliMesh.userData.rotor.rotation.y += dt * 28;
      heliSpot.position.set(heli.x, heli.height / 2, heli.z);
      heliSpot.scale.y = heli.height / 55;
      heliCircle.position.set(state.player.x, 0.1, state.player.z);
      heliCircle.material.opacity = 0.22 + Math.sin(state.elapsed * 5) * 0.08;
    } else if (heliMesh) {
      heliMesh.visible = false;
      heliSpot.visible = false;
      heliCircle.visible = false;
    }
    // Clouds drift.
    for (const cloud of clouds) {
      cloud.position.x += dt * 0.7;
      if (cloud.position.x > WORLD.width + 60) cloud.position.x = -60;
    }
    // Sea shimmer.
    if (seaMesh) seaMesh.material.opacity = 0.9 + Math.sin(state.elapsed * 0.8) * 0.03;
  }

  function updateCamera(state, dt, screen) {
    const player = state.player;
    const subject = player.onFoot ? player : (player.car ?? player);
    const angle = subject.angle;
    const fx = Math.cos(angle);
    const fz = Math.sin(angle);
    let dist = player.onFoot ? CAMERA.footDistance : CAMERA.carDistance;
    let height = player.onFoot ? CAMERA.footHeight : CAMERA.carHeight;
    let lookX = subject.x + fx * CAMERA.lookAhead;
    let lookZ = subject.z + fz * CAMERA.lookAhead;
    let lookY = 1.6;
    if (shotCam) {
      dist = shotCam.distance;
      height = shotCam.height;
      if (shotCam.ahead !== undefined) {
        lookX = subject.x + fx * shotCam.ahead;
        lookZ = subject.z + fz * shotCam.ahead;
      }
      if (shotCam.side !== undefined) {
        // Camera off to the side instead of behind: orbit around the subject.
        const sideAngle = angle + shotCam.side;
        const cx = subject.x + Math.cos(sideAngle) * dist;
        const cz = subject.z + Math.sin(sideAngle) * dist;
        camPos.x += (cx - camPos.x) * Math.min(1, dt * 6);
        camPos.y += (height - camPos.y) * Math.min(1, dt * 6);
        camPos.z += (cz - camPos.z) * Math.min(1, dt * 6);
        camLook.x += (lookX - camLook.x) * Math.min(1, dt * 8);
        camLook.y += (lookY - camLook.y) * Math.min(1, dt * 8);
        camLook.z += (lookZ - camLook.z) * Math.min(1, dt * 8);
        applyCamera();
        return;
      }
    }
    if (screen === SCREEN_TITLE) {
      // Slow orbit over downtown for the title screen.
      const t = state.elapsed * 0.05;
      const cx = 600 + Math.cos(t) * 260;
      const cz = 450 + Math.sin(t) * 200;
      camPos.x += (cx - camPos.x) * Math.min(1, dt * 1.5);
      camPos.y += (95 - camPos.y) * Math.min(1, dt * 1.5);
      camPos.z += (cz - camPos.z) * Math.min(1, dt * 1.5);
      camLook.x += (600 - camLook.x) * Math.min(1, dt * 2);
      camLook.y += (0 - camLook.y) * Math.min(1, dt * 2);
      camLook.z += (450 - camLook.z) * Math.min(1, dt * 2);
      applyCamera();
      return;
    }
    const tx = subject.x - fx * dist;
    const tz = subject.z - fz * dist;
    const k = 1 - Math.exp(-5 * dt);
    camPos.x += (tx - camPos.x) * k;
    camPos.y += (height - camPos.y) * k;
    camPos.z += (tz - camPos.z) * k;
    const k2 = 1 - Math.exp(-8 * dt);
    camLook.x += (lookX - camLook.x) * k2;
    camLook.y += (lookY - camLook.y) * k2;
    camLook.z += (lookZ - camLook.z) * k2;
    applyCamera();
  }

  function applyCamera() {
    if (shake > 0.01) {
      camera.position.set(
        camPos.x + (Math.random() - 0.5) * shake,
        camPos.y + (Math.random() - 0.5) * shake * 0.6,
        camPos.z + (Math.random() - 0.5) * shake,
      );
      shake *= 0.86;
    } else {
      camera.position.copy(camPos);
    }
    camera.lookAt(camLook);
    // The sun's shadow box follows the player so shadows stay crisp.
    sun.position.set(camLook.x + 120, 260, camLook.z + 70);
    sun.target.position.set(camLook.x, 0, camLook.z);
  }

  function drawMinimap(state) {
    const ctx = minimapCtx;
    const w = 220;
    const h = 168;
    const sx = w / WORLD.width;
    const sz = h / WORLD.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0e2a3a';
    ctx.fillRect(0, 0, w, h);
    // Sea and beach.
    ctx.fillStyle = '#2fa8a0';
    ctx.fillRect(0, 0, state.city.seaX * sx, h);
    ctx.fillStyle = '#e8d5a3';
    ctx.fillRect(state.city.seaX * sx, 0, (state.city.beachX - state.city.seaX) * sx, h);
    // Roads.
    ctx.strokeStyle = '#5a564f';
    ctx.lineWidth = 3;
    for (const ax of state.city.avenues) {
      ctx.beginPath();
      ctx.moveTo(ax * sx, 0);
      ctx.lineTo(ax * sx, h);
      ctx.stroke();
    }
    for (const sy of state.city.streets) {
      ctx.beginPath();
      ctx.moveTo(0, sy * sz);
      ctx.lineTo(w, sy * sz);
      ctx.stroke();
    }
    // Mission marker (pulsing diamond).
    const missions = state.missions;
    if (missions.target) {
      const pulse = 4 + Math.sin(state.elapsed * 5) * 1.5;
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.moveTo(missions.target.x * sx, missions.target.z * sz - pulse);
      ctx.lineTo(missions.target.x * sx + pulse, missions.target.z * sz);
      ctx.lineTo(missions.target.x * sx, missions.target.z * sz + pulse);
      ctx.lineTo(missions.target.x * sx - pulse, missions.target.z * sz);
      ctx.fill();
    }
    // Taxi flag.
    if (missions.taxi) {
      const spot = missions.taxi.state === 'waiting' ? missions.taxi.pickup : missions.taxi.dropoff;
      ctx.fillStyle = '#fff176';
      ctx.fillRect(spot.x * sx - 3, spot.z * sz - 3, 6, 6);
    }
    // Police (flashing red dots).
    if (Math.floor(state.elapsed * 4) % 2 === 0) {
      ctx.fillStyle = '#ff3333';
      for (const cruiser of state.police.cruisers) {
        ctx.beginPath();
        ctx.arc(cruiser.x * sx, cruiser.z * sz, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Player (orange triangle, rotated by heading).
    const p = state.player;
    ctx.save();
    ctx.translate(p.x * sx, p.z * sz);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#f39c12';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-4, -4.5);
    ctx.lineTo(-4, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // North arrow.
    ctx.fillStyle = '#eef1f5';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('N', w - 14, 14);
  }

  function updateHud(state, screen, best) {
    const player = state.player;
    const missions = state.missions;
    hud.cash.textContent = `$${player.cash}`;
    hud.respect.textContent = `Respect ${player.respect} · Solmar Bay`;
    let stars = '';
    for (let i = 0; i < 5; i += 1) {
      stars += i < state.police.stars ? '★' : '<span class="off">★</span>';
    }
    hud.stars.innerHTML = stars;
    hud.healthFill.style.width = `${Math.max(0, player.health)}%`;
    hud.healthFill.style.background = player.health < 30 ? '#e74c3c' : '#2ecc71';
    hud.healthLabel.textContent = `Health ${Math.ceil(player.health)} · Packages ${missions.packagesFound}/12`;
    if (missions.target) {
      const d = Math.round(Math.hypot(missions.target.x - player.x, missions.target.z - player.z));
      hud.objective.textContent = `${missions.target.label} · ${d}m`;
    } else if (missions.state === 'idle' && missions.index < 5) {
      hud.objective.textContent = 'Get to the safehouse for the next job';
    } else if (missions.index >= 5) {
      hud.objective.textContent = 'Story complete — free roam';
    } else {
      hud.objective.textContent = '';
    }
    hud.dialogue.textContent = missions.dialogueTimer > 0 ? missions.dialogue : '';
    // The enter/exit cue: without it the player presses E blind and never knows a
    // car is in reach. Police cruisers cannot be taken, so they get no cue.
    if (screen !== SCREEN_PLAY) {
      hud.prompt.textContent = '';
    } else if (player.onFoot) {
      const near = nearestCar(state.cars, player.x, player.z, RADII.enterCar);
      hud.prompt.textContent = near && near.driver !== 'police' ? 'Press E to drive' : '';
    } else {
      hud.prompt.textContent = 'Press E to get out';
    }
    const speedKmh = Math.round((player.onFoot ? player.speed : (player.car ? player.car.speed : 0)) * 3.6);
    hud.speed.textContent = player.onFoot ? '' : `${speedKmh} km/h`;
    hud.ammo.textContent = player.onFoot ? `Ammo ${state.combat.ammo}${state.combat.reloading > 0 ? ' — reloading' : ''}` : '';
    hud.crosshair.style.display = player.onFoot && screen === SCREEN_PLAY ? 'block' : 'none';
    drawMinimap(state);
    hud.title.classList.toggle('hidden', screen !== SCREEN_TITLE);
    hud.paused.classList.toggle('hidden', screen !== SCREEN_PAUSED);
    hud.over.classList.toggle('hidden', screen !== SCREEN_OVER);
    hud.mission.classList.toggle('hidden', screen !== SCREEN_MISSION);
    // The in-game HUD belongs to play only: on the title, pause, mission and
    // game-over screens it would show through the overlay and clutter it.
    const hudOn = screen === SCREEN_PLAY;
    hud.topLeft.classList.toggle('hidden', !hudOn);
    hud.bottomLeft.classList.toggle('hidden', !hudOn);
    hud.bottomCenter.classList.toggle('hidden', !hudOn);
    hud.bottomRight.classList.toggle('hidden', !hudOn);
    hud.minimap.classList.toggle('hidden', !hudOn);
    if (screen === SCREEN_TITLE) {
      hud.titlePrompt.textContent = best > 0
        ? `Best cash $${best} — press Enter or click to continue`
        : 'Press Enter or click to start';
    }
    if (screen === SCREEN_OVER) {
      const busted = state.overReason === 'busted';
      hud.overTitle.textContent = busted ? 'BUSTED' : 'WASTED';
      hud.overText.textContent = busted
        ? 'The Solmar Bay police took you in.'
        : 'Jax went down. Mama Rosa will find another driver — or will she?';
    }
    if (screen === SCREEN_MISSION) {
      hud.missionText.textContent = missions.index + 1 < 5
        ? `Job ${missions.index + 1} done. Mama Rosa has another one waiting.`
        : 'The Anchor Job is done. Solmar Bay is yours, Jax.';
    }
  }

  return {
    /** Build the static city meshes for a new world (call once per world). */
    buildCity(state) {
      buildCityMeshes(state.city);
      carMeshes.clear();
      personMeshes.clear();
      playerMesh = null;
    },
    /** Instantly place the camera at its follow position (for screenshots). */
    snapCamera(state) {
      const player = state.player;
      const subject = player.onFoot ? player : (player.car ?? player);
      const angle = subject.angle;
      const dist = player.onFoot ? CAMERA.footDistance : CAMERA.carDistance;
      const height = player.onFoot ? CAMERA.footHeight : CAMERA.carHeight;
      camPos.set(subject.x - Math.cos(angle) * dist, height, subject.z - Math.sin(angle) * dist);
      camLook.set(subject.x + Math.cos(angle) * CAMERA.lookAhead, 1.6, subject.z + Math.sin(angle) * CAMERA.lookAhead);
      if (shotCam && shotCam.side !== undefined) {
        const sideAngle = angle + shotCam.side;
        camPos.set(subject.x + Math.cos(sideAngle) * shotCam.distance, shotCam.height, subject.z + Math.sin(sideAngle) * shotCam.distance);
      }
      applyCamera();
    },
    /** Set the screenshot camera mode ({distance, height, side?, ahead?}) or null. */
    setShotCamera(mode) {
      shotCam = mode;
    },
    addShake(amount) {
      shake = Math.min(1.2, shake + amount * 0.08);
    },
    /** Raycast the screen point onto the ground plane (y = 0) for mouse aim. */
    screenToWorld(sx, sy) {
      const ndcX = (sx / window.innerWidth) * 2 - 1;
      const ndcY = -(sy / window.innerHeight) * 2 + 1;
      const origin = camera.position.clone();
      const dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
      if (Math.abs(dir.y) < 0.0001) return { x: origin.x, z: origin.z };
      const t = -origin.y / dir.y;
      return { x: origin.x + dir.x * t, z: origin.z + dir.z * t };
    },
    /** Draw one frame. `dt` is the real frame time for camera smoothing. */
    draw(state, screen, best, dt) {
      if (!cityGroup || builtCity !== state.city) this.buildCity(state);
      syncCars(state, dt, state.elapsed);
      syncPeople(state);
      syncPlayer(state);
      syncMarkers(state, state.elapsed);
      syncEffects(state, dt);
      updateCamera(state, dt, screen);
      updateHud(state, screen, best);
      renderer.render(scene, camera);
    },
  };
}
