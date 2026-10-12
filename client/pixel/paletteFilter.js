import { Filter, GlProgram, defaultFilterVert } from 'pixi.js';

// Optional final pass: every pixel snaps to the nearest colour in a fixed
// palette, so everything on screen shares one set of colours.
const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec3 uPalette[96];
uniform float uCount;
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  if (c.a <= 0.0) { finalColor = c; return; }
  vec3 rgb = c.rgb / c.a;
  vec3 best = rgb; float bd = 1e9;
  for (int i = 0; i < 96; i++) {
    if (float(i) >= uCount) break;
    vec3 d = (uPalette[i] - rgb) * vec3(0.40, 0.48, 0.34);
    float dist = dot(d, d);
    if (dist < bd) { bd = dist; best = uPalette[i]; }
  }
  finalColor = vec4(best * c.a, c.a);
}`;

export function paletteFilter(colors) {
  const list = colors.slice(0, 96);
  const data = new Float32Array(96 * 3);
  list.forEach((c, i) => { data[i * 3] = ((c >> 16) & 255) / 255; data[i * 3 + 1] = ((c >> 8) & 255) / 255; data[i * 3 + 2] = (c & 255) / 255; });
  return new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'palette-snap' }),
    resources: { paletteUniforms: { uPalette: { value: data, type: 'vec3<f32>', size: 96 }, uCount: { value: list.length, type: 'f32' } } },
  });
}
