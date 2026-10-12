# Together — Art Brief and Asset Slots

> **2026-10-12:** a **free pixel-art test** is next. See §7. Sections 1–6 describe the painted vector look, which remains the default until the test is judged.

How to make art that drops into the game. Every visual has a **slot**. An image file listed for a slot in `public/assets/manifest.json` replaces the code-drawn placeholder; remove it and the placeholder returns. Art can therefore be replaced one piece at a time.

---

## 1. Style

**Soft painted vector, golden hour, side view.** The current placeholders define the look; replace them with richer versions of the same thing.

| Rule | Detail |
|---|---|
| View | Strict side view, flat profile, no perspective. Characters and vehicles face **right**. |
| Light | Warm key light from the **upper left**. Shadows are soft and cool (violet-grey, never black). A thin warm rim on upper-left edges. |
| Shapes | Rounded, chunky, friendly. Big readable silhouettes; small details only where they read at game size. |
| Edges | No black outlines. Edges are a darker shade of the same hue, or no line at all. |
| Texture | Light paper or gouache grain is welcome. No photo textures. |
| Colour | Muted, warm, earthy. Saturated colour only for small accents (flowers, the teal stripe, character clothes). |
| Avoid | Photorealism, text, logos, watermarks, harsh contrast, pure black, pure white. |

### Palette (from the current game)

| Use | Hex |
|---|---|
| Sky top / middle / horizon | `#9fc9d8` `#f4dcae` `#f7b984` |
| Distant hills (lavender, sage) | `#c6a6b4` `#8ea98a` |
| Forest greens (far → near) | `#7c9a7c` `#58805c` `#4a7352` `#3f6b4a` |
| Grass (dark, mid, light) | `#4f7d36` `#76a54b` `#a9d062` |
| Soil strata (top → deep) | `#8f603d` `#7d5336` `#6c472f` `#5c3c29` `#4d3224` |
| Rock | `#7b7682` `#5b5662` |
| Wood (dark, mid, light) | `#a6764c` `#c99766` `#e0b483` |
| Camper body / stripe | `#f1e6cf` `#3f8f88` |
| Traveller 1 (shirt, trousers, hat, pack) | `#e07a5f` `#4b5d7a` `#f2b84b` `#7a8f4e` |
| Traveller 2 | `#3d8b8b` `#6b4f3a` `#d8574a` `#c28a45` |
| Skin | `#f0c4a0` |

---

## 2. File specs

- **PNG with a transparent background**, sRGB. WebP also works.
- **Scale: 128 pixels per metre** unless a slot says otherwise. A 3 m board is 384 px long.
- Lowercase file names with dashes, e.g. `pine-2.png`. Put files in `public/assets/`.
- Make art at the stated size or larger. Larger is fine if you set `ppm` to match: art drawn at 256 px per metre needs `"ppm": 256`.
- Background strips must **tile seamlessly left to right**.

---

## 3. Manifest

`public/assets/manifest.json`:

```json
{
  "ppm": 128,
  "slots": {
    "camper.wheel": { "file": "wheel.png", "anchor": [0.5, 0.5] },
    "tree.pine": [
      { "file": "pine-1.png", "anchor": [0.5, 1], "height": 8 },
      { "file": "pine-2.png", "anchor": [0.5, 1], "height": 9 }
    ]
  }
}
```

