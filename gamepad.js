// Page-side controller input. These pure helpers do not depend on the DOM.
// Binds: src/qcommon/common.cpp:Com_ExecStartupConfigs, mods/cstest/{cstest,cskino}.cfg.
// Standard button     Classic key/action           CS key/action
// A (0)               Space / jump                 Space / jump
// B (1)               C / toggle crouch            Ctrl / crouch while held
// X (2)               F + R / use + reload         E + R / use + reload
// Y (3)               wheel down / next weapon    wheel down / next weapon
// LB (4), RB (5)      4 / tactical, G / frag        5 / tactical, G / select HE
// LT (6), RT (7)      Mouse2 / aim, Mouse1 / fire  Mouse2 / secondary, Mouse1 / fire
// View (8), Start (9) Tab / scores, Escape / menu  same
// LS (10), RS (11)    Shift / sprint, V / melee    Shift / walk, V / select knife
// D-pad U,D,L,R       X,6,7,5 / action slots 1,4,2,3   X,6,Q,F+B / equipment,claymore,last gun,inspect + other mode
// Left stick: WASD, digital (no slow walk). X sends both PC binds: the engine
// chooses what is possible. Custom keyboard rebinds also change these actions.
export const buttonKeys = Object.freeze({
  classic: [[32], [99], [102, 114], [205], [52], [103], [201], [200], [9], [27], [160], [118], [120], [54], [55], [53]],
  cs: [[32], [159], [101, 114], [205], [53], [103], [201], [200], [9], [27], [160], [118], [120], [54], [113], [102, 98]],
});
const axis = value => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
const pressed = button => Boolean(button?.pressed || button?.value >= .55);
export function touchedPad(pads, selected = null) {
  const valid = Array.from(pads ?? []).filter(p => p?.connected && p.mapping === 'standard');
  return valid.find(p => p.index === selected) ?? valid.find(p =>
    p.buttons.some(pressed) || p.axes.some(a => Math.abs(axis(a)) > .35)) ?? null;
}
export function stickDirections(x, y, previous = new Set()) {
  const values = { left: -axis(x), right: axis(x), up: -axis(y), down: axis(y) };
  return new Set(Object.entries(values).filter(([key, value]) => value >= (previous.has(key) ? .25 : .35)).map(([key]) => key));
}
export function lookVelocity(x, y, { sensitivity = 1, invertY = false, aiming = false } = {}) {
  x = axis(x); y = axis(y);
  const length = Math.hypot(x, y), dead = .18;
  if (length <= dead) return [0, 0];
  const speed = 1100 * ((Math.min(1, length) - dead) / (1 - dead)) ** 2
    * Math.max(.25, Math.min(3, Number(sensitivity) || 1)) * (aiming ? .45 : 1);
  return [x / length * speed, y / length * speed * (invertY ? -1 : 1)];
}
export class MenuRepeat {
  constructor() { this.next = new Map(); }
  reset() { this.next.clear(); }
  step(directions, now) {
    const pulses = [];
    for (const key of this.next.keys()) if (!directions.has(key)) this.next.delete(key);
    for (const key of directions) {
      if (!this.next.has(key)) { pulses.push(key); this.next.set(key, now + 360); }
      else if (now >= this.next.get(key)) { pulses.push(key); this.next.set(key, now + 90); }
    }
    return pulses; // At most one repeat per frame after a stall, never a burst.
  }
}
export class PadInput {
  constructor() {
    this.held = new Set(); this.buttons = []; this.directions = new Set();
    this.repeat = new MenuRepeat(); this.remainder = [0, 0]; this.last = null; this.mode = null;
  }
  release() {
    const events = [...this.held].map(key => ({ kind: 'key', key, down: false }));
    this.held.clear(); this.directions.clear(); this.repeat.reset(); this.remainder = [0, 0]; this.last = null;
    return events;
  }
  step(pad, now, { mode = 'game', guns = 'classic', ...settings } = {}) {
    const events = [];
    if (!pad?.connected) { this.buttons = []; this.mode = null; return { events: this.release(), actions: [] }; }
    if (mode !== this.mode) { events.push(...this.release()); this.mode = mode; }
    const dt = this.last === null ? 0 : Math.min(.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const buttons = pad.buttons.map(pressed), rising = i => buttons[i] && !this.buttons[i];
    this.directions = stickDirections(pad.axes[0], pad.axes[1], this.directions);
    const desired = new Set(), actions = [];
    const pulse = key => events.push({ kind: 'key', key, down: true }, { kind: 'key', key, down: false });
    if (mode === 'game') {
      const movement = { up: 119, down: 115, left: 97, right: 100 };
      for (const direction of this.directions) desired.add(movement[direction]);
      const table = buttonKeys[guns] ?? buttonKeys.classic;
      buttons.forEach((down, index) => { if (down) for (const key of table[index] ?? []) desired.add(key); });
      const velocity = lookVelocity(pad.axes[2], pad.axes[3], { ...settings, aiming: buttons[6] });
      const delta = velocity.map((v, i) => {
        this.remainder[i] += v * dt;
        const pixels = Math.trunc(this.remainder[i]); this.remainder[i] -= pixels; return pixels;
      });
      if (delta.some(Boolean)) events.push({ kind: 'mouse', dx: delta[0], dy: delta[1] });
    } else if (mode === 'menu' || mode === 'page') {
      const directions = new Set(this.directions);
      ['up', 'down', 'left', 'right'].forEach((d, i) => { if (buttons[12 + i]) directions.add(d); });
      for (const direction of this.repeat.step(directions, now)) {
        if (mode === 'page') actions.push(direction);
        else pulse({ up: 154, down: 155, left: 156, right: 157 }[direction]);
      }
      if (mode === 'page') { if (rising(0)) actions.push('accept'); if (rising(1)) actions.push('back'); }
      else { if (rising(0)) pulse(13); if (rising(1) || rising(9)) pulse(27); }
    }
    // Shared keys (stick + button, or two buttons) have a single down/up pair.
    for (const key of this.held) if (!desired.has(key)) events.push({ kind: 'key', key, down: false });
    for (const key of desired) if (!this.held.has(key)) events.push({ kind: 'key', key, down: true });
    this.held = desired; this.buttons = buttons;
    return { events, actions };
  }
}

// Browser adapter. No polling until gamepadconnected (or an already exposed pad
// at startup); the last disconnect cancels RAF. Nothing here imports co-op code.
let pageController;
const preferenceKey = 'bo1z-controller';
export function controllerSettings() {
  try { return JSON.parse(localStorage.getItem(preferenceKey)) ?? {}; } catch { return {}; }
}
export function controllerOptions(parent) {
  if (!parent || document.getElementById('controller-options')) return;
  const group = document.createElement('details'); group.id = 'controller-options';
  group.innerHTML = '<summary>Controller</summary><label>Look sensitivity <input id="controller-sensitivity" type="range" min="0.25" max="3" step="0.05"><output></output></label>'
    + '<label class="check"><input id="controller-invert" type="checkbox"> Invert Y</label>'
    + '<p>Left stick: move. Right stick: look. LT: aim / secondary fire. RT: fire.<br>A: jump. B: crouch. X: use / reload. Y: next weapon.<br>LB: tactical grenade. RB: frag (CS: select HE).<br>LS: sprint (CS: walk). RS: melee (CS: select knife).<br>D-pad: equipment / action slots (CS: up equipment, down claymore, left last gun, right inspect / other mode of a wonder weapon).<br>Start: pause. View: scores.<br>Menus: stick / D-pad to move, A to choose, B to go back.<br>Movement is digital. No aim assist. Uses the default keyboard binds.</p>';
  const sensitivity = group.querySelector('input[type=range]'), invert = group.querySelector('input[type=checkbox]');
  const saved = controllerSettings(); sensitivity.value = saved.sensitivity ?? 1; invert.checked = saved.invertY === true;
  const update = () => {
    group.querySelector('output').value = Number(sensitivity.value).toFixed(2);
    try { localStorage.setItem(preferenceKey, JSON.stringify({ sensitivity: Number(sensitivity.value), invertY: invert.checked })); } catch { /* optional */ }
    if (pageController) pageController.settings = { sensitivity: Number(sensitivity.value), invertY: invert.checked };
  };
  group.addEventListener('input', update); update(); parent.append(group);
}
function visibleControl(element) {
  const available = !element.disabled && element.getAttribute('aria-disabled') !== 'true'
    && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden';
  if (!available) return false;
  for (let details = element.parentElement?.closest('details:not([open])'); details; details = details.parentElement?.closest('details:not([open])')) {
    if (!details.querySelector(':scope > summary')?.contains(element)) return false;
  }
  const rect = element.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  // Covered controls (for example behind a lobby) must not receive page input.
  const top = document.elementFromPoint(x, y);
  return !top || element.contains(top);
}
export function navigateControllerPage(action) {
  const controls = [...document.querySelectorAll('button, a[href], input, select, summary')].filter(visibleControl);
  const focused = document.activeElement;
  document.body.classList.add('controller-navigation');
  if (action === 'back') {
    const details = focused?.closest('details[open]');
    if (details) { details.open = false; details.querySelector('summary').focus(); return; }
    const back = controls.find(e => e.id === 'choice-back' || /^back$/i.test(e.textContent.trim()));
    back?.click(); return;
  }
  if (action === 'accept') {
    if (!navigator.userActivation.hasBeenActive) { pageController?.notice('Press any key or click once to enable sound'); return; }
    (controls.includes(focused) ? focused : controls[0])?.click(); return;
  }
  if (focused?.matches('input[type=range]') && ['left', 'right'].includes(action)) {
    if (action === 'left') focused.stepDown(); else focused.stepUp();
    focused.dispatchEvent(new Event('input', { bubbles: true })); return;
  }
  const direction = ['left', 'up'].includes(action) ? -1 : 1, index = controls.indexOf(focused);
  controls[(index < 0 ? 0 : index + direction + controls.length) % controls.length]?.focus();
}
export function startController(hooks) {
  if (pageController) { if (hooks) pageController.hooks = hooks; return pageController; }
  const input = new PadInput();
  let raf = null, selected = null, known = new Set(), listening = false, noticeUntil = 0;
  const api = pageController = { hooks: hooks ?? {}, settings: controllerSettings(), active: false,
    notice(text) {
      let label = document.getElementById('controller-notice');
      if (!label) { label = document.createElement('p'); label.id = 'controller-notice'; label.setAttribute('role', 'status'); document.body.append(label); }
      label.textContent = text; label.hidden = false; noticeUntil = performance.now() + 6000;
    },
  };
  const pads = () => { try { return Array.from(navigator.getGamepads?.() ?? []).filter(p => p?.connected && p.mapping === 'standard'); } catch { return []; } };
  const send = events => api.hooks.send?.(events);
  function release() { send(input.release()); api.hooks.foreground?.(false); }
  function suspend() { release(); if (raf !== null) cancelAnimationFrame(raf); raf = null; }
  function focus() { if (!document.hidden && document.hasFocus() && pads().length && raf === null) raf = requestAnimationFrame(controllerFrame); }
  function visibility() { if (document.hidden) suspend(); else focus(); }
  function listeners(value) {
    if (listening === value) return; listening = value;
    const method = value ? 'addEventListener' : 'removeEventListener';
    window[method]('blur', suspend); window[method]('focus', focus); document[method]('visibilitychange', visibility);
  }
  function controllerFrame(now) {
    raf = null;
    const connected = pads();
    if (!connected.length) { release(); input.step(null, now); selected = null; api.active = false; api.hooks.update?.(false); known.clear(); listeners(false); return; }
    listeners(true);
    for (const p of connected) if (!known.has(p.index)) {
      known.add(p.index); api.notice(`Controller connected: ${p.id}`);
      if (!document.getElementById('controller-style')) {
        const style = document.createElement('style'); style.id = 'controller-style';
        style.textContent = '#controller-notice{position:fixed;top:12px;left:50%;transform:translateX(-50%);max-width:90vw;padding:8px 14px;background:#111e;color:#fff;font:16px sans-serif;z-index:10000;pointer-events:none}#controller-options p{font-size:14px;line-height:1.6}body.controller-navigation :focus{outline:2px solid white;outline-offset:3px}';
        document.head.append(style);
      }
    }
    for (const index of known) if (!connected.some(p => p.index === index)) known.delete(index);
    if (selected !== null && !connected.some(p => p.index === selected)) { release(); input.step(null, now); selected = null; }
    const pad = touchedPad(connected, selected); selected = pad?.index ?? null; api.active = Boolean(pad);
    if (document.hidden || !document.hasFocus()) { suspend(); return; }
    const mode = api.hooks.mode?.() ?? 'page';
    api.hooks.foreground?.(Boolean(pad && (mode === 'game' || mode === 'menu')));
    const result = input.step(pad, now, { ...api.settings, mode, guns: api.hooks.guns?.() ?? 'classic' });
    send(result.events); for (const action of result.actions) navigateControllerPage(action);
    api.hooks.update?.(api.active);
    const label = document.getElementById('controller-notice'); if (label && now >= noticeUntil) label.hidden = true;
    raf = requestAnimationFrame(controllerFrame);
  }
  function connected() { if (raf === null) raf = requestAnimationFrame(controllerFrame); }
  function disconnected() {
    // Release synchronously even if RAF is suspended in a background tab.
    if (!pads().some(p => p.index === selected)) { release(); input.step(null, performance.now()); selected = null; api.active = false; api.hooks.update?.(false); }
    if (!pads().length) { suspend(); known.clear(); listeners(false); } else connected();
  }
  window.addEventListener('gamepadconnected', connected); window.addEventListener('gamepaddisconnected', disconnected);
  if (pads().length) connected();
  return api;
}
