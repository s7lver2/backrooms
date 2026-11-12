# ARCHITECTURE

Read `workflow/PROJECT-CONVENTIONS.md` first (owner conventions: monorepo, one commit per finished feature, no tests unless asked, simplest solution wins). Rules/numbers: `SPEC.md`. Words: `GLOSSARY.md`. How to extend: `CONTRIBUTING-LLM.md`.

## 1. Monorepo layout (npm workspaces: `shared`, `server`, `client`)

```
E:\backrooms
  shared/src/   pure TS, no DOM/Node APIs; imported as '@backrooms/shared' by both sides
  server/src/   Node + socket.io, runs with tsx (no build step)
  client/src/   Vite + React 18 + Three 0.160 (+ gsap)
  client/public/models/  .glb assets (backrooms/ cosmetics/ pool/ waiting/ surveilance_room/) + CREDITS.md
  tools/        build.py (dev/build/check), pack_glb.py (compress glb: --max 512), package.py (zip)
  docs/         this documentation (+ older specs: spec-fase1..3, spec-lobby-pulido, spec-mapa-abierto-escondites)
  assets-src/   raw source models (gitignored)  | server/data/ SQLite file (gitignored)
  DESIGN.md, ROADMAP.md  design decisions / ideas (Spanish)
```

### shared/src (the contract; everything deterministic by seed)

| File | Role |
|---|---|
| `index.ts` | ports (5180/5181), constants, `PlayerState`, `Room`/`RoomView`, `WorldSnapshot`, `ClientToServer`/`ServerToClient` socket types, admin types. Re-exports all other files |
| `maze.ts` | `Maze` type, `generateMaze(seed, players)`, `CELL`, zones, props, BFS, route length |
| `pools.ts` | `generatePools(seed)` -> `PoolMap` (two floors, water, stairs, tubes, portals), `poolMaze(seed)` -> flat `Maze` for the server, `poolFloorY`, `poolPortalAt`, `PY`/`PK`/`PR` enums |
| `sim.ts` | `EntitySim` (entity AI), `Breath`, hiding niches, `solidAt`, `seesXZ`, `itemSpots(maze)` (ids of pickups), `waterSpots/totemSpot/radarSpot` |
| `missions.ts` | `LEVELS`, mission generation, `SHOP`, `Inventory` helpers (`addItem/removeItem/canHold/cleanInv/purchase`), money constants, TV sites, `RoundResult` |
| `caps.ts` | `LevelCaps` + `LEVEL_CAPS` (what each level enables) |
| `progress.ts` | achievements, cosmetics, `Look`, account validation regexes, `Me` API type |

### server/src

| File | Role |
|---|---|
| `index.ts` (~870 lines) | HTTP server + socket.io; `RoomState`, `rooms` map, round state machine (`begin`, `closeVote`, `play`, `finish`, `backToLobby`, `prepare`, `checkOver`), every socket handler, admin console, 3 broadcast intervals (20 Hz sim, 15 Hz players, 10 Hz world) |
| `match.ts` | `Match`: one live round. Holds the `Maze`, items, `EntitySim`s, hide niches, photos, TVs; `tick`, `pickup`, `hit`, `photo`, `squirt`, `canBoard`, `fell`; `applyWet` |
| `auth.ts` | HTTP API (`/api/*`): register/login/recover/loadout/avatar, cookie sessions, argon2id, CSRF/Origin checks, rate limiting |
| `db.ts` | `node:sqlite` (`DatabaseSync`) file `server/data/backrooms.db` (or `DB_PATH`); migrations by `PRAGMA user_version`; tables users, sessions, achievements, stats, loadout, avatars |
| `progress.ts` | `award(uid,key)`, `count(uid,stat)`; `hooks.notify/loadout` wired by index.ts |
| `admin.ts` | `parseAdmin`: validates admin payloads |

### client/src

