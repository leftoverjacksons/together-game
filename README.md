# Together

Two-player co-op in the browser: drive a big off-road camper through procedural wilderness, reshape the ground to get it through, and (soon) rescue animals along the way.

The design lives in [`docs/DESIGN.md`](docs/DESIGN.md). Update it when decisions change.

## Status: milestone 1 (core loop)

- A procedural stretch (seeded), with set pieces: ravines, hills, ledges, rock boulders, dips.
- Editable terrain. Dig soil into your bucket and place it against the ground to build ramps or fill gaps. Rock cannot be dug.
- The camper is a physics vehicle: chassis, two suspended wheels, four-wheel drive. Its interior is drawn as a cross-section, so you can walk around inside, take the wheel, and climb out by the door.
- A tipped camper can be pushed upright by travellers standing beside it. It is slow alone and faster with two.
- Online play for two, plus an offline practice mode where the simulation runs in your browser.
- Soft vector art: a golden-hour sky, parallax hills and forest, layered soil and bedrock, grass, pollen, butterflies and birds.

Not yet: the winch, timber and building, items and loadouts, animals, storms and night, camps and the sanctuary, local co-op on one machine. See the milestones in the design doc.

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
| W / Space | Jump. At the wheel: brake |
| E | Climb aboard, take or leave the wheel, climb out. Hold beside a tipped camper to push it upright |
| Left mouse (hold) | Dig soil into your bucket |
| Right mouse (hold) | Place soil against the ground |
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
  terrain.mjs     density grid, generation, dig/fill, marching squares
  sim.mjs         planck.js world: camper, stations, tools, snapshots
  character.mjs   on-foot movement against the terrain
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
