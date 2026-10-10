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
  - Two walkable lanes:
    - **Road lane:** the camper's plane. Editable terrain, physics, building.
    - **Forest lane:** just behind the road, for players only. Most trees stand here, so they are a resource rather than an obstacle; players don't have to fell everything in their way. The forest floor follows the generated ground and cannot be edited. Players step between lanes with **W / S**, and can haul logs from the forest out onto the road.
  - Occasional trees stand in the road lane as deliberate obstacles.
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
- **Handling [DECIDED 2026-10-10]:** M1 felt floaty and the nose caught on things too easily. Changes:
  - stiffer suspension
  - more ground clearance
  - a raked (angled-back) front so the camper climbs onto obstacles instead of ramming them
- Stations, operated from inside (Lovers-style):
  - **Cab:** throttle, brake. Possibly low/high range.
  - **Winch:** front-mounted, anchors to trees and rocks, tension-only cable.
  - **Roof crane / arm:** lifts logs and boards into place.
  - **Animal deck:** rescued animals ride here and add mass.
- **[DECIDED] Roof rack:** stores lumber (boards and whole logs) where it can be seen. Everything stored adds mass. Players stow or take items while standing at the rear ladder.
- **[OPEN]** Fuel or energy resource: yes or no.
- **[OPEN]** Upgrade tree, e.g. suspension, winch strength, crane reach, rack size.

---

## 7. Players, tools and items

- Each player carries **3 tool slots**, chosen from: shovel, axe, saw, hammer. *(M2 gives both players all four, until item handoff exists.)* Starting loadout: shovel, axe, saw, hammer split between the two players (to be tuned; e.g. 3 + 3 with overlap).
  - Number keys switch tools.
- Possible finds: rope, jack, lantern, bucket, pickaxe, seeds.
- Items can be **dropped**, **handed to the other player**, or **stored in the camper**.
- **Carrying:** soil in a bucket (up to 4 m²), and up to 4 boards on your back.

### Material chain
- Tree → (axe) → log → (saw) → boards → (hammer) → structures
- **Felling:** hold the axe on a trunk. Two players chopping finish faster.
- **[DECIDED] Hauling:** one player can drag a log slowly; two players carry it quickly.
- Logs can go on the roof rack, be sawn where they lie, or be dragged onto the road to use as a ramp or crossing.
- Soil: dig → carry → place, to build ramps or fill gaps.
- Rock: **[OPEN]** breakable with a pickaxe? usable as an anchor or fill?

### Building **[DECIDED]**
- Structures are made of **boards** (up to about 3 m each). Each board connects two **joints**.
  - Joints snap together when placed close to each other.
  - A joint touching solid ground becomes an **anchor**. Anchors are pinned: they can rotate but not move.
- **Limited structural physics:**
  - The structure is analysed as a 2D frame. Boards resist stretching and squashing well, and bending poorly.
  - Loads: the boards' own weight, players standing on them, and the camper's contact forces.
  - A board that is overstressed for a moment breaks and falls as debris.
  - A part that is not held in place (e.g. a board sticking out from a single anchor) collapses.
  - Result: long unsupported spans and cantilevers fail, while triangulated trusses and propped spans hold. Building is a small engineering puzzle, not just rows of boards.
- Boards are rigid surfaces for the camper and the players while they hold.
- **Boards also stop slumping:** soil cannot slide through a board, so boards double as retaining walls (§8).
- Broken boards can be picked up again.

---

## 8. Terrain

- **Procedural**, from a seed, split into chunks.
- **Editable**: dig and fill on a density grid. Smooth contours are produced by marching squares. Tunnels and overhangs are allowed.
- Generation = seeded noise plus a library of **challenge set pieces** stitched together, with difficulty scaling along the stretch. Each set piece is validated as solvable with the tools available.
  - Candidate set pieces: gap/ravine, washed-out bank, boulder field, mud pit, fallen tree, river ford, cliff ledge, steep climb with winch anchors.
- **[DECIDED] Slumping (soil settling):**
  - Soil that players have disturbed (dug, placed, or near a dig) settles over time. It falls when unsupported, and slides when steeper than its angle of repose. Jagged cuts soften into natural slopes.
  - Dry soil settles slowly, to about 45°. In rain it settles fast, to about 27°, like a landslide.
  - Undisturbed ground (generated cliffs and ledges) stays put until someone digs near it.
  - Boards block soil from moving, so they can shore up a cut or hold a ramp.
- **[OPEN]** Biomes: e.g. temperate forest, river valley, ridgeline, autumn hills.

---

## 9. Animals

**[DECIDED]** Two kinds of animals:

- **Small animals are the score.** Rabbits, chipmunks, squirrels, songbirds and the like are counted as rescued. They are visible riding in the camper, and add only a little mass. They are delivered to the sanctuary at camp.
- **Large animals are helpers.** They travel with you and act when the camper struggles:

| Animal | How it helps |
|---|---|
| Hawk / eagle (birds of prey) | Swoop down when the camper struggles up a hill and help lift it |
| Deer | Walk alongside; grab ropes at the front of the camper and pull it over obstacles |
| Moose | Push from behind |
| Bear | Pushes hard from behind; can also help right a tipped camper |