| File | Role |
|---|---|
| `main.tsx`, `App.tsx` | entry; mounts `game/Backrooms.tsx` |
| `net.ts` | `useNet(on)`: socket, link state, `room`, `inv`; `useServer` polls `/status` |
| `account.ts` | account store (fetch `/api/*`), `me` |
| `settings.ts` | player settings in localStorage `br-settings` |
| `devGate.ts` | `DEV_LOCAL` = Vite dev AND hostname localhost/127.0.0.1/[::1]; gates every dev shortcut |
| `achievements.ts` | local achievement helpers (legacy localStorage; server is the source for accounts) |
| `game/Backrooms.tsx` (~1070) | top-level React component: screen state machine (`load menu settings achv play pause dead crash lobby wait waitpause over`), creates `BackroomsGame`, wires `useNet`, overlays HUD |
| `game/game.ts` (~2260) | `BackroomsGame`: THE engine class (renderer, composer, loops, networking glue, all modes) |
| `game/player.ts` | `Player`: first-person controller, rig/hands (IK), flashlight, stamina/sanity, hotbar state, gadgets, drink, `receive(item)`, `inventory` getter |
| `game/world.ts`, `lightmap.ts`, `pit.ts`, `compile.ts`, `still.ts` | level0 3D world: instanced walls/floor/ceiling, baked lightmap, void pits, shader precompile |
| `game/poolmap.ts` (~1480) | `PoolLevel`: Poolrooms scene + own movement/physics/swim/oxygen/water gun; `loadPoolKit()` |
| `game/pool.ts` | `PoolTest` water test room (`?pool`), water shaders `vert/frag`, `tiles()` texture helper reused by `poolmap.ts` |
| `game/remote.ts`, `interp.ts` | `Remote` = another player's avatar; `Timeline`/`Track` jitter-buffer interpolation (also `worldTl` for entities) |
| `game/entity.ts`, `shatter.ts` | entity visuals; death shatter effect |
| `game/items.ts` | pickups, camera/rifle logic, elevator, `syncDrops` |
| `game/quickslots.ts` | hotbar (4 slots, `HOT` table of `HotDef`) |
| `game/gadgets.ts`, `holo.ts` | caution tape + radar hologram |
| `game/Inventory.tsx`, `InvAvatar.tsx`, `invIcons.ts`, `inventory.css`, `Hotbar.tsx` | inventory UI (bag), avatar preview, icon renderer, hotbar |
| `game/Lobby.tsx`, `WaitPanel.tsx`, `RoomSettings.tsx`, `Board.tsx`, `Shop.tsx`, `Computer.tsx`, `Totem.tsx`, `Chat.tsx`, `End.tsx`, `Admin.tsx`, `Account.tsx`, `Achievements.tsx`, `Settings.tsx`, `Loading.tsx`, `Touch.tsx`, `Frame.tsx`, `Crosshair.tsx` | React screens/overlays |
| `game/waiting.ts`, `waitDecor.ts`, `waitKit.ts`, `waitCorridor.ts`, `waitProps.ts` | waiting room scene, its decor, corridor behind the door |
| `game/runlevel.ts`, `hospital.ts` | "Run for your life" level (client-only) |
| `game/mission.ts` | TURN OFF TVS visuals |
| `game/vhsPass.ts` | `VhsShader`, `FilmShader` post passes |
| `game/audio.ts` | all sound is synthesized (WebAudio), no audio files |
| `game/rig.ts`, `ik.ts`, `cosmetics.ts`, `grips.ts` + `grips.json`, `pieces.json` | Mixamo rig, arm IK, hats/backpacks, hand grips and accessory fit data (edited via dev tool `/?grips`, `client/src/dev/GripTool.tsx`) |
| `game/input.ts` | keyboard/mouse/touch -> `Controls` per frame |
| `game/maze.ts` | re-export of shared maze (+ ascii debug) |

## 2. Data flow

