// lowfps: Graphics Quality (High / Low), one choice for the whole site. Shown in the GAME SETUP menu (choice-screen.js)
// and in Options on the map page (play.js); kept in localStorage bo1zm-quality, written only when the player picks it.
// Not picked: Low when the browser has no graphics card to draw with (a software renderer such as SwiftShader or WARP
// "Microsoft Basic Render Driver", or neither WebGPU nor WebGL2), else High. ?quality=low|high in the link overrides
// both (not saved). Nothing here is sent anywhere.
export const QUALITY_KEY = 'bo1zm-quality';
export const qualityValue = value => value === 'low' || value === 'high' ? value : null;

// The player's own choice (link, then saved), or null when they have not picked one.
export function pickedQuality(search = globalThis.location?.search ?? '') {
  const linked = qualityValue(new URLSearchParams(search).get('quality'));
  if (linked) return linked;
  try { return qualityValue(localStorage.getItem(QUALITY_KEY)); } catch { return null; }
}
// Save a pick and tell the other control on the same page (GAME SETUP menu <-> Options).
export function rememberQuality(quality) {
  if (!qualityValue(quality)) return;
  try { localStorage.setItem(QUALITY_KEY, quality); } catch { /* not kept: asked again next time */ }
  globalThis.dispatchEvent?.(new CustomEvent('bo1z-quality', { detail: quality }));
}

export const SOFTWARE_RENDERER = /swiftshader|basic render driver|llvmpipe|softpipe|software rasterizer/i;
function webglRenderer() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return null;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return null; }
}
async function webgpuAdapter() {
  if (!globalThis.navigator?.gpu) return null;
  try {
    const timeout = new Promise(resolve => setTimeout(() => resolve(undefined), 3000));
    return await Promise.race([navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }), timeout]);
  } catch { return null; }
}
// The default for a player who has not picked: { quality, reason }. Detected once per page.
export function detectQuality({ gl = webglRenderer(), adapter = webgpuAdapter() } = {}) {
  return Promise.resolve(adapter).then(adapter => {
    const info = adapter?.info ?? {};
    const gpuText = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' ');
    if (gl && SOFTWARE_RENDERER.test(gl)) return { quality: 'low', reason: 'software-webgl', renderer: gl };
    if (adapter && (adapter.isFallbackAdapter || info.isFallbackAdapter || SOFTWARE_RENDERER.test(gpuText)))
      return { quality: 'low', reason: 'software-webgpu', renderer: gpuText || 'fallback adapter' };
    if (!adapter && !gl) return { quality: 'low', reason: 'no-gpu', renderer: null };
    return { quality: 'high', reason: 'gpu', renderer: gl ?? gpuText };
  });
}
let detected = null;
export const autoQuality = () => detected ??= detectQuality();

// Shown (GAME SETUP menu, map page) when the default came out Low because there is no graphics card in use: the game
// then draws on the CPU at about 5-15 fps (WARP, Kino: 10 fps High, 15 fps Low on a fast 24-thread CPU). Usually the
// browser's own switch is off or the browser blocked an old driver, so say how to turn it back on.
export function gpuWarning(auto, userAgent = globalThis.navigator?.userAgent ?? '') {
  if (!auto || auto.quality !== 'low') return null;
  const fix = /Firefox\//.test(userAgent)
    ? 'To fix it in Firefox: Settings, General, Performance: untick "Use recommended performance settings", tick "Use hardware acceleration when available" and restart Firefox.'
    : 'To fix it: open your browser\'s Settings, then System, turn on "Use graphics acceleration when available" and relaunch the browser.';
  return `Your browser is not using a graphics card, so the game will run very slowly. ${fix} If it is already on, update your graphics driver.`;
}
