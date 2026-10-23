// Size once before OffscreenCanvas transfer. Resize only the CSS rectangle:
// the engine keeps its render targets and projection at this fixed resolution.
// lowfps: renderScale (< 1, Graphics Quality Low) draws fewer pixels per axis; the browser stretches the canvas to the
// same on-screen rectangle (CSS), so the HUD, menus and cursor mapping (input.js: buffer size / CSS size) stay right.
// Fixed for the life of the engine: a change needs a new game start (reload).
export const LOW_RENDER_SCALE = 0.75;
export function renderScaleFor(quality, search = location.search) {
  // ?renderScale=0.5..1 in the link overrides it (A/B tests), for either quality.
  const linked = Number(new URLSearchParams(search).get('renderScale'));
  if (linked >= 0.5 && linked <= 1) return linked;
  return quality === 'low' ? LOW_RENDER_SCALE : 1;
}
export function sizeGameCanvas(canvas, renderScale = 1) {
  const width = Math.max(1, innerWidth), height = Math.max(1, innerHeight);
  const density = Math.min(devicePixelRatio || 1, 1920 / width, 1440 / height);
  const scale = Math.max(density * renderScale, 800 / width, 600 / height);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const buffer = { width: canvas.width, height: canvas.height, devicePixelRatio, renderScale };
  function fit() {
    const scale = Math.min(innerWidth / buffer.width, innerHeight / buffer.height);
    canvas.style.width = `${buffer.width * scale}px`;
    canvas.style.height = `${buffer.height * scale}px`;
  }
  fit();
  window.addEventListener('resize', fit);
  return { ...buffer, dispose: () => window.removeEventListener('resize', fit) };
}
