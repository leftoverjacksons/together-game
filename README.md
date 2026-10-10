# Together

Two-player co-op in the browser: drive a big off-road camper through procedural wilderness, reshape the ground to get it through, and (soon) rescue animals along the way.

The design lives in [`docs/DESIGN.md`](docs/DESIGN.md). Update it when decisions change.

## Status: milestone 2 (timber and building)

- **Terrain:**
  - A procedural stretch with set pieces: ravines, hills, ledges, rock boulders, dips.
  - Editable terrain: dig soil into your bucket and place it to build ramps or fill gaps. Rock cannot be dug.
  - Disturbed soil settles into natural slopes, much faster in rain. Boards stop it.
- **Camper:**
  - A physics vehicle with stiff suspension and four-wheel drive. Its interior is drawn as a cross-section.
  - It can be pushed upright when tipped.
  - A roof rack (reached by the ladder at the front) stores boards and logs. The extra weight makes the camper heavier and more top-heavy.
- **Forest lane** behind the road (W / S):
  - Fell trees with the axe; it's faster with two.
  - Haul logs: one player drags slowly, two carry at walking speed.
  - Saw logs into boards.
- **Building:**
  - Place boards with the hammer. Boards join at joints and anchor to the ground.
  - Structures are analysed for stress. Unsupported parts wobble and then fall; overstressed boards snap; a braced truss holds the camper.
- **Sound:** synthesised effects, an engine, wind, rain and birdsong.
- **Look:** layered painted-vector scenery (snowy peaks, haze, clouds, light shafts, deer, flowers) and particles.
- **Modes:** online play for two, plus offline practice.

Not yet: the winch, items and handoff, animals and rescue, real weather and night, camps and the sanctuary, local co-op on one machine. See the milestones in the design doc.

## Run locally

```sh
npm install
npm run build     # bundles client/ into dist/game.js
npm start         # http://localhost:3000
```

`npm run dev` rebuilds the client and restarts the server on changes. `npm test` runs the terrain, simulation and server tests.

To test co-op on one computer, open the second player in a different browser or a private window. Each window keeps its own session.

## Controls

| Key | Action |
| --- | --- |
| A / D | Walk. At the wheel: drive forward / reverse |
| W / S | Step into the forest lane / back to the road |
| Space | Jump. At the wheel: brake |
| E | Board, take or leave the wheel, climb out; pick up or let go of a log; take boards; use the roof rack; salvage a broken board; hold beside a tipped camper to push it upright |
| 1–4 / mouse wheel | Shovel, axe, saw, hammer |
| Left mouse | Dig · chop · saw · drag to place a board |
| Right mouse | Place soil (shovel) · remove a board (hammer) |
| G | Drop carried boards |
| R | Toggle rain (testing) |
| M | Sound on / off |
| H | Controls panel |

## Deploy on Render

`render.yaml` describes one Node web service on the free plan:

| Setting | Value |
| --- | --- |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check | `/health` |
| Instances | One |

Trips live in memory. A redeploy, or the free instance sleeping after about 15 idle minutes, ends any trip in progress. The first visit after a sleep takes 30–60 seconds while the instance wakes. A `Dockerfile` is included as an alternative.

## Layout

```
shared/     simulation shared by server and browser
  terrain.mjs     density grid, generation, dig/fill, slumping, marching squares
  sim.mjs         planck.js world: camper, stations, tools, timber, rack, snapshots
  structure.mjs   boards, joints, frame analysis, breaking
  forest.mjs      forest-lane floor, trees, logs
  character.mjs   on-foot movement (road and forest lanes)
server/     HTTP + WebSocket server, rooms, fixed-rate loop
client/     browser game: sessions (online/offline), input, PixiJS renderer
public/     index.html and styles
test/       node --test suites
docs/       design document
```

### Networking model

- The server simulates the camper, the terrain and seat assignment at 60 Hz, and broadcasts snapshots at 20 Hz.
- Terrain edits are sent as changed grid nodes. A joining client regenerates the terrain from the seed, then applies the edit list.
- Each client simulates its own on-foot traveller and reports it to the server. Walking therefore feels instant, and the other traveller is shown about 110 ms behind.
- In offline practice, the same simulation runs in the page.
