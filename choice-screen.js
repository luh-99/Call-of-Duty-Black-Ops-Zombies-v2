import { readChoices, mapRules } from './choices.js';
import { playerName } from './player-name.js';
import { startController } from './gamepad.js';
import { gameText } from './game-text.js';
import { pickedQuality, rememberQuality, autoQuality, gpuWarning } from './quality.js';

export function savedChoices(query = new URLSearchParams(location.search)) {
  const saved = {};
  try { saved.mode = localStorage.getItem('bo1zm-mode'); saved.guns = localStorage.getItem('bo1zm-guns'); } catch { /* optional */ }
  // lowfps: quality = the player's own pick, or null until autoQuality() fills in the default (choiceScreen).
  return { ...readChoices(query, saved), quality: pickedQuality(query.toString()) };
}
export function rememberChoices(choice) {
  try { localStorage.setItem('bo1zm-mode', choice.mode); localStorage.setItem('bo1zm-guns', choice.guns); } catch { /* optional */ }
}
export function choiceScreen({ choice, map, horde = false, onContinue }) {
  startController();
  if (!document.querySelector('link[data-choices]')) {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('choices.css', import.meta.url);
    css.dataset.choices = ''; document.head.append(css);
    new Image().src = new URL('art/menu-keyart.webp', import.meta.url); // do not wait for the sheet to ask for it
  }
  const screen = document.createElement('section'); screen.id = 'flow-choices'; screen.setAttribute('aria-label', 'Choose your game');
  const sheet = document.querySelector('link[data-choices]');
  if (!sheet.sheet) { // not drawn (but focusable) until its sheet is there
    screen.style.opacity = '0'; sheet.addEventListener('load', () => { screen.style.opacity = ''; }); sheet.addEventListener('error', () => { screen.style.opacity = ''; });
  }
  // The game's menu language (choices.css): the key art, a title in the game's title font and list rows in its list
  // font (game-text.js), at the places the MISSION SELECT screen has its title and rows; the focused option is
  // described on the right, where that screen describes the focused map. The name comes first and is asked in both
  // modes: single player shows it on the scoreboard too (coop.js hands it to the engine).
  screen.innerHTML = `<div class="choices-stage"><header class="choices-head"><h1 id="choice-title"></h1><p id="choice-map"></p></header>
    <div class="choices-list"><div id="choice-name-field"><label for="choice-name" id="choice-name-label"></label><input id="choice-name" maxlength="16" autocomplete="nickname" spellcheck="false" aria-describedby="choice-name-help"><small id="choice-name-help"></small></div>
    <h2 id="mode-heading"></h2><div id="mode-choice" role="radiogroup" aria-labelledby="mode-heading"></div>
    <h2 id="guns-heading"></h2><div id="guns-choice" role="radiogroup" aria-labelledby="guns-heading"></div>
    <h2 id="quality-heading"></h2><div id="quality-choice" role="radiogroup" aria-labelledby="quality-heading"></div>
    <p id="choice-reason" role="status"></p><button id="choice-next" type="button"></button></div>
    <p id="choice-gpu" class="choices-gpu" role="alert" hidden></p>
    <aside class="choices-info" aria-hidden="true"><h2 id="choice-info-title"></h2><p id="choice-info-text"></p></aside></div>`;
  const $ = id => screen.querySelector('#' + id);
  gameText($('choice-title'), 'Game setup', { font: 'title' });
  gameText($('mode-heading'), 'Mode', { font: 'title' }); gameText($('guns-heading'), 'Guns', { font: 'title' });
  gameText($('quality-heading'), 'Graphics', { font: 'title' });
  gameText($('choice-name-label'), 'Your name', { font: 'title' });
  gameText($('choice-map'), map ? map.name + (horde ? ' · Hell mode' : '') : ''); $('choice-map').hidden = !map;
  const groups = {
    mode: [['single', 'Single player', 'Play alone'], ['multi', 'Multiplayer', 'Create a lobby, invite friends']],
    guns: [['classic', 'Classic', 'The original Black Ops guns'], ['cs', 'Counter-Strike', 'Counter-Strike 2 guns, recoil and movement']],
    quality: [['high', 'High', 'Shadows and full resolution'], ['low', 'Low', 'No shadows and a lower resolution: a smoother game on slower computers']],
  };
  // lowfps: not picked yet = High for now, then the detected default (Low without a graphics card), unless picked meanwhile.
  let autoLow = false;
  if (!choice.quality) choice.quality = 'high';
  autoQuality().then(auto => {
    const warning = gpuWarning(auto); $('choice-gpu').textContent = warning ?? ''; $('choice-gpu').hidden = !warning;
    if (pickedQuality()) return; choice.quality = auto.quality; autoLow = auto.quality === 'low'; render();
  });
  addEventListener('bo1z-quality', event => { if (choice.quality !== event.detail) { choice.quality = event.detail; render(); } });
  for (const [key, options] of Object.entries(groups)) {
    const group = $(key + '-choice');
    for (const [value, label, description] of options) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset[key] = value;
      button.setAttribute('role', 'radio');
      const title = document.createElement('b'), small = document.createElement('small');
      gameText(title, label); gameText(small, description, { font: 'text' });
      button.append(title, small); group.append(button); button.info = [label, description];
      button.onpointerenter = () => { hovered = button; describe(); }; button.onpointerleave = () => { hovered = null; describe(); };
      button.onclick = () => { choice[key] = value; if (key === 'quality') rememberQuality(value); rememberChoices(choice); render(); button.focus(); };
    }
    group.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...group.children], index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
        (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next].click(); buttons[next].focus();
    };
  }
  // The option under the pointer, else the focused one, else the chosen mode.
  let hovered = null;
  function describe() {
    const focused = screen.contains(document.activeElement) && document.activeElement.info ? document.activeElement : null;
    const [title, text] = (hovered ?? focused ?? screen.querySelector('[data-mode][aria-checked=true]')).info;
    gameText($('choice-info-title'), title, { font: 'title' }); gameText($('choice-info-text'), text, { font: 'text' });
  }
  screen.addEventListener('focusin', describe);
  $('choice-next').onpointerenter = () => { hovered = $('choice-next'); describe(); }; $('choice-next').onpointerleave = () => { hovered = null; describe(); };
  const setHelp = text => { gameText($('choice-name-help'), text, { font: 'text' }); $('choice-name').info = ['Your name', text]; };
  const help = 'Up to 16 letters, numbers, spaces or . _ \' ! -';
  setHelp(help);
  try { $('choice-name').value = playerName(localStorage.getItem('bo1zm-player-name')); } catch { /* optional */ }
  $('choice-name').oninput = () => {
    const value = playerName($('choice-name').value);
    setHelp($('choice-name').value.trim() && !value ? 'Use letters, numbers, spaces or . _ \' ! -' : help); describe();
    try { localStorage.setItem('bo1zm-player-name', value); } catch { /* optional */ }
  };
  $('choice-name').onblur = () => { $('choice-name').value = playerName($('choice-name').value); };
  $('choice-name').onpointerenter = () => { hovered = $('choice-name'); describe(); }; $('choice-name').onpointerleave = () => { hovered = null; describe(); };
  // The text field is first but never a trap: Enter goes on like the red row, Down moves to the chosen mode
  // (Left / Right stay with the caret). A gamepad's d-pad already steps through it (gamepad.js).
  $('choice-name').onkeydown = event => {
    if (event.isComposing || !['Enter', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowDown') screen.querySelector('[data-mode][aria-checked=true]').focus();
    else { $('choice-name').onblur(); $('choice-next').click(); }
  };
  function render() {
    for (const key of ['mode', 'guns', 'quality']) for (const button of screen.querySelectorAll(`[data-${key}]`)) {
      const checked = choice[key] === button.dataset[key]; button.setAttribute('aria-checked', String(checked)); button.tabIndex = checked ? 0 : -1;
    }
    screen.querySelector('[data-quality=low]').info = ['Low', (autoLow && choice.quality === 'low'
      ? 'Picked for this computer: the browser is drawing without a graphics card. ' : '') + groups.quality[1][2]];
    const rule = mapRules(choice.guns, map, horde);
    const reason = map ? horde && choice.guns === 'cs' ? rule.hellReason : rule.reason : '';
    gameText($('choice-reason'), reason, { font: 'text' }); $('choice-reason').hidden = !reason;
    $('choice-next').disabled = Boolean(map && (!rule.allowed || horde && choice.guns === 'cs'));
    const next = map ? choice.mode === 'multi' ? 'Create lobby' : 'Play' : 'Choose map';
    gameText($('choice-next'), next);
    $('choice-next').info = [next, map ? (choice.mode === 'multi' ? 'Open a lobby for ' : 'Start ') + map.name : 'Next: pick the map'];
    describe();
  }
  // Keep the covered map/game controls out of the keyboard's tab order as well as out of sight.
  const behind = [...document.body.children].map(element => [element, element.inert]);
  $('choice-next').onclick = () => {
    for (const [element, inert] of behind) element.inert = inert;
    rememberChoices(choice); onContinue({ ...choice });
  };
  document.body.append(screen); render();
  const focus = () => {
    for (const [element] of behind) element.inert = true;
    screen.querySelector('[data-mode][aria-checked=true]').focus();
    hovered = null; describe(); // the pointer may have left while the screen was hidden
  };
  focus();
  return { screen, focus };
}
