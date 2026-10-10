import { Graphics } from 'pixi.js';
import { artSprite } from '../assets.js';

// Hand tools in metres, held at the origin with the business end toward -y
// (hanging from the hand). Art slots tool.<kind> replace them.
const HANDLE = 0x8a6440, STEEL = 0x9aa3a8, STEEL_LIGHT = 0xd7dde0;

export function toolGraphic(kind) {
  const art = artSprite('tool.' + kind);
  if (art) return art;
  const g = new Graphics();
  switch (kind) {
    case 'shovel':
      g.rect(-0.025, -0.35, 0.05, 0.66).fill(HANDLE).rect(-0.07, 0.28, 0.14, 0.05).fill(0x6e4f33)
        .poly([-0.1, -0.35, 0.1, -0.35, 0.08, -0.55, 0, -0.6, -0.08, -0.55]).fill(STEEL);
      break;
    case 'axe':
      g.rect(-0.025, -0.45, 0.05, 0.6).fill(HANDLE)
        .poly([0.02, -0.45, 0.2, -0.52, 0.22, -0.32, 0.02, -0.36]).fill(STEEL).poly([0.18, -0.52, 0.22, -0.52, 0.24, -0.32, 0.2, -0.32]).fill(STEEL_LIGHT);
      break;
    case 'saw':
      g.roundRect(-0.06, -0.08, 0.12, 0.16, 0.04).fill(0xa8523a).poly([-0.04, -0.08, 0.04, -0.08, 0.06, -0.62, -0.02, -0.62]).fill(STEEL);
      for (let y = -0.12; y > -0.6; y -= 0.06) g.poly([-0.04 - (y + 0.08) * 0.04, y, -0.08 - (y + 0.08) * 0.04, y - 0.03, -0.04 - (y + 0.08) * 0.04, y - 0.06]);
      g.fill(STEEL);
      break;
    case 'hammer':
      g.rect(-0.022, -0.36, 0.044, 0.44).fill(HANDLE).roundRect(-0.12, -0.44, 0.24, 0.1, 0.02).fill(0x6f777c);
      break;
    case 'pickaxe':
      g.rect(-0.025, -0.5, 0.05, 0.64).fill(HANDLE)
        .poly([-0.3, -0.42, -0.02, -0.5, 0.02, -0.5, 0.3, -0.42, 0.3, -0.45, 0.02, -0.56, -0.02, -0.56, -0.3, -0.45]).fill(STEEL);
      break;
    case 'jack':
      g.roundRect(-0.12, -0.5, 0.24, 0.08, 0.02).fill(0xc2563f)
        .poly([-0.1, -0.42, 0.1, -0.42, 0.04, -0.1, -0.04, -0.1]).fill(0xd8643f)
        .roundRect(-0.05, -0.1, 0.1, 0.06, 0.02).fill(0x6f777c)
        .rect(-0.015, -0.04, 0.03, 0.16).fill(0x6f777c);
      break;
  }
  return g;
}