| Field | Meaning |
|---|---|
| `file` | Image in `public/assets/`. |
| `anchor` | The point in the image that sits at the slot's origin, as fractions of width and height (0,0 = top-left, 1,1 = bottom-right). |
| `at` | Offset of that point from the slot's origin, in metres (x right, y **up**). |
| `ppm` | Pixels per metre for this image (default: the manifest's). |
| `height` / `length` | The size in metres the image was drawn at. The game scales trees to each tree's height, and logs and boards to their length. |
| A list of entries | Variants. Each tree, prop or board picks one. |

The manifest is never cached, so refreshing the page shows changes.

---

## 4. Slots

Coordinates are in metres with **y up**. "Origin" is where the game places the slot.

### Camper (three layers)

The camper is a cut-away dollhouse. Travellers walk *between* the two body layers, so the frame passes in front of them.

| Slot | Size at 128 px/m | Anchor / at | Contents |
|---|---|---|---|
| `camper.back` | 896 × 436 px (7.0 × 3.4 m) | `[0.5, 0.5]`, at `[0.1, 0.7]` | Interior back wall and furniture: wood panelling, bunk with blanket, kitchen counter and shelf, window with curtains, driver's seat, dashboard and steering wheel, windshield glass, floor. |
| `camper.front` | Same canvas and placement | Same | Only what passes in front of the travellers: outer frame, roof, roof rack, pillars, underbody skirt and stripe, bumper, headlight, taillight, ladder at the front. **Everything else transparent.** |
| `camper.wheel` | 184 × 184 px (radius 0.72 m) | `[0.5, 0.5]` | One tyre with hub. It rotates, so keep it round and symmetric. |

**Layout guide** for the 896 × 436 canvas, in pixels from the top-left. The canvas spans x −3.4…3.6 m and y −1.0…2.4 m around the chassis origin.

| Feature | Position |
|---|---|
| Chassis origin (0, 0) | (435, 307) |
| Floor (where feet stand) | y = 352 |
| Roof top | y ≈ 70 |
| Hull bottom | y ≈ 386 |
| Rear door centre | x = 122 |
| Driver's seat | x = 685 |
| Nose (front tip) | x ≈ 864 |
| Wheel centres | (147, 461) and (723, 461), just below the canvas; the wheels are separate sprites |

### Trees, logs, boards

| Slot | Size | Anchor | Notes |
|---|---|---|---|
| `tree.pine` (list) | e.g. 8 m tall → 1024 px | `[0.5, 1]` at the trunk base | Set `height`. The game scales each tree to 5–10 m. Make 3–4 variants. |
| `tree.oak` (list) | e.g. 6.5 m tall | `[0.5, 1]` | As above. |
| `tree.stump` | ~0.8 × 0.5 m | `[0.5, 1]` | Cut face visible on top. |
| `log` | 4 m × 0.42 m → 512 × 54 px | `[0.5, 0.5]`, `"length": 4` | Bark along the length, cut rings at both ends. Stretched to each log's length. |
| `board` (list) | 3 m × 0.12 m → 384 × 16 px | `[0.5, 0.5]`, `"length": 3` | A plank seen edge-on. Stretched to each board's length; stress colouring tints it toward red. |

### Travellers (separate parts)

Two characters: `traveller0` and `traveller1`. Each part pivots where noted. The game animates by rotating the limbs.

| Slot | Size | Anchor | `at` | Notes |
|---|---|---|---|---|
| `traveller0.head` | 0.5 m → 64 px | `[0.5, 0.5]` | `[0.02, 1.36]` | Facing right: beanie, headlamp, one visible eye. |
| `traveller0.torso` | 0.62 × 0.66 m → 80 × 84 px | `[0.5, 0.5]` | `[-0.06, 0.83]` | Body with backpack (backpack on the left side). |
| `traveller0.arm` | 0.12 × 0.48 m → 16 × 62 px | `[0.5, 0]` (shoulder at top) | none | Hangs straight down. The game shades the far arm. |
| `traveller0.leg` | 0.15 × 0.55 m → 20 × 70 px | `[0.5, 0]` (hip at top) | none | Includes the boot. |

Tools in hand are still drawn in code; slots for them can be added.

### Background and props

| Slot | Size | Anchor | Notes |
|---|---|---|---|
| `bg.peaks`, `bg.far`, `bg.mid`, `bg.farForest`, `bg.near` | 2048 × 512 px suggested, **seamless left–right** | `[0, 1]` (bottom-left) | Distant layers use a low `ppm` (20–40) because they cover many metres. Haze is added by the game, so paint them clear. |
| `prop.flower`, `prop.mushroom`, `prop.rock` (lists) | 0.1–0.4 m | `[0.5, 1]` | Small decorations on undisturbed grass. |

---

## 5. The art test (first step)

Goal: find out whether generated art reaches the look we want before committing further. Make **one set**, drop it in, play, judge.

1. `camper.back`, `camper.front`, `camper.wheel`
2. `tree.pine` (2 variants) and `tree.oak` (1)
3. `traveller0` parts

### Prompts

Use the same **style block** in every prompt. Most generators can't make true transparency: ask for a plain flat background, then remove it.

> **Style block:** 2D game asset, strict side view, orthographic, flat profile facing right, soft painted vector illustration with light gouache texture, rounded chunky shapes, warm golden-hour light from the upper left, soft cool violet shadows, muted earthy palette of sage green, warm browns, cream and teal accents, no outlines, no text, no logo, centred, isolated on a plain flat light-grey background.

| Asset | Subject prompt (append the style block) |
|---|---|
| Camper reference | A boxy vintage off-road expedition camper truck, cream body with one teal stripe, big knobby tyres, roof rack, small ladder at the front, raked nose, cut-away cross-section showing a cosy wooden interior: bunk with a blue blanket at the back, small kitchen counter and shelf, window with orange curtains, driver's seat and steering wheel at the front |
| Wheel | A single big knobby off-road tyre with a cream hub and five bolts, perfectly circular, seen straight on from the side |
| Pine | A tall slender pine tree with layered drooping boughs and a straight brown trunk, full tree visible from roots to tip |
| Oak | A broad leafy oak tree with a thick trunk and rounded clustered canopy, full tree visible |
| Traveller sheet | Character sheet of a small rounded cheerful hiker, side profile facing right, orange shirt, blue trousers, brown boots, yellow beanie with a small headlamp, green backpack. Show the full figure, plus separate head, torso with backpack, one arm and one leg laid out apart |

### Consistency

- Generate the **camper reference first**. Once one image has the right look, use it as the style or image reference for everything else. Keep the same seed where the tool allows.
- Generate several, pick the best, and don't mix images from different runs in one asset.
- Animated parts (the traveller) are the hardest. Expect to separate and tidy them by hand.

### Clean-up checklist

1. Remove the background (alpha transparency) and crop.
2. Resize to the slot size at 128 px/m (or set `ppm`).
3. Check: facing right, light from the upper left, colours near the palette.
4. For the camper: split the cutaway into `camper.back` (everything) and `camper.front` (frame only), on the same canvas.
5. Save as PNG into `public/assets/` and add the slot to `manifest.json`.

### Getting files into the game

- **Locally:** put files in `public/assets/`, edit the manifest, refresh the page. No rebuild is needed.
- **Or send them to me** (commit them to the repo, or share them) and I'll cut, size and wire them up.

---

## 6. Using generated art

- If the game is ever sold on Steam, AI-generated content must be disclosed on the store page.
- Each image generator has its own terms of use for commercial use. Check them before shipping.

---

## 7. Pixel art test, free tools only (2026-10-12)

**Goal:** find out whether pixel art beats the painted look, **without paying for anything**. Compare the **same scene in both styles** side by side. The decision is the players'; this section only sets up a fair comparison. (SpriteCook was considered and dropped: it isn't free.)

