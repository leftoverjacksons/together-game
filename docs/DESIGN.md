# Together — Design Document

Living document. Update it whenever a decision is made or reversed.
Status markers: **[DECIDED]**, **[LEANING]** (provisional, not yet confirmed), **[OPEN]** (needs discussion).

Last updated: 2026-10-10

---

## 1. Premise

A small two-player co-op game. Two players drive a large off-road camper through procedurally generated wilderness, rescuing animals along the way. Players must board the camper to drive it or to use anything attached to it. They can step out to use hand tools on the terrain and the world.

Inspirations: *Lovers in a Dangerous Spacetime* (switching between vehicle stations under pressure), *Castle Crashers* (casual co-op). For atmosphere: *Alto's Adventure / Odyssey*, *Old Man's Journey*.

Design pillars:
1. **Collaboration over parallel play.** Most obstacles should be easiest with two people doing different jobs.
2. **The terrain is the puzzle.** Players dig, fill, cut timber and build to make their own route. There is no scripted solution.
3. **Weight is a choice.** Rescued animals and stored materials make the camper heavier and the drive harder.
4. **Warm and alive.** A lush, softly lit world with visible signs of life.

---

## 2. Scope and platform

- **[DECIDED]** Two players only, for now.
- **[DECIDED]** Online co-op in the browser, hosted on Render. The hosting approach is reused from the original prototype.
- **[DECIDED]** Local co-op is a goal. Both players play on one machine: keyboard plus gamepad, or two gamepads, through the browser's Gamepad API.
  - Architectural consequence: the simulation must run either on the server (online) or entirely in the browser (local), using the same shared code.
  - Camera consequence: use **one shared camera** that frames both players and the camper, zooming out as they spread apart, with a maximum spread distance. Use the same camera online so both modes play identically.

---

## 3. Dimensionality

- **[DECIDED]** A 2D side-view physics plane, rendered with parallax depth.
  - A **walkable background lane for players only**: they can step "into the trees" to gather resources, find items or reach animals, while the camper stays on the main plane.
  - A **branching route graph**: at forks, players choose between segments (e.g. river valley vs. ridgeline). Each run is linear overall.
  - The camper is drawn as a **dollhouse cross-section**: the interior and stations are visible while driving.
- Isometric was considered and rejected; the comparison is in §13.

---

## 4. Run structure

- **[DECIDED]** Roguelite **stretches** with persistent progress.
  - A stretch is one leg of the journey, from one camp to the next, on a fresh seed. Target length: 20–40 minutes.
  - At camp:
    - Rescued animals are delivered to a **sanctuary**, which grows over time and persists between runs.
    - The camper's weight resets.
    - Players choose a limited number of items to carry into the next stretch.
    - Unlocks and camper upgrades are spent here.
  - Structure confirmed 2026-10-10.
  - **[OPEN]** Exact meta-progression: what unlocks, how quickly, and whether biomes unlock in order.

---

## 5. Failure and recovery

- **[DECIDED]** Players can always recover. Failure costs time and effort, never the run.
  - A tipped camper must be righted. This takes work: winch or jack effort, not a free button. It should be painful but possible.
  - Possible costs of a bad crash:
    - cargo spills and must be re-collected
    - animals scatter and must be calmed and gathered
    - parts get damaged and need repair
  - **[OPEN]** Whether a last-resort "tow back to the last turnout" exists, and what it costs.

---

## 6. The camper

- Physics vehicle: a chassis on suspended wheels, with real mass.
- Stations, operated from inside (Lovers-style):
  - **Cab:** throttle, brake. Possibly low/high range.
  - **Winch:** front-mounted, anchors to trees and rocks, tension-only cable.
  - **Roof crane / arm:** lifts logs and boards into place.
  - **Cargo hold:** visibly stores soil, logs, lumber and found items. Contents add mass.
  - **Animal deck:** rescued animals ride here and add mass.
- **[OPEN]** Fuel or energy resource: yes or no.
- **[OPEN]** Upgrade tree, e.g. suspension, winch strength, crane reach, hold size.

---

## 7. Players, tools and items

- Each player has a small loadout of **2–3 slots**.
- Starting tools: shovel, axe, saw, hammer (the final starting set is open).
- Possible finds: rope, jack, lantern, bucket, pickaxe, seeds.
- Items can be **dropped**, **handed to the other player**, or **stored in the camper**.