```
shared (seed) ──generateMaze / generatePools(poolMaze)──┐
shared sim.ts (EntitySim) ──────────────────────────────┤
shared missions.ts / caps.ts / progress.ts ─────────────┤
                                                         ▼
server Match (authoritative: entities, pickups, photos, hits, TVs)
server index.ts RoomState (phase machine, votes, bank, inventories, drops, strips)
        │  socket.io:  room (on change) · players 15Hz · world 10Hz · inv · events
        ▼
client Mp {sock,id,inv,mission,level,caps}  ──►  BackroomsGame.start(seed, mp)
   level0: World(generateMaze(seed)) + Items + Entity(snapshot) + Remote(players)
   pool:   PoolLevel(generatePools(seed))  (own scene) + same Player/Gadgets/Remote
   composer: RenderPass -> (GTAO, SMAA only in Poolrooms; Bloom) -> FilmShader/VhsShader -> OutputPass (see poolFx in game.ts)
```

Key idea: **client and server both call the same pure generator with the same seed**, so the map is never sent. Anything derived (item cells, TV sites, mission goals, crt count) must be a pure function of the map/seed in `shared/`, and the server validates by distance/state only.

### Round lifecycle (code path)
1. `create/join` -> `addPlayer` (player in waiting room at `WAIT_SPAWNS`), client `Game.waitRoom(room, inv)` renders `waiting.ts` scene.
2. Owner `start` -> `begin(r)`: seed = `nextSeed`, `phase='starting'`, push. Client plays door/corridor dive (waiting door), calls `warmLevel` to preload, then emits `ready(true)`.
3. After `START_DELAY` the vote opens; `closeVote` picks mission; when all `loaded` (or +`LOAD_GRACE`) -> `play(r)`: `new Match(seed, difficulty, nPlayers, levelId)`, `setMission`, positions at `startOffset(slot)`.
4. Client sees `phase==='playing'` in `room` -> `Game.start(seed, mp)` (level0) or `startPool`/`buildPool` (pool caps).
5. Tick: server `match.tick` (entities) + `roundTick` (mission progress, drop TTL); `checkOver`. Mission done -> elevator opens client-side (`Items.ready`); player walks in -> `ascend(inv)`.
6. `finish` -> `over` event (RoundResult) -> `backToLobby` -> clients show `End.tsx`, then back to waiting room.

## 3. Server authority model

Server decides: who is dead / HP, entity AI and kills, pickup winners, mission progress, money, inventory caps (`cap`), drops, TV state, wet/stun, round phase, vote result, admin rights, achievements. Client decides (and is trusted only within server clamps): own position (speed-clamped), flashlight/battery, stamina, sanity (server just obeys `insane`), Poolrooms oxygen/water/swim physics (client-only), run-for-your-life simulation, photo framing details (server checks coarse cone/range/LOS), hiding (validated against niches), loadout display. Anything gameplay-affecting that the client reports must be validated or clamped in `server/src/index.ts` / `match.ts`. Rate limits exist for chat, hit, buy, drop, photo, squirt.

Never trust client-sent `hp`, `hiding` without niche, `inv` beyond `cap`, admin actions without `isAdmin()`.

## 4. Client rendering notes

