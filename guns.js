// web-coop-cs: the Counter-Strike guns game (mods/cstest, README "CS guns on every map") for the browser page.
// The mod id is the name of its folder in a pack (mods/cstest/...); a pack without those files never offers it.
// The start arguments are Play-CS-Zombies.bat's: the mod as fs_game (its own maps/_zombiemode_ffotd.gsc calls the
// mode's script; under fs_mods the stack's copy of that file would win and the mode would not start), the three mode
// dvars, and the mod's key binds. The engine keeps a per-fs_game player config (players/mods/cstest/config.cfg,
// Com_PlayerConfigPath), so the CS binds never reach the normal game's players/config.cfg.
// Not passed: cg_fov 90 and kisak_hitchlog 25 of the bat (a view preference and a native profiling log).
export const CS_MOD = 'cstest';
export const csLabel = looks => looks ? 'Counter-Strike' : 'Counter-Strike (Black Ops gun models on this map)';
// Layer 2 (local only, never deployed: deploy/cloudflare/local-only.mjs): a pack made by tools/web/mklookspack.mjs also
// ships CS2's looks as mods/cstest/mod.ff + images. The engine sizes its zone memory and asset tables for a mod.ff
// before it can look at the pack (static initialisers run before OPFS is mounted), so the page says it is there.
export const CS_LOOKS_FILE = 'mods/' + CS_MOD + '/mod.ff';
// csLooks: the mod.ff's size in bytes (0 = a pack without the looks); passed on as kisak_modff (physicalmemory.cpp).
export const csLooks = manifest => (manifest?.files ?? []).find(file => String(file.path).toLowerCase() === CS_LOOKS_FILE)?.size ?? 0;
export function csArguments(manifest) {
  return ['+set', 'fs_game', 'mods/' + CS_MOD, ...(csLooks(manifest) ? ['+set', 'kisak_modff', String(csLooks(manifest))] : []),
    '+set', 'cs_mode', '1', '+set', 'cs_movement', '1', '+set', 'cs_kino', '1', '+exec', 'cskino.cfg'];
}
