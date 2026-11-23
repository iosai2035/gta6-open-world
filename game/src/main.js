// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints what is there. The
// game moves between five screens: title, play, paused, game over and mission complete.
// On foot, WASD moves relative to where Jax faces (W walks away from the camera); in a car
// the keys drive the car. The mouse aims the pistol; click fires.
//
// ?seed=N fixes the city. ?shot=1-cover|2-drive|3-onfoot|4-heist (with &seed=N) stages that
// scene instead of running the loop, paints it twice and sets window.__shotReady.

import { STEP } from './config.js';
import { createRandom } from './rng.js';
import { createWorld, EVENT_BUSTED, EVENT_FAIL, EVENT_HIT, EVENT_MISSION, EVENT_PICKUP, EVENT_SHOT, EVENT_WASTED } from './world.js';
import { ACTION_CONFIRM, ACTION_ENTER, ACTION_MUTE, ACTION_PAUSE, ACTION_PUNCH, createInput } from './input.js';
import { createRenderer, SCREEN_MISSION, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createAudio } from './audio.js';
import { readBest, readSave, writeBest, writeSave } from './save.js';
import { startMission } from './missions.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed), seed);
const renderer = createRenderer(canvas);
const audio = createAudio();
const saved = readSave();

function saveProgress() {
  const player = world.state.player;
  const missions = world.state.missions;
  writeSave({
    cash: player.cash,
    respect: player.respect,
    missionsDone: Math.min(missions.index + (missions.state === 'done' ? 1 : 0), 5),
    packagesFound: missions.packagesFound,
  });
  if (player.cash > readBest()) writeBest(player.cash);
}

function applySave() {
  if (!saved) return;
  const player = world.state.player;
  const missions = world.state.missions;
  player.cash = saved.cash;
  player.respect = saved.respect;
  for (let i = 0; i < Math.min(saved.packagesFound, missions.packages.length); i += 1) {
    missions.packages[i].taken = true;
  }
  missions.packagesFound = Math.min(saved.packagesFound, missions.packages.length);
  if (saved.missionsDone > 0 && saved.missionsDone < 5) {
    startMission(missions, world.state.city, saved.missionsDone);
  } else if (saved.missionsDone >= 5) {
    missions.index = 5;
    missions.state = 'idle';
    missions.target = null;
  }
}

function runShot(name) {
  const scene = stageShot(name, world, renderer);
  renderer.snapCamera(world.state);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best, STEP);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();

  // Screen readers (and anyone watching the page's text) hear the screen changes and each hit.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    world.reset();
    applySave();
    accumulator = 0;
    screen = SCREEN_PLAY;
    audio.unlock();
    audio.stopMusic();
    announce('Playing. Solmar Bay. Drive with WASD, steal a car with E.');
  }

  function endGame(busted) {
    world.state.overReason = busted ? 'busted' : 'wasted';
    screen = SCREEN_OVER;
    saveProgress();
    if (world.state.player.cash > best) best = world.state.player.cash;
    announce(busted ? 'Busted. The police took you in.' : 'Wasted. Jax went down.');
  }

  function missionComplete() {
    screen = SCREEN_MISSION;
    saveProgress();
    audio.mission();
    announce('Mission complete.');
  }

  function continueFromMission() {
    const missions = world.state.missions;
    const next = missions.index + 1;
    if (next < 5) {
      startMission(missions, world.state.city, next);
      screen = SCREEN_PLAY;
      announce(`Next job: ${missions.target ? missions.target.label : ''}`);
    } else {
      missions.index = 5;
      screen = SCREEN_TITLE;
      announce('The story of Solmar Bay is yours. Free roam continues.');
    }
  }

  function handleActions(actions) {
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Muted.' : 'Sound on.');
    }
    if (actions & ACTION_CONFIRM) {
      audio.unlock();
      if (screen === SCREEN_TITLE || screen === SCREEN_OVER) startGame();
      else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      } else if (screen === SCREEN_MISSION) continueFromMission();
    } else if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    }
  }

  function step(actions) {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, { moveX: 0, moveZ: 0, throttle: 0, steer: 0, handbrake: false, enter: false, punch: false, fire: false, aimX: 0, aimZ: 0 }, true);
      return;
    }
    const move = input.move();
    const drive = input.drive();
    const mouse = input.mouse();
    const aim = renderer.screenToWorld(mouse.x, mouse.y);
    const player = world.state.player;
    // Read the trigger once per step: isFiring consumes a queued click, so reading
    // it twice would eat the shot before the controls see it.
    const firingNow = player.onFoot && input.isFiring();
    if (firingNow) {
      player.angle = Math.atan2(aim.z - player.z, aim.x - player.x);
    }
    // Screen-space keys into world space, relative to where Jax faces: W walks away
    // from the camera, A and D strafe, S backs up.
    const fx = Math.cos(player.angle);
    const fz = Math.sin(player.angle);
    const rx = -fz;
    const rz = fx;
    const controls = {
      moveX: fx * (-move.y) + rx * move.x,
      moveZ: fz * (-move.y) + rz * move.x,
      throttle: drive.throttle,
      steer: drive.steer,
      handbrake: drive.handbrake,
      enter: Boolean(actions & ACTION_ENTER),
      punch: Boolean(actions & ACTION_PUNCH),
      fire: firingNow,
      aimX: aim.x,
      aimZ: aim.z,
    };
    const events = world.step(STEP, controls, false);
    const speed = player.onFoot ? player.speed : (player.car ? player.car.speed : 0);
    audio.update(speed, drive.throttle, world.state.police.stars);
    if (events & EVENT_WASTED) endGame(false);
    else if (events & EVENT_BUSTED) endGame(true);
    else if (events & EVENT_MISSION) missionComplete();
    else if (events & EVENT_HIT) {
      renderer.addShake(7);
      audio.crash();
      announce('Hit.');
    } else if (events & EVENT_SHOT) {
      audio.gunshot();
    } else if (events & EVENT_PICKUP) {
      audio.pickup();
    } else if (events & EVENT_FAIL) {
      announce('Mission failed. Get back to the safehouse to try again.');
    }
    // A failed mission restarts at Mama Rosa's safehouse.
    const missions = world.state.missions;
    if (missions.state === 'idle' && missions.index < 5) {
      const safe = world.state.city.spots.safehouse;
      if (Math.hypot(safe.x - player.x, safe.z - player.z) < 22) {
        startMission(missions, world.state.city, missions.index);
        announce(`New job: ${missions.target ? missions.target.label : ''}`);
      }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    accumulator += dt;
    last = now;
    // One-shot presses are taken once per frame and shared: handleActions reads the
    // screen-level ones (mute, confirm, pause) and the first fixed step reads the
    // world ones (enter a car, punch). Taking them twice per frame used to eat the
    // enter and punch presses before the world ever saw them.
    const actions = input.takeActions();
    handleActions(actions);
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      let first = true;
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step(first ? actions : 0);
        first = false;
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen, best, dt);
  }

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  audio.startMusic();
  announce('Solmar Bay. Press Enter or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