### Material chain
- Tree → (axe) → log → (saw) → boards → (hammer) → plank bridge / ramp / platform
- Soil: dig → carry (bucket or hold) → place, to build ramps or fill gaps
- Rock: **[OPEN]** breakable with a pickaxe? usable as an anchor or fill?

---

## 8. Terrain

- **Procedural**, from a seed, split into chunks.
- **Editable**: dig and fill on a density grid. Smooth contours are produced by marching squares. Tunnels and overhangs are allowed.
- Generation = seeded noise plus a library of **challenge set pieces** stitched together, with difficulty scaling along the stretch. Each set piece is validated as solvable with the tools available.
  - Candidate set pieces: gap/ravine, washed-out bank, boulder field, mud pit, fallen tree, river ford, cliff ledge, steep climb with winch anchors.
- **[OPEN]** Biomes: e.g. temperate forest, river valley, ridgeline, autumn hills.

---

## 9. Animals

**[DECIDED]** Animals are companions with simple behaviour, not static cargo. They ride in the camper, hop out when it stops, wander near the players, follow when the camper moves, and help in specific situations. Each adds mass to the camper.

- **Dog** — found early in the first stretch and stays for the whole game (it is not delivered to the sanctuary).
- Rescuable: rabbit, chipmunk, deer, fox, hawk, bear.
- Rescued animals (all except the dog) are delivered to the sanctuary at camp.

### Initial bonuses **[LEANING]** — to be tuned in play

| Animal | Mass | Helps by | Trigger |
|---|---|---|---|
| Dog | Light | Sniffs out buried items and nearby animals; barks before slope collapse | Passive; points or barks |
| Rabbit | Very light | Loosens soil: digging near it is faster | When players dig nearby |
| Chipmunk | Very light | Gathers small spilled items and loose cargo back into the hold | After a spill or crash |
| Deer | Medium | Senses unstable ground: highlights soil that is likely to slump | Storms, fresh earthworks |
| Fox | Light | Night vision: scouts ahead at night, revealing terrain in a faint light | Night |
| Hawk | Light | Scouts the route: previews the next fork and extends how far the camera sees ahead | Called, with a cooldown |
| Bear | Very heavy | Shoves logs and boulders; helps right a tipped camper | Called; big mass penalty |

- **[OPEN]** How players call an animal to help (a "whistle" action vs. purely contextual).
- **[OPEN]** Rescue interactions per animal (e.g. free from a snare, coax with food, carry).
- **[OPEN]** Care needs while aboard (food or calm) as a light pressure source.

---

## 10. Pressure sources

**[DECIDED]** Two pressure sources to start with:

- **Storms**
  - Rain lowers traction on soil and wet boards.
  - **Slumping:** disturbed soil (anything dug or placed) slides when its slope is steeper than its angle of repose. Storms lower that angle, so fresh ramps and cut banks sag over time. Native, undisturbed soil stays stable, except in heavy storms.
  - Boards placed as shoring (a retaining wall) stop slumping. This gives building a second use.
- **Night**
  - Darkness. Players see only what is lit by their headlamps, the camper's headlights, and the lantern at the camper. The fox adds faint night vision.
- **[OPEN]** Other sources (rising rivers, animal needs) are deferred.

---

## 11. Art direction

- **[DECIDED]** Soft, well-lit, painted vector. Not pixel art: it flickered in past attempts, and it scales poorly to arbitrary zoom levels.
  - Background layers: gradient silhouettes with atmospheric perspective (layers grow lighter and hazier with distance), in the style of *Alto*.
  - Foreground: rounded vector shapes with soft rim lighting and contact shadows.
  - Lighting: a global colour grade driven by time of day. Golden hour by default. At night, cool blue, contrasted with the camper's warm lantern light.
  - Life: fireflies, pollen, birds, butterflies, swaying grass, small ambient animals.
- **[OPEN]** Asset production: shapes drawn in code, hand-authored SVG, or a mix.

---

## 12. Technical architecture

