// Saving and loading, through localStorage with the starter's try/catch pattern: storage
// can be off (private windows), and then progress lasts this visit only. Only numbers and
// small state are saved — cash, respect, missions done, packages found, best cash.

import { BEST_KEY, SAVE_KEY } from './config.js';

export function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw);
    if (typeof save !== 'object' || save === null) return null;
    return {
      cash: Number(save.cash) || 0,
      respect: Number(save.respect) || 0,
      missionsDone: Number(save.missionsDone) || 0,
      packagesFound: Number(save.packagesFound) || 0,
    };
  } catch {
    return null;
  }
}

export function writeSave(save) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Storage can be off: the save then lasts this visit only.
  }
}

export function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

export function writeBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off: the best cash then lasts this visit only.
  }
}
