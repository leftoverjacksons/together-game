# Together

**A little home. A long way together.**

A working two-player browser prototype about taking a rolling cabin down a worn-out coast road. Quiet travel, shared machinery, salvage, a bridge to mend, a fallen pine to winch aside, a roadside neighbor, and a dog named Moss. Original Canvas artwork; no downloaded assets or runtime dependencies.

## Run

Install Node.js 22 or newer, then run:

```sh
npm start
```

Open **http://localhost:3000**. Start a journey, then use **Invite a friend**. To test both travelers on this computer, open the invitation in a **separate browser or private window**. The room allows two travelers; each browser keeps its own reconnect credential in session storage. A new tab opened normally also works, but a duplicated tab may inherit the first traveler's session.

On the same network, your partner can use `http://YOUR-LAN-IP:3000` if your firewall permits it. A localhost invitation is only useful on the host computer.

## Play from different locations

The server must be hosted at a shared HTTPS address. This repository includes `render.yaml` for a Render Node web service and a `Dockerfile` for any container host. **No public game server is deployed merely by pushing this repository.**

For Render, create a web service from this repository with:

- Runtime: Node; one instance.
- Build command: `npm run check`
- Start command: `npm start`
- Health check: `/health`

The server respects the host-provided `PORT`. After deployment, open the service's HTTPS URL, start a trip, and send the invitation to your partner. The host needs to support long-lived HTTP event streams. If it sleeps or restarts, in-memory trips are lost. Hosting provider account setup and any charges are managed by you.

Container option:

```sh
docker build -t together-game .
docker run --rm -p 3000:3000 together-game
```

## Controls and first chapter

| Control | Action |
| --- | --- |
| A / D or arrow keys | Walk; drive when at the wheel |
| Space | Jump; hold to operate the winch |
| E | Interact, enter/leave a station, board or exit |
| H | Field guide |

The rear door is at the left end of the cabin, the winch near the rear bunk, and the wheel at the front. Both travelers can use either station, but only one can occupy each at a time. Walk up to an object and follow the E prompt. A single connected traveler gets automatic winch assistance while driving.

1. Drive toward the old bridge. Leave the cabin through its rear door.
2. Pick up three planks from the two salvage piles, one per traveler at a time. Fit them at the near bank.
3. Walk across the repaired bridge and secure the anchor on the far bank. Before repairs, the stones can be jumped across.
4. Board again: one drives while the other holds Space at the winch. Low cable tension stops forward movement until wound back up.
5. Say hello to Moss, then hook the fallen pine with the cabin nearby. Operate the winch to pull it clear.
6. Bring both travelers aboard and drive to Stillwater.

No death or lost inventory on a failed river jump. The home waits; get back in and try again.

## Architecture

- `server.mjs`: dependency-free Node HTTP server. Random ten-character trip codes and separate 192-bit player credentials. Two-player room limit, same-origin browser mutations, bounded request bodies, admission throttling, and stale-input timeout.
- `shared/game.mjs`: authoritative 20 Hz simulation. All movement, interactions, supplies, station occupancy, and progression are validated here.
- `public/game.js`: interpolated Canvas rendering, keyboard/touch controls, invitation flow, reconnecting event stream, and journal. POST requests transmit input; Server-Sent Events broadcast snapshots to both browsers. No browser owns the world.
- `test/game.test.mjs`: complete route simulation, station/inventory/recovery behavior, solo mode, and two HTTP clients receiving shared state with authorization and reconnect checks.

```sh
npm test
npm run check
```

## Deliberate prototype limits

This is one handcrafted chapter, **not a procedural world or freeform vehicle builder yet**. Construction currently means carrying and fitting bridge planks. The house has fixed modules. Mara has one authored conversation; Moss is an optional companion. Rooms live in process memory, pause when empty, and expire after two empty hours. Server restarts erase trips. Traveler places remain reserved for reconnects; to change partners, start a fresh journey. There is no account system, persistent campaign, voice chat, or production abuse protection. Keep invitation links private.

Next useful steps: play together and tune crossing friction; then add saved journeys, modular vehicle equipment, authored encounter variations, and branching passenger stories. Durable room storage and multi-instance routing should precede a larger public release.