The test has two stages. Stage 1 needs no new art at all and answers the main question. Stage 2 happens only if pixel art wins.

### 7.1 Ground rules (both stages)
- **Strict side view, facing right,** as in §1. Light from the upper left.
- **Pixel density: 16 px per metre** for everything in the play plane. A traveller is about 28 px tall, the camper body about 112 px long. Background layers use their own lower density.
- **Palette:** a fixed palette built from §1 (warm, earthy, sage, cream and teal camper), about 32 colours, with warm-to-cool shading ramps and no pure black. Outlines may be dark brown (`#3a2a20`), selective or absent; never black. Lospec (free) has palettes to borrow from.
- **Mood:** cozy, warm, golden hour. References: *Stardew Valley*, *Eastward* (cozy pixel); *Noita*, *Terraria* (pixel art with fully destructible terrain).
- **No** perspective, text, logos, or large dithered areas.

### 7.2 Stage 1: pixelate what we have, plus hand-written sprites (Claude, automatic, free)

**Status: built 2026-10-12.** Try it: tick *Pixel art (test)* on the menu, or add `?art=pixel` to the address. **P** toggles the palette snap. `?seed=1234` with *Practise alone* repeats a world, for side-by-side comparisons.
- **Code:**
  - `client/pixel/mode.js`: the switch and the upscale factor, which is a whole number: round(window height ÷ 260), at least 2.
  - `client/pixel/sprites.js`: the sprites, written as pixel data and drawing routines. Also the palette.
  - `client/pixel/textures.js`: turns them into Pixi textures with nearest-neighbour filtering.
  - `client/pixel/paletteFilter.js`: the palette snap shader (up to 96 colours).
