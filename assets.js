// Shared by solo loading and the lobby. Peer data is a path, never display text.
export function validAssetPath(path) {
  return path === undefined || path === null || path === '' || typeof path === 'string' && path.length <= 192
    && /^[a-zA-Z0-9_./-]+$/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
}

export function assetDescription(path, map) {
  if (!path || !validAssetPath(path)) return '';
  const file = path.split('/').at(-1), p = path.toLowerCase(), stem = file.toLowerCase();
  let description = 'Game files';
  if (p === 'mods/cstest/cs2_images.iwd') description = 'Counter-Strike gun textures';
  else if (p === 'mods/cstest/cs2_sounds.iwd') description = 'Counter-Strike gun sounds';
  else if (p === 'mods/cstest/mod.ff') description = 'Counter-Strike gun models';
  else if (p === 'mods/cstest/cs2_skins.iwd') description = 'Counter-Strike gun skins';
  else if (p === 'mods/cstest/cs2_hud_font.iwd') description = 'Counter-Strike HUD font';
  else if (p.startsWith('mods/')) description = 'Mod scripts';
  else if (p.startsWith('web/shaders/')) description = 'Shaders';
  else if (p.startsWith('web/sound/')) description = 'Sounds';
  else if (p.startsWith('main/localized_') || p === 'localization.txt') description = 'Voices and text';
  else if (p.startsWith('main/') && p.endsWith('.iwd')) description = 'Textures and sounds';
  else if (p.startsWith('zone/')) {
    if (map?.zone && (stem.startsWith(map.zone) || stem.startsWith('en_' + map.zone))) description = 'Map: ' + map.name;
    else if (/^(en_)?common_zombie/.test(stem)) description = 'Zombies mode';
    else description = 'Game code and data';
  }
  return `${description} (${file})`;
}

// Stable ties keep tiny parallel requests from repeatedly replacing the main transfer.
export function largestAsset(entries) {
  let largest = null;
  for (const entry of entries) if (!largest || entry.size > largest.size) largest = entry;
  return largest?.path ?? null;
}
