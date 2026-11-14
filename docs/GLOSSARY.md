# GLOSSARY

Spanish source comments use some terms; this maps them to code names.

| Term | Meaning / where |
|---|---|
| Backrooms / level0 | the default maze level ("THE LOBBY"), `generateMaze` |
| Poolrooms / level 37 | water level, id `poolrooms`, `generatePools`, `PoolLevel` |
| `LevelCaps` / caps | per-level component switches `pool/ents/fall/insane/swim` (`shared/src/caps.ts`, `docs/level-caps.md`) |
| `CELL` / `POOL_CELL` | 1.5 m grid cell; `HEIGHT` 2.7 m (level0) |
| seed | integer from which client and server regenerate the identical map; `fixedSeed` = owner-pinned seed |
| `Maze` | plain grid description (`open`, `lit`, `zone`, props, tapes, spawns, hides...) shared by both sides; Poolrooms adds `lay`, `waters`, `tank`, `watergun` |
| `PoolMap` | rich pool-level map (floors, water depth, ramps, tubes, portals); `poolMaze` flattens it to `Maze` |
| `Match` | server object for one live round (server/src/match.ts) |
| `RoomState` / `Room` / `RoomView` | server room record / shared fields / what the client receives (`Room + players[]`) |
| phase | `lobby`, `starting`, `playing`, `over` |
| round | one lobby->level->elevator cycle; `room.round` increments on return to lobby |
| bank | shared team money |
| mission / offer | goal for the round; 3 offers are voted on a board in the waiting room; kinds `photos tapes soaps survive tvs` |
| elevator / ascend / board | exit cabin; opens when mission is done; `ascend(inv)` = enter it alive; `boarded` flag; fates `back/dead/stranded` |
| `inv` vs `cap` | server per-player: persistent inventory vs what may be carried this round (anti-cheat clamp) |
| spares | spare flashlights (`Inventory.spares`); main flashlight is infinite-but-battery (90 s normal) |
| Almond Water / water | consumable can: restores HP/stamina/sanity (item `water`) |
| Totem of Life / totem | item that revives a dead teammate via "Run for your life" |
| Run for your life / runlevel | client-only hospital-corridor level the dead player must run through to be revived (`runlevel.ts`, `hospital.ts`) |
| hide / niche | wall alcove (`maze.hides`) where a player can hide; entities may "inspect" it; hold breath with Space |
| Breath | air meter used while hiding (`sim.ts`) |
| entity | monster: `bacteria`, `partygoer` (level0 only) |
| grace | seconds after round start in which entities don't target players (difficulty-based) |
| strip / caution tape | player-laid tape segments (`Strip`, up to `STRIP_MAX` 4 each) |
| gadget | non-weapon hand item: caution tape, radar, totem (`Player.gadget`, `gadgets.ts`) |
| radar / holo / jam | hologram showing teammates; `jam` = ms of "no signal" after a Poolrooms portal |
| hotbar / quickslots | 4 quick slots (keys 1-4), `HOT` table in `quickslots.ts` |
| hand / left / belt | where items are held: right hand (camera, gun, watergun), left (flashlight), belt (stowed) |
| camcorder / camera | item `camera`; photo missions; aiming it enables VHS pass |
| rifle / gun | item `gun`; ammo packs of 4, magazine of 2; 10 % misfire (5 % aimed) kills the shooter |
| tank / diving tank | item `tank`: x2.5 air, -15 % speed (Poolrooms) |
| watergun / squirt / wet / stun | Poolrooms toy weapon vs teammates; `squirt` msg, `wet` effect |
| refills | drinking fountains that refill the water gun |
| soaps | Poolrooms mission collectibles; implemented as `tape` items (ids `t*`) |
| portal / tunnel sin fondo | bottomless 2x2 pits paired across the map (teleport) |
| deck / layer / `up` | Poolrooms floor 0 (ground) and floor 1 (`PoolMap.up`, y = 5.0) |
| drop | item thrown on the ground with Y (ids `d*`, TTL 300 s) |
| waiting room / WaitingRoom | 6x5 m 3D lobby with computer, button, door, armchairs (`waiting.ts`) |
| computer | in the waiting room: shop + wardrobe (`Computer.tsx`, `Shop.tsx`) |
| door | intro transition of the waiting room (the old "dive into TV" intro, `tvRoom.ts`, was replaced by the 2D loading screen) |
| loading screen | `Loading.tsx`: 2D VHS OSD between screens. At boot, `BootLoading.tsx` (centred, flat black, no snow) shows the real progress of `BackroomsGame.load` (phases in `LOAD_PHASES`: models, geometry, shaders, menu tapes) and warns when it is slow or stalled |
| look / loadout / cosmetic | avatar colour + hat + backpack; account loadout stored server-side |
| VHS / film pass | post-processing shaders (`vhsPass.ts`) |
| composer | `EffectComposer` owned by `BackroomsGame` |
| Reflector | three.js planar mirror used for water |
| layer 1 | Three layer holding the local first-person rig in the Poolrooms (hidden from water reflection) |
| lightmap | baked top-down light texture for level0 (`lightmap.ts`) |
| Timeline / Track / jitter buffer | remote-state interpolation (`interp.ts`) |
| volatile | socket.io emit that may be dropped (used for `players`, `world`) |
| guest vs account | no login (uid 0, nothing persisted) vs registered user (achievements, loadout, avatar) |
| ADMIN_USER | the single admin username `s7lver` |
| DEV_LOCAL | dev-only flag (Vite dev on localhost) that unlocks `?params` and `window.__*` |
| maintenance | server status mode that rejects create/join (`status`, `/status`) |
| `tape` (cinta) | ambiguous: (a) collectible VHS-like tape items `t*` (mission TAPES), (b) caution tape (`caution`, strips), (c) room list "tape number" (`Room.tape`, cosmetic label) |
| "SALA nn" | default room name (`SALA ${tapeNo}`), Spanish for room |