- **Dog:** found early in the first stretch and stays for the whole game. It is a companion (sniffs out animals and items), not delivered to the sanctuary.
- **Rescue requires leaving the camper and helping the animal.** This is how you come to collect it. Examples:
  - free it from a snare or fallen branch
  - splint an injured leg
  - dig it out of a collapsed burrow
  - coax it down from a ledge with a board ramp
- Large helpers add real mass, so each one is a trade-off.
- **[OPEN]** Whether helpers act automatically when the camper stalls, or when called (a whistle).
- **[OPEN]** Care needs while aboard (food or calm) as a light pressure source.

---

## 10. Pressure sources

**[DECIDED]** Two pressure sources to start with:

- **Storms**
  - Rain lowers traction on soil and wet boards.
  - **Slumping:** see §8. Rain makes disturbed soil settle much faster and to a shallower angle, so fresh ramps and cut banks slide. Heavy storms may also loosen undisturbed ground near the surface.
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
- **[DECIDED 2026-10-10] Asset-driven renderer.** Every visual has a named art slot. When an image file exists for a slot, it is used; otherwise the code-drawn version is drawn. This lets hand-made or generated art replace placeholders one piece at a time, in any engine. See `docs/ART.md` for the style brief, file specs and slot list.
- **[OPEN]** Asset source: hand-made, AI-generated with hand clean-up, or a mix. The first step is an **art test**: one camper, one tree and one traveller, generated against the brief, then integrated and judged in play.
  - Generated art is easiest for backgrounds, trees and props, and hardest for animated characters (consistency between frames, limbs split into parts).
  - If the game is ever sold on Steam, AI-generated content must be disclosed on the store page. Each generator's terms of use also apply.

---

## 11b. Audio

- **[DECIDED]** Sound effects are synthesised in the browser (Web Audio API) at first, so there are no asset files: digging, chopping, sawing, hammering, the engine, creaks and snaps, footsteps, birdsong and wind.
- **[OPEN]** Recorded ambience and music later, from free (Creative Commons) libraries.

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

### Engine checkpoint **[DECIDED 2026-10-10]**
- We stay on the web stack (PixiJS + planck.js + Node) for now. The goal is maximum polish.
- **Checkpoint after M4 (animals)**, once the core loop is known to be fun: decide whether to move to Godot. Reasons that would favour moving:
  1. The target becomes Steam or a desktop download (native builds, the GodotSteam plugin for playing with friends, Remote Play Together for local co-op over the internet).
  2. The art and animation are made hands-on in an editor (skeletal animation, scene layout, particle tuning).
  3. Night lighting or performance hits a wall in the browser.
- Reasons to stay: a browser link that works with nothing to install; online play shares one simulation between server and browser; the build-and-test loop is fast and automated.
- To keep a move cheap: game rules stay engine-independent in `shared/`, and art is data (image files plus a manifest) rather than code.

- **Structures (M2):** `shared/structure.mjs`.
  - Boards are static planck bodies.
  - Contact impulses (`post-solve`) are accumulated per board.
  - A 2D frame stiffness solve (Cholesky) runs at 10 Hz per connected part.
  - A singular stiffness matrix means the part is unsupported ("shaky").
- **Forest lane (M2):** a smoothed floor function. It is not physics: forest logs are kinematic objects that become planck bodies when brought onto the road.
- **Audio (M2):** Web Audio synthesis in `client/audio.js`.

### Known limitations
- On-foot travellers do not collide with the camper, and cannot stand on it.
- The camper's mass changes with roof-rack cargo only, so far. Animals will add more.
- Both players currently carry all four tools. Three slots, plus dropping and handing tools over, come with items (M3).
- Rain is a manual toggle (R) until weather exists.
- Unsupported structures get a 6 s grace period ("shaky") so they can be braced. This is a deliberate gameplay concession.
- Only trees in the forest lane exist so far. Trees standing in the road lane as obstacles are planned.

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
2. **M2 — Timber and building:** handling fix, slumping, forest lane with trees, tool slots, felling, hauling, sawing, roof rack, structural boards, sound effects, visual detail pass. *(First pass done 2026-10-10.)*
3. M3 — Winch, items and finds, dropping and handing items, cargo mass.
4. M4 — Animals: rescue interactions, small animals as the score, large animals as helpers.
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
| 2026-10-10 | Forest lane behind the road holds most trees; lumber stored on the roof rack. |
| 2026-10-10 | Building uses limited structural physics: boards on joints, frame analysis, unsupported parts fail. |
| 2026-10-10 | Small animals are the score; large animals help (birds of prey lift, deer pull, moose and bear push). Rescue means getting out to help the animal. |
| 2026-10-10 | Stiffer suspension and better approach angle. Disturbed soil slumps; rain speeds it up; boards stop it. |
| 2026-10-10 | Synthesised sound effects. Log hauling: slow alone, faster with two. |
| 2026-10-10 | Stay on the web stack; engine checkpoint (Godot?) after M4. Renderer becomes asset-driven; art test with generated art. |
| 2026-10-10 | Pressure sources: storms (slick ground, slumping earthworks) and night (headlamps and headlights only). |
