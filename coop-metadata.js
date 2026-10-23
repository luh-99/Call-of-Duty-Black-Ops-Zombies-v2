// coop-web: shared by the room service and the page before importing maps.js/play.js.
import { HORDE_GAME, hordeDefaults, HORDE_MIN, HORDE_MAX } from './horde.js';
import { CS_MOD } from './guns.js';

export const VERSION_FAILURE = 'The host needs to reload: different game version';
const keys = (v, allowed) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).every(k => allowed.includes(k));
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const usesHorde = m => m.horde || m.mods.includes('horde');
export function validMetadata(m) {
  if (!keys(m, ['map', 'horde', 'mods', 'engineBuild', 'packHash', 'hordeSettings'])
    || typeof m.map !== 'string' || !/^[a-z0-9_]{1,64}$/.test(m.map)
    || typeof m.horde !== 'boolean' || typeof m.engineBuild !== 'string' || !m.engineBuild.length || m.engineBuild.length > 128
    || !hash(m.packHash) || !Array.isArray(m.mods) || m.mods.length > 16
    || !m.mods.every(v => typeof v === 'string' && /^[a-z0-9_-]{1,128}$/.test(v))
    || new Set(m.mods).size !== m.mods.length) return false;
  // web-coop-cs: the Counter-Strike guns game is its own fs_game and cannot run with another mod or the Hell mode
  // (guns.js): a room that mixes them is not a game any page could start the same way, so it is not a room.
  if (m.mods.includes(CS_MOD) && (m.mods.length !== 1 || m.horde || m.hordeSettings !== undefined)) return false;
  const h = m.hordeSettings;
  if (h !== undefined && (!keys(h, ['n', 'round']) || !Number.isInteger(h.n) || h.n < HORDE_MIN || h.n > HORDE_MAX
    || !Number.isInteger(h.round) || h.round < 1 || h.round > 255)) return false;
  if (usesHorde(m) && !h) return false;
  // The site's fixed Hell mode has a different manifest and fixed settings.
  return !m.horde || h.n === HORDE_GAME.n && h.round === HORDE_GAME.round
    && JSON.stringify(m.mods) === JSON.stringify(['horde', ...HORDE_GAME.mods]);
}
export function sameGame(a, b) {
  return validMetadata(a) && validMetadata(b) && a.engineBuild === b.engineBuild && a.packHash === b.packHash
    && a.map === b.map && a.horde === b.horde && JSON.stringify(a.mods) === JSON.stringify(b.mods)
    && (!usesHorde(a) || a.hordeSettings.n === b.hordeSettings.n && a.hordeSettings.round === b.hordeSettings.round);
}

// Build descriptors are generated from the actual engine and manifest bytes, never URL parameters or saved settings.
export function roomSelection(metadata, build) {
  if (!validMetadata(metadata)) throw new Error('Invalid room settings');
  const map = build?.maps?.find(m => m.zone === metadata.map);
  const pack = map?.[metadata.horde ? 'horde' : 'normal'];
  if (!pack || build.engineBuild !== metadata.engineBuild || pack.hash !== metadata.packHash) throw new Error(VERSION_FAILURE);
  if (!metadata.mods.every(mod => pack.mods.includes(mod))) throw new Error('The room uses unavailable mods.');
  return { map, manifest: pack.manifest, settings: { mods: [...metadata.mods],
    horde: { ...(metadata.hordeSettings ?? hordeDefaults) } } };
}
export function hostMetadata(build, zone, settings, horde = false) {
  const map = build.maps.find(m => m.zone === zone), pack = map?.[horde ? 'horde' : 'normal'];
  if (!pack) throw new Error('This map is unavailable.');
  // web-coop-cs: the host's Guns choice (settings.guns 'cs', or the Options box of the solo page) is the mod alone.
  const cs = !horde && (settings.guns === 'cs' || settings.guns !== 'normal' && (settings.mods ?? []).includes(CS_MOD));
  const mods = horde ? ['horde', ...HORDE_GAME.mods] : cs ? [CS_MOD] : (settings.mods ?? []).filter(mod => mod !== CS_MOD);
  const metadata = { map: zone, horde, mods, engineBuild: build.engineBuild, packHash: pack.hash,
    ...(horde || mods.includes('horde') ? { hordeSettings: horde ? { n: HORDE_GAME.n, round: HORDE_GAME.round }
      : { ...(settings.horde ?? hordeDefaults) } } : {}) };
  roomSelection(metadata, build);
  return metadata;
}