- **How it works:**
  - In pixel mode, Pixi renders at 1/scale resolution with antialiasing off, and CSS `image-rendering: pixelated` scales the canvas back up.
  - The camera is fixed at 16 px/m, dropping to 8 px/m when the travellers are far apart.
  - The world and the parallax layers are snapped to whole low-res pixels.
  - Travellers and the collie use frame animation; the tool stays in the hand.
- **Preview:** `node scripts/pixel-preview.mjs out.png 8` writes an enlarged sheet of every frame, without running the game.
- **Not yet pixel sprites:** the other animals, trees, camper body and terrain are still the code-drawn art, pixelated.

Stage 1 is all code; no image generation is needed.

1. **Switch styles:** `?art=pixel` (and a menu toggle) turns on pixel mode. The painted look stays the default.
2. **Low-resolution pipeline** (this also fixes the flicker seen in earlier attempts):
   - Render the world into a `RenderTexture` at screen size ÷ an integer scale, chosen so about 16–18 m of world fit vertically.
   - Snap the camera to whole low-res pixels.
   - Draw that texture to the screen scaled by the integer, with nearest-neighbour filtering.
   - The HUD (HTML) stays sharp.
   - The existing code-drawn art (terrain, camper, trees, background) then becomes "pixelated vector": on a true grid, though not true hand-placed pixel art. Graphics are drawn without antialiasing in this mode.
   - The rotating camper and the marching-squares terrain land on the same grid.
3. **Palette snap (optional):** a final pass maps the low-res image to the fixed palette (§7.1), either as a shader or a lookup table. Try it on and off.
4. **Hand-written sprites** for the pieces that matter most at small size. These are written pixel by pixel as palette-indexed data in code, with frame animation:

   | Sprite | Size (px) | Frames |
   |---|---|---|
   | Traveller 0 (orange shirt, blue trousers, yellow beanie with headlamp, green backpack) | ~16 × 30 | idle 2, walk 6, work or dig 4 |
   | Traveller 1 (teal shirt, brown trousers, red beanie, tan backpack) | same; recolour of traveller 0 | same |
   | Border collie (black and white, white blaze, chest and paws) | ~18 × 12 | idle 2, run 4, sit 1 |
   | Camper wheel | 23 × 23 | 1 (it rotates) |

   In pixel mode, characters use these frames instead of the limb-rotation rig. Everything else stays pixelated vector in stage 1.
5. **Comparison:**
   - Pick a fixed seed and location (the start camp, and the first ravine), and screenshot it in both styles at the same window size.
   - Play a few minutes in each.
   - Note frame rate on the laptops, since pixel mode should be lighter.

### 7.3 Stage 2: real pixel assets, only if pixel wins

**Sources, all free:**
- **AI image generators with free tiers:** Microsoft Bing Image Creator / Designer, Google Gemini, the ChatGPT free tier. Daily limits and terms change, so check them.
  - Their output is "fake pixel art" (uneven pixel sizes, off-grid, too many colours), so it goes through the cleanup script (below).
  - Use them for trees, props and background strips. Consistency across images is weak, so animated characters stay hand-written.
  - Add to every prompt: *"pixel art, 2D game asset, strict side view facing right, warm golden-hour light from the upper left, cozy muted earthy palette, isolated on a plain flat magenta background"*. Magenta makes background removal easy.