- **[DECIDED]** Node server, WebSockets (`ws`), one Render instance, rooms held in memory. A redeploy or the free tier sleeping wipes active trips.
- **[DECIDED]** Physics: planck.js (Box2D port), shared between server and browser.
- **[DECIDED]** Rendering: PixiJS 8, with all drawing as vector Graphics in world metres (y up).
- **[DECIDED]** Bundling: esbuild. Render build: `npm ci --include=dev && npm run build`.
- **Authority split (M1):**
  - The server owns the camper, the terrain, seat claims and tool use.
  - Each client owns its own on-foot avatar, using a kinematic controller against the terrain density field, and reports it at 20 Hz.
  - This is trust-based, which is acceptable for a two-friend co-op game, and it removes input lag for walking.
- **Netcode:**
  - The server steps the simulation at 60 Hz and broadcasts snapshots at 20 Hz.
  - Clients interpolate snapshots about 110 ms behind.
  - Terrain edits are broadcast as `(node index, density)` pairs. A late joiner regenerates from the seed and applies the accumulated edit list.
  - Known cost: the driver feels round-trip latency plus the interpolation delay on throttle. Acceptable for a heavy camper so far; revisit if it feels sluggish online.
- **Terrain:**
  - 0.25 m density grid.
  - Separate rock mask that cannot be dug.
  - Chunks of 32×32 cells.
  - Marching squares produces both the planck edge fixtures and the render mask. Collision is built only within ±44 m of the camper.
  - Strata and bedrock are drawn as smooth bands following the generated surface, clipped by the terrain mask.
- **Local mode:** the same `Sim` runs in the page (`LocalSession`). This is how offline practice works now, and the path for local co-op later.
- Reused from the original prototype: `render.yaml`, the `/health` check, the Dockerfile, room codes, invite links, session tokens.

### Known limitations (M1)
- On-foot travellers do not collide with the camper, and cannot stand on it.
- A placed brush of soil is not checked for floating geometry. Slumping will address this (§10).
- The camper's mass is fixed. Cargo and animals will add mass later.

---

## 13. Comparison: side view vs. isometric

| Concern | Side view + depth layers | Isometric |
|---|---|---|
| Digging / filling / ramps | Very readable; height is the screen's vertical axis | Height must be inferred from shading and contours; ramp angles and gap depth are hard to judge |
| Tunnels / overhangs | Free | Impossible with a heightmap; very costly with voxels |
| Bridges | Place along one axis | Place and align in two axes, plus height |
| Vehicle physics | 2D engine (mature, cheap) | Effectively 3D: pitch, roll and yaw on a heightmap |
| Camper interior / stations | Dollhouse cross-section; both players stay visible | Needs a roof cutaway; smaller on screen |
| Exploration / player spread | Limited to one line plus the background lane | Real 2D freedom of movement; can go around obstacles |
| Route choice | At discrete forks | Continuous, organic |
| Occlusion | None | Cliffs and trees hide things; needs cutaways or fading |
| Art cost | One view per asset | Several angles per vehicle and animal, or 3D models |
| Estimated effort | Baseline | About 2–3× for physics, terrain and art |

---

## 14. Milestones

1. **M1 — Core loop:** camper physics on procedural terrain; dig and fill; two players online; board and drive. *(First pass done 2026-10-10.)*
2. M2 — Winch, timber, saw, boards, building.
3. M3 — Items, loadouts, handoff, cargo hold with mass.
4. M4 — Animals and rescue.
5. M5 — Stretches, camps, sanctuary, meta-progression.
6. M6 — Local co-op and gamepad support.
7. Throughout — art, ambience, audio.

---

## 15. Decision log

| Date | Decision |
|---|---|
| 2026-10-10 | Full rewrite. Keep only Render hosting and the room/invite flow from the original prototype. |
| 2026-10-10 | Switch networking from HTTP POST + SSE to WebSockets. |
| 2026-10-10 | Roguelite stretches with persistent progress; recovery is always possible. |
| 2026-10-10 | Local co-op is a goal; one shared camera in both modes. |
| 2026-10-10 | Side view with depth layers confirmed. |
| 2026-10-10 | Stretch / camp / sanctuary structure confirmed. |
| 2026-10-10 | Dog found early, stays all game. Rescuable: rabbit, chipmunk, deer, fox, hawk, bear. Animals follow and help, not static cargo. |
| 2026-10-10 | M1 tech: planck.js, PixiJS 8, esbuild; client-owned avatars, server-owned camper and terrain. |
| 2026-10-10 | Pressure sources: storms (slick ground, slumping earthworks) and night (headlamps and headlights only). |