- One `THREE.WebGLRenderer` + `EffectComposer` owned by `BackroomsGame`; modes swap `RenderPass.scene/camera` (level0 scene, waiting room scene, pool scene, run level). Always restore on exit (`endPool`, `endRun`).
- Lights are fixed in number (hemisphere + flashlight SpotLight + 4 PointLights): changing light counts recompiles every material. Level0 light is baked in `lightmap.ts`. Don't add real lights per object; use additive cones (see `remote.ts` beam) or shader tricks.
- Level0 geometry is instanced (4 drawings for walls etc.). Poolrooms geometry is merged per material (about 6 meshes), one planar `Reflector` for all water.
- Quality: `opts.low` (touch devices or `?low`), `settings.resScale`, GTAO and SMAA are enabled only inside the Poolrooms (`poolFx`); `adminPerf('ao'|'smaa'|'sun')` toggles them. Shader compile is throttled by `compile.ts`/`still.ts` (Firefox stalls without parallel compile). SETTINGS > PERFORMANCE groups the knobs for slow computers: `quality` (GRAPHICS; `Backrooms.tsx` turns it into `opts.low`), `shadows`, `bloom` (live), `fpsLimit` (`capped()` in `game.ts`), `poolAO`/`poolAA` (read in `poolFx`), `texFilter` and `resScale`. `settings.warmup` (SHADER WARM-UP: 0 lazy / 1 quick / 2 full) is read once at boot by `compile.ts`; there is no persistent shader cache on the web, see [shader-cache-escritorio.md](shader-cache-escritorio.md).
- VHS pass is enabled only while aiming the camcorder, dying, winning, or fade-in (level0); disabled in Poolrooms.
- Interpolation: remote players and entities render ~150 ms in the past via `interp.ts` (`delay = 1.5 intervals + 2x jitter`); sender stamps `t` (performance.now) in `PlayerState`; world snapshot `t` is server `Date.now()`.

## 5. Gotchas (read before touching the listed areas)

