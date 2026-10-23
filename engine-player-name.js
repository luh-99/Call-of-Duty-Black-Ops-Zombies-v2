import { playerName } from './player-name.js';

// What the engine itself calls a player without a name when there is no Steam persona (src/live/live_win.cpp).
export const SOLO_NAME = 'Player';

export function enginePlayerName(value, fallback) {
  return playerName(value) || playerName(fallback) || 'Friend';
}

// Older engines have no setter; keep the site usable with those builds.
export function setEnginePlayerName(module, value, fallback) {
  if (typeof module?._KB_SetPlayerName !== 'function') return false;
  const name = enginePlayerName(value, fallback);
  const address = module._malloc(17);
  if (!address) return false;
  try {
    const heap = new Uint8Array(module.HEAPF32.buffer, address, 17);
    heap.fill(0);
    for (let i = 0; i < name.length; ++i) heap[i] = name.charCodeAt(i);
    return module._KB_SetPlayerName(address) === 1;
  } finally { module._free(address); }
}
