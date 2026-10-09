# Together: The Ridge Road

**A little home. A wild road. Together.**

Version 0.2 rebuilds the first prototype as cooperative overlanding: a shared rolling cabin with weight, wheel suspension, gravity and an anchorable winch. Shape a route through hills and a gully with your partner. The old scripted bridge and obstacle gates have been removed.

## Run or deploy

Use Node.js 24, then `npm start`. Open **http://localhost:3000**, start a journey, and invite a second browser. Use a separate browser or private window to test both travelers on one computer. A duplicated tab may inherit its original session credential.

For remote play, deploy the repository as a **Node Web Service** on Render (configuration is also in `render.yaml`):

| Setting | Value |
| --- | --- |
| Branch | `main` |
| Build command | `npm run check` |
| Start command | `npm start` |
| Health check | `/health` |
| Instances | One |

Open the deployed HTTPS address, create a trip and share its invitation link. GitHub Pages cannot run this multiplayer server. The included Dockerfile is another deployment option: `docker build -t together-game .` then `docker run --rm -p 3000:3000 together-game`.

**Active trips live in memory. A restart or redeploy starts fresh.** Empty trips pause and expire after two hours. A sleeping hosting instance also loses its trips. No database, account system, paid API or runtime npm package is required.

## The new field test

- A handcrafted 4,480-unit route with a steep ridge, a gully and a high pass.
- A rotating chassis with two separately suspended wheels. Driven wheels need ground contact. Grade, clearance and weight affect progress; there are no progress flags blocking the road.
- 20-unit editable soil cells over fixed bedrock. Excavation adds to shared soil; placement consumes it. Cavities and tunnels are possible, not just changes to a height map. Fill requires adjacent terrain and cannot be placed inside the cabin, wheels, logs or players.
- A tension-only winch cable attached to a nearby tree or rock. Reeling reduces cable length and applies a capped pulling force at the front roof corner, which can also pitch or tip the house. Paying out creates slack. A load gauge shows when the winch is working at its limit.
- Sawable trees produce physical logs. Carry, rotate and set down logs to make a crossing or improve an approach. Free logs fall, slide and react to the wheels.
- Both travelers can drive, operate the winch or work outside. A lone driver can control the attached winch; with two connected travelers, use the separate winch station.
- Moss is waiting along the route. Reach Stillwater with everyone aboard.
- Recovery returns the cabin and both travelers to the latest level turnout while preserving earthworks. It releases the cable and drops carried timber.

## Click-first controls

Click the house, a tree, a rock, timber, or ground to open a radial action menu. Actions are specific to the object; disabled actions explain reach or occupancy limits. Selecting Dig or Place soil activates a brush: hold the mouse to work; right-click or Esc returns to menus. Selecting Fell tree keeps sawing automatically until the tree falls; movement or Esc cancels it. The large tool button row is hidden; keyboard shortcuts remain available.

A tipped house displays a prominent **Right the house** button. The same action is on the house menu. It places the vehicle upright on nearby clear, level ground, releases the cable, boards both travelers, and clears throttle input. If no suitable nearby ground exists it searches near the checkpoint. Recovery is available even when a traveler is far from the cabin. Earthworks are preserved.

## Keyboard shortcuts

| Control | Action |
| --- | --- |
| A / D, arrow keys | Walk; throttle at the wheel |
| E | Board, take/leave a station, exit, drop timber |
| Space | Jump on foot; reel in at the winch |
| S | Pay out cable at the winch |
| Shift | Brake while driving |
| 1 + hold mouse | Dig nearby soil |
| 2 + hold mouse | Place soil against existing ground |
| 3 + click | Attach a tree/rock anchor; click again to detach |
| 4 + hold mouse | Saw a trunk |
| 5 + click | Pick up/drop timber |
| Q / R | Rotate carried timber |
| Mouse wheel | Zoom in/out to scout |
| H | Field guide |

Walk all the way to the left of the cabin to find the exit prompt. The winch station is left of center; the wheel is on the right. Leaving the wheel applies the parking brake. Start by getting out before the first pine and sawing it down. Shape the approach, move the trunk, or scout the ridge anchor before attempting the climb. The soil supply includes 45 starting cells for experimentation.

## Engineering and tests

`shared/physics.mjs` is the authoritative simulation: Verlet particles, a constrained rectangular chassis, spring wheel mounts, terrain contact, timber capsules and cable forces. It runs at 120 physics substeps per second; the server sends shared state at 20 Hz. This is deliberately a lightweight game model, not a calibrated engineering simulation.

`server.mjs` preserves the existing two-player room protocol, credential checks, bounded inputs, reconnect behavior and stale-input timeout. Terrain is sent on join, reconnect or terrain-version changes, not repeated in every frame. Neither browser decides vehicle motion or inventory.

`public/overland.js` renders terrain, suspension, cabin rotation, tools, cable, travelers and the route map. The client interpolates snapshots and submits input. All artwork is drawn with Canvas.

Run `npm run check` and `npm test`. Tests cover settling, parking brake stability, traction versus winching, no airborne thrust, soil conservation and reach, tunnels, fill collision guards, tree felling, timber ownership, two-person winch operation, recovery, two live HTTP clients receiving terrain changes, reconnects, and client startup/render smoke checks.

## Scope and current limits

The cabin is fixed construction; modular builds and movable cargo are future work. Terrain is a static editable grid: it does not simulate loose soil or cave-ins. Cables do not wrap around terrain or trees. Timber interaction and tire traction are simplified and need hands-on tuning. Standing trees and rock anchors are fixed until cut; undermining soil does not topple them. There is no full campaign, procedural generation, saving, voice chat or NPC conversation system in this field test. Desktop keyboard and mouse are recommended; touch controls are basic.

The route offers physical problems rather than prescribed recipes, but the entire route has not yet been verified in a two-human playthrough. Share where you get stuck and whether it feels like a useful challenge or a physics problem.
