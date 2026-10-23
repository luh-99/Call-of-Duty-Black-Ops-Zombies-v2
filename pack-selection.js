// Co-op pages know the game before downloading. Undefined leaves the solo site's
// existing pack/options behavior intact; an empty list means no mod files.
import { CS_MOD } from './guns.js';
import { HORDE_GAME } from './horde.js';

export function downloadMods({ enabled, room, guns, horde, mods = [] }) {
  if (!enabled) return undefined;
  if (room) return [...room.mods]; // Invites always follow the room, never saved choices.
  if (horde) return ['horde', ...HORDE_GAME.mods];
  if (guns === 'cs') return [CS_MOD];
  return mods.filter(name => name !== CS_MOD);
}

export function selectPack(manifest, mods) {
  if (mods === undefined) return manifest;
  const wanted = new Set(mods.map(name => name.toLowerCase()));
  if (wanted.size && !wanted.has(CS_MOD)) wanted.add('_stack');
  const files = manifest.files.filter(file => {
    const mod = /^mods\/([^/]+)\//i.exec(file.path);
    return !mod || wanted.has(mod[1].toLowerCase());
  });
  // Keep Options' offered mods even though the engine/download gate sees only
  // selected files. The download reselects from the full inspected manifest.
  const offeredMods = manifest.files.some(f => /^mods\/_stack\//i.test(f.path))
    ? [...new Set(manifest.files.flatMap(f => /^mods\/([^/]+)\//i.exec(f.path)?.[1]?.toLowerCase() ?? []))] : [];
  return { ...manifest, files, total_bytes: files.reduce((sum, file) => sum + file.size, 0), offeredMods };
}
