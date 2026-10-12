// Pixel-art test mode (docs/ART.md §7.2). Chosen before the game starts:
// ?art=pixel, or the menu checkbox. The painted look is the default.
export const PIXEL = { on: false, scale: 1, snap: false };

export function choosePixelMode(on) {
  PIXEL.on = !!on;
  // Whole-number upscale, picked so roughly 16–18 m of world fit vertically at 16 px/m.
  PIXEL.scale = Math.max(2, Math.round((window.innerHeight || 720) / 260));
}
