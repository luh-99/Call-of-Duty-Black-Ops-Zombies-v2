// Pure /bo1zm choice rules. "normal" remains an accepted spelling in old links.
export const modeValue = value => ['single', 'multi'].includes(value) ? value : null;
export const gunsValue = value => value === 'cs' ? 'cs' : ['classic', 'normal'].includes(value) ? 'classic' : null;
export function readChoices(query, saved = {}) {
  return { mode: modeValue(query.get('mode')) ?? modeValue(saved.mode) ?? 'single',
    guns: gunsValue(query.get('guns')) ?? gunsValue(saved.guns) ?? 'classic',
    explicit: Boolean(modeValue(query.get('mode')) && gunsValue(query.get('guns'))) };
}
export function mapRules(guns, map, horde = false) {
  const cs = guns === 'cs', offered = map?.normal?.mods?.includes('cstest') === true;
  return { allowed: !cs || offered, horde: !cs && horde,
    reason: cs && !offered ? 'Counter-Strike guns are not available on this map.' :
      cs && !map?.normal?.csLooks ? 'Black Ops gun models on this map' : '',
    hellReason: cs ? 'Hell mode needs Classic guns.' : '' };
}
export const choiceSummary = choice => `${choice.mode === 'multi' ? 'Multiplayer' : 'Single player'} · ${choice.guns === 'cs' ? 'Counter-Strike' : 'Classic'} guns${choice.quality === 'low' ? ' · Low graphics' : ''}`;
