// /bo1zm only: sets text in the game's own menu fonts (art/menu-font.webp + menu-font.js, made by
// tools/web/mapselect/mkmenu.py from the game's font assets). The real text stays in the element for screen readers,
// tests and as the fallback (a condensed system font, choices.css) while the sprite loads or if it cannot load.
// The host element's font-size is the height of a capital letter.
import { SPRITE, FONTS } from './menu-font.js';

const root = document.documentElement;
const SUBSTITUTE = { '·': '/', '’': '\'', '‘': '\'', '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ' };
const LINE = 1.5; // line pitch of wrapped text, in capital heights (the game's description text: 29 px lines, 19 px capitals)
function start() {
  if (root.dataset.gameText) return;
  root.dataset.gameText = 'wait';
  const url = new URL(SPRITE.file, import.meta.url).href, style = document.createElement('style'), image = new Image();
  style.dataset.gameText = '';
  style.textContent = `.gt i { background-image: url("${url}"); }\n` + Object.entries(FONTS).map(([name, font]) => {
    const em = value => +(value / font.cap).toFixed(4) + 'em';
    return `.gt-${name} { column-gap: ${em(font.glyphs[32][3])}; }
.gt-${name} .gw { margin-block: ${em((LINE * font.cap - font.height) / 2)}; }
.gt-${name} i { height: ${em(font.height)}; background-size: ${em(SPRITE.width)} ${em(SPRITE.height)}; }`;
  }).join('\n');
  document.head.append(style);
  const settle = value => { if (root.dataset.gameText === 'wait') root.dataset.gameText = value; };
  image.onload = () => settle('on'); image.onerror = () => settle('off');
  setTimeout(() => settle('off'), 4000); // a slow sprite must not keep the menu unreadable
  image.src = url;
}
// font: 'title' (the "MISSION SELECT" font), 'list' (the list rows) or 'text' (descriptions). upper: set in capitals,
// as the game's titles and rows are (the real text keeps its case).
export function gameText(element, text, { font = 'list', upper = font !== 'text' } = {}) {
  start(); text = String(text ?? '');
  const key = font + (upper ? '^' : ' ') + text;
  if (element.dataset.gtKey === key && element.querySelector(':scope > .gt')) return element;
  element.dataset.gtKey = key; element.dataset.gt = font;
  const real = document.createElement('span'), run = document.createElement('span'), metrics = FONTS[font], cap = metrics.cap;
  real.className = 'gt-real'; real.textContent = text;
  run.className = 'gt gt-' + font; run.setAttribute('aria-hidden', 'true');
  const em = value => +(value / cap).toFixed(4) + 'em';
  const shown = [...(upper ? text.toUpperCase() : text)].map(c => SUBSTITUTE[c] ?? c).join('');
  for (const word of shown.split(/\s+/).filter(Boolean)) {
    const box = document.createElement('span'); box.className = 'gw';
    for (const char of word) {
      const glyph = metrics.glyphs[char.codePointAt(0)] ?? metrics.glyphs[63]; // '?'
      const [x, y, width, advance, left] = glyph, cell = document.createElement('i');
      cell.style.cssText = `width:${em(width)};background-position:${em(-x)} ${em(-y)};`
        + (left ? `margin-left:${em(left)};` : '') + (advance - width - left ? `margin-right:${em(advance - width - left)};` : '');
      box.append(cell);
    }
    run.append(box);
  }
  element.replaceChildren(real, run);
  return element;
}
