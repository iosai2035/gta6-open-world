// Keyboard and pointer input. Held keys give movement and driving; one-shot presses (enter
// a car, punch, pause, mute, confirm) are queued as bit flags and taken once by the loop, so
// a press between two frames is never lost and never counted twice. Space is the handbrake
// (held); Enter or a click confirms. The mouse aims the pistol and fires on click.
// move() returns {x: right, y: down} in screen space; the caller turns it into world space
// with the player's facing, so W always walks away from the camera.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER = 4;
export const ACTION_PUNCH = 8;
export const ACTION_MUTE = 16;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const ENTER = new Set(['KeyE']);
const PUNCH = new Set(['KeyF']);
const MUTE = new Set(['KeyM']);
const HANDBRAKE = new Set(['Space']);

export function createInput(target) {
  const held = { up: false, down: false, left: false, right: false, handbrake: false };
  let actions = 0;
  let firing = false;
  // A click is short: at a low frame rate the press and release can both land
  // between two frames, so the pistol would never fire. Latch one shot per click
  // until the loop reads it, like the other one-shot presses.
  let fireQueued = false;
  let mouseX = 0;
  let mouseY = 0;

  window.addEventListener('keydown', (event) => {
    if (UP.has(event.code)) held.up = true;
    else if (DOWN.has(event.code)) held.down = true;
    else if (LEFT.has(event.code)) held.left = true;
    else if (RIGHT.has(event.code)) held.right = true;
    else if (HANDBRAKE.has(event.code)) held.handbrake = true;
    else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (ENTER.has(event.code)) {
      if (!event.repeat) actions |= ACTION_ENTER;
    } else if (PUNCH.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PUNCH;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (UP.has(event.code)) held.up = false;
    else if (DOWN.has(event.code)) held.down = false;
    else if (LEFT.has(event.code)) held.left = false;
    else if (RIGHT.has(event.code)) held.right = false;
    else if (HANDBRAKE.has(event.code)) held.handbrake = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.up = false;
    held.down = false;
    held.left = false;
    held.right = false;
    held.handbrake = false;
    firing = false;
  });
  target.addEventListener('pointerdown', (event) => {
    actions |= ACTION_CONFIRM;
    firing = true;
    fireQueued = true;
    mouseX = event.clientX;
    mouseY = event.clientY;
  });
  target.addEventListener('pointerup', () => {
    firing = false;
  });
  target.addEventListener('pointermove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  });

  return {
    /** Movement vector in screen space: x right, y down (W gives y = -1). */
    move() {
      return {
        x: (held.right ? 1 : 0) - (held.left ? 1 : 0),
        y: (held.down ? 1 : 0) - (held.up ? 1 : 0),
      };
    },
    /** Driving: throttle -1..1, steer -1..1, handbrake held. */
    drive() {
      return {
        throttle: (held.up ? 1 : 0) - (held.down ? 1 : 0),
        steer: (held.right ? 1 : 0) - (held.left ? 1 : 0),
        handbrake: held.handbrake,
      };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Whether the pointer button is held, or a click queued since the last read. */
    isFiring() {
      const queued = fireQueued;
      fireQueued = false;
      return firing || queued;
    },
    /** The pointer's last position in client pixels. */
    mouse() {
      return { x: mouseX, y: mouseY };
    },
  };
}
