# CONTRIBUTING (for LLM agents)

Read first: `workflow/PROJECT-CONVENTIONS.md`, `ARCHITECTURE.md` (gotchas section), `SPEC.md` (rules/protocol). Owner conventions: simplest solution that works, no tests unless asked, one commit per finished feature (only commit when the user asks), design tasks propose 2-3 directions first, no generic "AI slop" UI.

Verify with `python tools/build.py --check` (typecheck client + server). Run: `python tools/build.py`. Be careful: another agent or the owner may be editing files concurrently; `git status` is usually very dirty, never `git checkout`/`reset` files you did not change.

## Add an item (e.g. a new buyable/droppable gear)

Item data is spread over several places; missing one gives silent desync.

1. `shared/src/missions.ts`: add id to `ItemId` and `ITEM_IDS`; add a field to `Inventory` (boolean for one-of, number for stackable), `EMPTY_INV`, `INV_MAX`; extend `cleanInv` (the `b(...)` key union or `n(...)`) and, if stackable, the branches in `canHold/addItem/hasItem/removeItem`; add an entry to `SHOP` (price, info text, English UPPERCASE name).
2. `shared/src/index.ts`: add to `ItemKind` (the world pickup kind union) if it can lie on the map.
3. Placement (if on the map): `shared/src/sim.ts` `itemSpots()` (new id letter) and a spot generator on the `Maze` (see `waterSpots/radarSpot/totemSpot`: pure, hash-based, do not consume the seeded rng); in Poolrooms, `poolMaze()` in `shared/src/pools.ts`.
4. Server `server/src/index.ts`: add the id first letter to `GAIN`. `pickup`/`drop`/`buy`/`ascend` are generic over `ItemId`; `parseAdmin` uses `ITEM_IDS` automatically. If it has server-side behaviour (like water gun), add handling in `match.ts`.
5. Client carry/use: `client/src/game/player.ts` (`has`, `receive(kind)`, `inventory` getter, load from `Inventory`), `quickslots.ts` (`HOT` entry: name, icon, `have`, `use`, `info`), `game.ts` (`Inv` HUD interface, `start`/hud builder around line 827, models list `MODELS` if you add a glb), `items.ts` (pickup kind union, hint text, pickup effect), `Inventory.tsx` + `invIcons.ts` (icon key) + `inventory.css`.
6. Model: put the `.glb` in `client/public/models/<group>/` (compress with `python tools/pack_glb.py --max 512`), credit it in `client/public/models/CREDITS.md`, add to `MODELS` (level0 assets) or `POOL_KIT` in `poolmap.ts` (pool).
7. Check `docs/level-caps.md`: if the item only works in some levels, gate by caps rather than by `levelId`.

## Add a level

1. `shared/src/missions.ts`: entry in `LEVELS` (`id`, `name`, `title`, `blurb`). While unfinished, list the id in `DEV_LEVELS` so it only appears via admin `level`. If it needs its own missions, add a `...Missions(seed, round)` function (see `poolMissions`) and use it in `prepare()`.
2. `shared/src/caps.ts`: entry in `LEVEL_CAPS` (+ new `LevelCaps` field if you need a new capability; then set it for every level). Never branch on `levelId` for gameplay; read caps.
3. Map generator in `shared/` (pure, seeded, same on both sides). The server needs a `Maze` (`open`, `start`, `elevator`, spawns, item cells): either extend `generateMaze` usage or write a `xxxMaze(seed)` adapter like `poolMaze`. Wire it in `Match` constructor (`caps.pool ? poolMaze : generateMaze`) and `prepare()` in server index.ts (mission pool).
4. Client: a builder class (see `PoolLevel` in `poolmap.ts`) exposing the camera, scene, `update`, collision and `dispose`; hook into `BackroomsGame.start` (branch on caps, like `if (mp && this.caps.pool) startPool`), swap `RenderPass.scene/camera` and restore on exit; `warmLevel` for preload (must emit `ready(true)` within `LOAD_GRACE`).
5. If the level has special pickups, follow "Add an item". If entities: set `ents:true` and make `Match` spawn them; otherwise `noEnts`.
6. Waiting-room board shows `LEVELS[levelId].title/blurb` automatically (`Board.tsx`, `waiting.ts`).

## Add a mission

