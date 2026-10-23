// /bo1zm only: choices first, then the existing map-select screen.
import { choiceScreen, savedChoices } from './choice-screen.js';
import { mapRules, choiceSummary } from './choices.js';
import { startController } from './gamepad.js';
import { gameText } from './game-text.js';
startController();
const choice = savedChoices(), stage = document.querySelector('.stage');
stage.hidden = true; stage.inert = true;
const bar = document.createElement('nav'); bar.id = 'flow-map-bar'; bar.hidden = true;
bar.innerHTML = '<button type="button" id="choice-back"></button><div><span id="flow-summary"></span><small id="flow-map-reason"></small></div>';
gameText(bar.querySelector('#choice-back'), 'Back');
document.body.append(bar);
let build, refresh, active = false;
const view = choiceScreen({ choice, onContinue: () => {
  history.pushState({ flow: 'maps' }, '', location.href); showMaps();
} });
const buildReady = fetch(new URL('coop-build.json', import.meta.url)).then(r => {
  if (!r.ok) throw new Error('Could not load the map list. Reload to try again.');
  return r.json();
}).then(value => { build = value; }).catch(error => {
  const reason = document.querySelector('#choice-reason'); gameText(reason, error.message, { font: 'text' }); reason.hidden = false;
  document.querySelector('#choice-next').disabled = true;
});
globalThis.__kisakFlow = {
  params(params) { params.set('mode', choice.mode); params.set('guns', choice.guns); },
  horde: () => choice.guns !== 'cs',
  allowed: entry => mapRules(choice.guns, build?.maps.find(m => m.slug === entry.id)).allowed,
  refresh(fn) { refresh = fn; },
  select(entry) {
    const rule = mapRules(choice.guns, build?.maps.find(m => m.slug === entry.id));
    gameText(document.querySelector('#flow-map-reason'), [rule.reason, rule.hellReason].filter(Boolean).join(' \u00b7 '), { font: 'text' });
  },
  pop(event) {
    if (document.body.classList.contains('picked') || globalThis.__kisakLandingPick || !document.querySelector('.stage')) return false;
    if (event.state?.flow === 'maps') showMaps(false); else showChoices();
    return true;
  },
};
async function showMaps(focus = true) {
  await buildReady; if (!build) return;
  globalThis.__kisakMode = choice.mode; globalThis.__kisakGuns = choice.guns === 'cs' ? 'cs' : 'normal';
  if (!active) { await import('./landing.js'); active = true; }
  view.screen.hidden = true; stage.hidden = false; stage.style.visibility = 'visible'; stage.inert = false; bar.hidden = false;
  gameText(document.querySelector('#flow-summary'), choiceSummary(choice));
  refresh?.();
  if (focus) stage.querySelector('a[aria-disabled="false"], a:not([aria-disabled])')?.focus();
}
function showChoices() { stage.hidden = true; stage.inert = true; bar.hidden = true; view.screen.hidden = false; view.focus(); }
document.querySelector('#choice-back').onclick = () => history.back();
// landing.js owns popstate once loaded, including the full reload after entering a map.