- **Pixel editors** for drawing or touching up by hand: **Pixelorama** (free, open source, browser or desktop, has animation), **Piskel** (free, browser), **LibreSprite** (free fork of Aseprite).
- **Ready-made packs:** **Kenney.nl** (public-domain licence), OpenGameArt and itch.io (check each licence). Good for quick placeholders, though they won't match our camper and animals.
- **Local Stable Diffusion** with a pixel-art add-on is free but needs a decent graphics card; probably not our laptops.

**Cleanup script (Claude writes it; `scripts/pixelize.py`, Python with Pillow).** It turns raw images into game-ready sprites:
1. Remove the flat background (magenta or another chosen colour) to transparency.
2. Find the image's real pixel grid, or take a target size, and shrink to true pixels (nearest or majority colour per cell).
3. Map to the fixed palette (§7.1).
4. Crop, and slice sprite sheets into frames.
5. Write PNGs into `public/assets/pixel/` and print a manifest entry for each.

**Asset list and sizes (16 px/m), in priority order:**

| # | Asset | Size (px) | Notes |
|---|---|---|---|
| 1 | Camper, cut-away side view | 112 × 54 canvas (7.0 × 3.4 m) | Split into `camper.back` (everything) and `camper.front` (outer frame only) on the same canvas, as in §4. Layout at 16 px/m (from the top-left): chassis origin (54, 38); floor y = 44; roof top y ≈ 9; rear door x = 15; driver's seat x = 86; nose tip x ≈ 108; wheel centres (18, 58) and (90, 58), just below the canvas. Likely hand-made or heavily touched up: it's the hero asset. |
| 2 | Pine ×2, oak ×1, stump | pine ~128 tall, oak ~104 tall | Base at the bottom centre. AI plus cleanup works well here. |
| 3 | Terrain textures, seamless | 32 × 32 each | Grass edge strip (runs along the ground surface), soil strata ×3, rock. Must tile both ways. |
| 4 | Log, board | log 64 × 7 (4 m), board 48 × 3 (3 m) | Edge-on views, stretched to length. |
| 5 | Background strips, seamless left–right | e.g. 512 × 128 each | Far peaks, mid hills, far forest, near forest. Paint them clear: the game adds haze. |
| 6 | Small animals: rabbit, fox, chipmunk, songbird, deer, hawk, moose, bear | idle loops | Hand-written or touched up, like the characters. |

**Code for stage 2:**
- `public/assets/manifest-pixel.json` with `"ppm": 16`, loaded in pixel mode. Same slot names as §4.
- Sprite-sheet slots, for example `"traveller0.walk": { "file": "pixel/traveller0-walk.png", "frames": 6, "fps": 10, "anchor": [0.5, 1] }`.
- Textured terrain: fill each strata band (`soil0`…`soil4`, `rock`) with its tiling texture instead of a flat colour. Draw the grass edge strip along the surface contour.
- Load pixel textures with `scaleMode: 'nearest'`.

### 7.4 What to judge
- **Charm:** does it feel cozy and warm?
- **Readability:** soil, rock and grass, the camper interior, small animals.
- **Consistency across assets.**
- **Motion:** the camper rotating, the walk cycles.
- **Performance on the laptops.**
- **Practicality:** how much hand work the art needed.

### 7.5 Prompt for the session that runs stage 1
> Read `docs/DESIGN.md` (the "Start here" note, §3c and §11) and `docs/ART.md` §7. Do **stage 1** of the pixel art test (§7.2) in the side-view game: the `?art=pixel` switch, the low-resolution pipeline, the optional palette snap, and hand-written pixel sprites for both travellers, the border collie and the wheel. Then show me side-by-side screenshots of the same scene in the painted and pixel styles, and how heavy each feels. Don't build forks yet, and don't use paid tools.