1. `shared/src/missions.ts`: add to `MissionKind`; branches in `missionText`, `missionLine`, `makeMission` (goal range, reward formula); include it in `offerMissions` (and/or a level-specific list).
2. `shared/src/missions.ts` icon: `client/src/game/missionIcons.ts` `MISSION_ICONS` (Record over `MissionKind`, typecheck will flag it).
3. Server `match.ts`: `progress` getter (how it advances) and `setMission` (remove/keep items, set up state). If it needs player events, add a socket event (below) and handle it. `roundTick` already opens the elevator when `progress >= goal`.
4. Client HUD reads `room.mission` (`missionLine`); extra visuals like `client/src/game/mission.ts` for TVs.

## Add an entity

1. `shared/src/sim.ts`: extend `Kind` and `HEIGHT`; behaviour in `EntitySim` (constructor takes kind; speeds are constants at the top: WANDER/CHASE/REACH etc.). Also `parseAdmin` (`server/src/admin.ts`) whitelists kinds (`bacteria|partygoer`): add the new one for admin spawn.
2. `server/src/match.ts`: initial spawn list (`['bacteria','partygoer']`), respawn rule in `hit()`.
3. Client `client/src/game/entity.ts`: `ANIMS`-style table (clip names per kind), model in `MODELS` (`game.ts`), material tweaks; `audio.ts` sound per kind; achievements/missions if relevant (photos count any entity).
4. Entities only exist when `caps.ents`.

## Add a socket event

1. `shared/src/index.ts`: add the signature to `ClientToServer` (or `ServerToClient`) with a doc comment (payload, acks, rules).
2. Server: handler in `io.on('connection')` in `server/src/index.ts`. Always: resolve `roomOf(sock.id)` and `p`, check `r.phase`, `p.dead`, `p.boarded`, cap flags, validate payload types (`Number.isFinite`, string length), rate limit with a timestamp, reply via ack only if `typeof cb === 'function'`.
3. Client: `sock.emit(...)` from the module that owns the action; for server->client, subscribe in `game.ts` `wire(mp)` (store unsubscribe in `offNet`) or in `net.ts` if it is global state.
4. High-frequency data: use `volatile`; low-frequency state changes: mutate `RoomState` and call `push(r)` so `room` goes out.
5. Update `docs/SPEC.md` protocol tables.

## Add an achievement / cosmetic

`shared/src/progress.ts` (`ACHIEVEMENTS`, `COSMETICS`, `need` key); award in server code with `award(p.uid, key)` / `count(p.uid, stat)` (accounts only); new stat key -> `StatKey` + `STAT_LABEL`. Hat/backpack model at `client/public/models/cosmetics/<id>.glb`, fit in `pieces.json`/`grips.json` via `/?anim` (IK tab). Note: Poolrooms owner rule "no more achievements for now" (`docs/poolrooms.md` section 8).

## Add a DB column/table

Append a string to `MIGRATIONS` in `server/src/db.ts` (never edit old ones). Account data only.

## Checklist before finishing

- [ ] `python tools/build.py --check` passes (client + server typecheck).
- [ ] Shared change: both sides still derive identical maps/ids; no `Math.random()` in generators; no extra consumption of seeded rng in existing generator paths.
- [ ] Every client-reported fact is validated/clamped on the server; new handler checks phase/dead/boarded/rate.
- [ ] New item/mission/level covered in all locations listed above (grep the id of a similar existing one: e.g. `grep -rn watergun` to see every touch point).
- [ ] Caps respected (no `levelId ===`).
- [ ] UI text English uppercase, comments Spanish, matching surrounding style; no new real lights in scenes (recompiles all materials).
- [ ] Tested in browser if visual (Vite dev client, `DEV_LOCAL` shortcuts) and with 2 tabs if multiplayer.
- [ ] Docs updated (`SPEC.md` numbers/protocol, `ARCHITECTURE.md` if structure changed). Don't create extra docs.

## Do not

- Do not edit `workflow/`, `node_modules/`, `server/data/`, or commit `assets-src/` / `*.zip`.
- Do not add server physics for water or oxygen without moving it from the client wholesale.
- Do not bump `three` (pinned 0.160; examples imports like `three/examples/jsm/...` depend on it).
- Do not add tests, dependencies, or abstractions the owner did not ask for (conventions: ponytail/simplest). Do not add `levelId` switches.
- Do not send the map or derived generator data over the wire; send seeds.
- Do not weaken `isAdmin()` / `parseAdmin`; do not trust `Me.admin` on the client.
- Do not commit unless asked; commit messages follow one-feature-per-commit.
- Do not reformat files wholesale (diffs are huge already: many `.glb` and source files are modified in the working tree).
