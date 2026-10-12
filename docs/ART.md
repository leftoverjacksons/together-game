# Together — Art Brief and Asset Slots

> **2026-10-12:** a **pixel art test with SpriteCook** is next. See §7. Sections 1–6 describe the painted vector look, which remains the default until the test is judged.

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

## 7. Pixel art test with SpriteCook (2026-10-12)

**Goal:** find out whether generated pixel art beats the painted look. Make one small, consistent set, render the game in a proper pixel pipeline, and compare the **same scene in both styles** side by side. The decision is the players'; this section only sets up a fair comparison.

**Tool:** [SpriteCook](https://www.spritecook.ai/). It generates pixel-art sprites, sprite sheets, short animation loops (idle, walk), tilesets and seamless textures, and exports transparent PNGs. "Themes" and style references keep a set consistent. It has a Claude Code plugin (MCP server), which runs only in a **local** Claude Code session, so this test happens in a local session. The free plan is 40 credits a month, and the site says generated assets may be used commercially. Read the terms before relying on that.

### 7.1 Ground rules
- **Strict side view, facing right,** as in §1. Light from the upper left.
- **Pixel density: 16 px per metre** for everything in the play plane. A traveller is about 28 px tall, the camper body about 112 px long. Background layers use their own lower density.
- **Palette:** start from the §1 palette (warm, earthy, sage, cream and teal camper). Shade with a warm-to-cool ramp, never pure black. Outlines may be dark brown (`#3a2a20`), selective or absent. No black outlines.
- **Mood:** cozy, warm, golden hour. References: *Stardew Valley*, *Eastward* (cozy pixel); *Noita*, *Terraria* (pixel art with fully destructible terrain).
- **No** perspective, text, logos, dithering noise across large areas, or photo textures.
- **Credits are limited.** Generate in the order below, check results after each step, and stop when credits run low. A small, consistent set beats a big, mixed one.

### 7.2 Order and sizes (16 px/m)

| # | Asset | Size (px) | Notes |
|---|---|---|---|
| 1 | **Camper (hero)**, side view with cut-away interior | 112 × 54 canvas (7.0 × 3.4 m) | Boxy vintage off-road expedition camper, cream body, one teal stripe, roof rack, ladder at the front, raked nose. Interior: bunk with blue blanket at the back, small kitchen counter, window with orange curtains, driver's seat and wheel at the front. **Save as the SpriteCook theme or style reference** for everything after it. Then split it into `camper.back` (everything) and `camper.front` (outer frame only: roof, pillars, skirt, stripe, bumper, lights, ladder; the rest transparent) on the same canvas. |
| 2 | Wheel | 23 × 23 | Big knobby tyre, cream hub, perfectly round (it rotates). |
| 3 | Traveller 0: idle and walk loop | ~16 × 30 frames | Small rounded cheerful hiker, orange shirt, blue trousers, brown boots, yellow beanie with a small headlamp, green backpack. Walk loop 6–8 frames, idle 2–4. Facing right. |
| 4 | Traveller 1 | same | Same body, teal shirt, brown trousers, red beanie, tan backpack (recolour of #3 if the tool allows). |
| 5 | Border collie: idle, run, sit | ~18 × 12 frames | Black-and-white border collie, white blaze, chest and paws. Friendly. |
| 6 | Pine ×2, oak ×1, stump | pine ~128 tall, oak ~104 tall | Full tree, base at the bottom centre. |
| 7 | Terrain textures, seamless | 32 × 32 each | Grass-topped soil edge (a strip that runs along the ground surface), soil strata ×3 (light, mid, deep brown), rock. These must tile in both directions. |
| 8 | Log, board | log 64 × 7 (4 m), board 48 × 3 (3 m) | Edge-on views; stretched to length in game. |
| 9 | Background strips, seamless left–right | e.g. 512 × 128 each | Far peaks, mid hills, far forest, near forest. Paint them clear: the game adds haze. |
| 10 | (Optional) small animals: rabbit, fox, chipmunk, songbird, deer, hawk | idle loops | Only if credits remain. |

The camper layout at 16 px/m (pixels from the top-left of the 112 × 54 canvas):
- chassis origin (54, 38)
- floor where feet stand y = 44
- roof top y ≈ 9
- rear door centre x = 15
- driver's seat x = 86
- nose tip x ≈ 108
- wheel centres (18, 58) and (90, 58), just below the canvas

### 7.3 Where files go
- Put images in **`public/assets/pixel/`**, named like `camper-back.png`, `traveller0-walk.png`, `soil-1.png`.
- List them in a **separate manifest, `public/assets/manifest-pixel.json`**, with `"ppm": 16`, so the painted look stays the default and both can be compared. The slot names are the same as §4. Sprite sheets need new fields (below).

### 7.4 Code needed for the test (small, in the side-view game; PixiJS)
1. **Switch styles:** `?art=pixel` (and a menu toggle) loads `manifest-pixel.json` instead of `manifest.json` (`client/assets.js`).
2. **Low-resolution pipeline** (this fixes the old flicker):
   - Render the world into a `RenderTexture` at screen size ÷ an integer scale, chosen so about 16–18 m of world fit vertically.
   - Snap the camera to whole low-res pixels.
   - Draw that texture to the screen scaled by the integer, with nearest-neighbour filtering.
   - Load pixel textures with `scaleMode: 'nearest'`.
   - The HUD (HTML) stays sharp.
   - The rotating camper and the marching-squares terrain then land on the same pixel grid.
3. **Sprite-sheet slots:** for example `"traveller0.walk": { "file": "pixel/traveller0-walk.png", "frames": 8, "fps": 10, "anchor": [0.5, 1] }`, plus `idle`. In pixel mode, characters use frame animation instead of the limb-rotation rig.
4. **Textured terrain:** fill each strata band (`soil0`…`soil4`, `rock`) with its tiling texture instead of a flat colour (Pixi v8 Graphics can fill with a texture). Draw the grass edge strip along the surface contour.
5. **Comparison:**
   - Pick a fixed seed and location (the start camp, and the first ravine), and screenshot it in both styles at the same window size.
   - Play a few minutes in each.
   - Note frame rate on the laptops, since pixel mode should be lighter.

### 7.5 What to judge
- **Charm:** does it feel cozy and warm?
- **Readability:** soil, rock and grass, the camper interior, small animals.
- **Consistency across assets.**
- **Motion:** the camper rotating, the walk cycles.
- **Performance on the laptops.**
- **Practicality:** how much hand clean-up the generated art needed.

### 7.6 Prompt for the session that runs this test
> Read `docs/DESIGN.md` (the "Start here" note, §3c and §11) and `docs/ART.md` §7. Using the SpriteCook plugin, generate the pixel art test set in the order in §7.2. Make the camper first and use it as the theme or style reference for the rest, and watch the credits. Save the files to `public/assets/pixel/` with `manifest-pixel.json`. Then implement §7.4 (art switch, low-resolution pipeline, sprite-sheet slots, textured terrain) in the side-view game. Show me side-by-side screenshots of the same scene in the painted and pixel styles. Don't build forks yet.