- **Layer 1 = own rig** (Poolrooms): the local body, hands and held items are moved to Three layer 1 and the pool camera enables layers 0+1 (`game.ts` buildPool). The water `Reflector` virtual camera only sees layer 0, so the player's own rig is not re-rendered in the reflection. New objects attached to the first-person rig inside pools must be set to layer 1 or they will be drawn twice / appear in reflections. Verified in `game.ts` (`layers.set(1)`).
- **Reflector** (three examples): one planar water for the whole level (single water height per deck); skipped when upstairs (`skipRefl`) or in tunnels; reflection excludes layer 1.
- **Poolrooms is a separate scene/controller**: `PoolLevel` does its own movement/collision (`poolFloorY`, swim, stairs). `Player` is used only for hands/flashlight/inventory via a stub `World` (`stub.solid`, `voidAt`). Server sees it as a flat `Maze` (`poolMaze`); heights are never validated server-side.
- **Oxygen/water are client-side** by design; server only knows cells. Don't add server-side depth checks without moving oxygen too.
- **`tsx watch` (server `npm run dev`) restarts the process on any server/shared edit** (shared is imported by the server). All rooms live in memory, so every restart destroys all rooms while open clients keep their stale `room` state/socket until they reconnect: you must reload the client and recreate the room. This desync is expected in dev; do not chase it as a bug. *(inferred from in-memory `rooms` Map and tsx watch; not observed by this doc's author)*
- **Edits to `shared/` affect both sides**: the server (tsx watch) restarts and the Vite client HMRs; mismatch of generators breaks map sync silently (different mazes, pickups that "don't exist").
- **Determinism**: don't use `Math.random()` inside shared generators; use a seeded rng (`mulberry32` is a local function in maze.ts and pools.ts; `rng` in missions.ts). Don't add consumption of the generator's random stream in the middle of `generateMaze` (that reshuffles all existing maps); helpers like `waterSpots/totemSpot/radarSpot` deliberately use hashes and do not consume the stream.
- **Float32Array comparisons** in pool maps: compare `ceil >= PY.tall - 0.01`, not equality (see `docs/poolrooms.md` section 11).
- Item ids by first letter are a protocol (`GAIN` map in server, `Items`/`PoolLevel.onTake` in client). New pickup kind -> update all three.
- Shop/inventory fields exist in 4 places: `Inventory` + helpers (`missions.ts`), `SHOP`, `HOT` (quickslots), client `Player.inventory/receive`, and UI `Inventory.tsx`/`invIcons.ts`.
- Dev shortcuts (`?god`, `?seed=`, `?pool`, `?poolmap`, `?runlevel`, `?low`, `?nopar`, `?totem`, `?reduced`, `window.__game`, `__pool`, `__maze`) only exist when `DEV_LOCAL`; they vanish in production builds and over tunnels.
- Code comments and UI strings: comments Spanish, in-game UI text English UPPERCASE; keep that style.
- Don't commit `server/data/`, `assets-src/`, `*.zip` (gitignored). `workflow/` is the owner's tooling clone, gitignored.

## 6. Persistence

- Accounts/progress only: SQLite (`node:sqlite`) at `server/data/backrooms.db` (or env `DB_PATH`): `users`, `sessions` (hash only), `achievements`, `stats`, `loadout`, `avatars` (blob). Migrations are the `MIGRATIONS` array in `db.ts` (append only; version = `PRAGMA user_version`).
- Everything else (rooms, bank, inventories, matches) is in server memory and lost on restart. Inventory persists across rounds within a room, not across rooms. Guests persist nothing.
- Client: `localStorage` `br-settings`; legacy achievements importable via `POST /api/import` if env `LEGACY_IMPORT=1`.

## 7. Build, run, ports, env

| Command | What |
|---|---|
| `npm install` (root) | installs all workspaces |
| `python tools/build.py` (= `npm run dev`) | dev: Vite client `http://localhost:5180` + `tsx watch` server `:5181`; refuses if a port is busy |
| `python tools/build.py release` | `vite build` + `vite preview` (5180) + server `tsx` (no watch) |
| `python tools/build.py --build` | production client build (`client/dist`) |
| `python tools/build.py --check` (= `npm run typecheck`) | `tsc --noEmit` client and server (shared is covered through them) |
| `npm run dev -w server` / `-w client` | each alone |
| `python tools/pack_glb.py --max 512` | compress a model before adding to `client/public/models` |

Vite proxies `/socket.io` (ws), `/status`, `/api` to `localhost:${SERVER_PORT||5181}`. Client env: `VITE_SERVER_URL` (deployed server URL; default = same origin). Server env: `PORT`, `CLIENT_ORIGIN` (comma list; strict CORS/CSRF when set), `COOKIE_CROSS_SITE=1`, `TRUST_PROXY=n`, `NODE_ENV=production`, `DB_PATH`, `MAINTENANCE=1`/`MAINTENANCE_MSG`/`MAINTENANCE_AT`/`MAINTENANCE_FILE`, `LEGACY_IMPORT=1`. Hosting plan (DESIGN.md): client on Vercel, server on a long-lived Node host (Render/Oracle/Cloudflare tunnel); WebSockets need a non-serverless host.

## 8. How to dev-test

- Typecheck is the main automated check (`--check`); there are no test suites (owner convention: none unless asked).
- Single-player sandboxes (dev only, localhost): `/?pool` water test room; `/?poolmap&seed=N` full Poolrooms level without server (`devPool(true)`); `/?runlevel` hospital run; `/?seed=N` level0 solo without room (add `&god`, `&totem`, `&low`, `&reduced`); `/?grips` hand/accessory tuning tool (saves `grips.json`/`pieces.json` through dev-only `POST /__grips`, localhost only).
- Console handles: `window.__game` (BackroomsGame: `netInfo()`, `adminSolo`, `adminCheat`, ...), `window.__pool` (PoolLevel/PoolTest: e.g. `__pool.splash(x, z, 1.5)`), `__maze(seed)` prints ASCII map.
- Multiplayer test: open two browser tabs/profiles on `localhost:5180`, create a room in one, join by code in the other; admin console needs an account named `s7lver` (backtick/F9) for `level`, `tp`, `give`, `money`, `ent`, etc. Admin `level` forces any level/seed.
- Perf: `renderer.info`, `Hud` FPS toggle in settings, `adminPerf('ao'|'smaa'|'sun')`.
- Browser verification is possible via the Vite dev client only; WebGL needed.
