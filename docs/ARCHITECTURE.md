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
| `game/rig.ts`, `ik.ts`, `cosmetics.ts`, `grips.ts` + `grips.json`, `pieces.json` | Mixamo rig, arm IK, hats/backpacks, hand grips and accessory fit data (edited via dev tool `/?anim`, IK tab, `client/src/dev/anim/Grips.tsx`) |
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
- Single-player sandboxes (dev only, localhost): `/?pool` water test room; `/?poolmap&seed=N` full Poolrooms level without server (`devPool(true)`); `/?runlevel` hospital run; `/?seed=N` level0 solo without room (add `&god`, `&totem`, `&low`, `&reduced`); `/?anim` studio (IK tab: hand grips, hats/backpacks, tank; saves `grips.json`/`pieces.json`/`worn.json` through dev-only `POST /__grips`, localhost only).
- Console handles: `window.__game` (BackroomsGame: `netInfo()`, `adminSolo`, `adminCheat`, ...), `window.__pool` (PoolLevel/PoolTest: e.g. `__pool.splash(x, z, 1.5)`), `__maze(seed)` prints ASCII map.
- Multiplayer test: open two browser tabs/profiles on `localhost:5180`, create a room in one, join by code in the other; admin console needs an account named `s7lver` (backtick/F9) for `level`, `tp`, `give`, `money`, `ent`, etc. Admin `level` forces any level/seed.
- Perf: `renderer.info`, `Hud` FPS toggle in settings, `adminPerf('ao'|'smaa'|'sun')`.
- Browser verification is possible via the Vite dev client only; WebGL needed.

## 9. Habitable Zone

- `shared/src/parking.ts`: seeded, metre-based multi-floor parking contract, 90 m base footprints with short 9–18 m wall islands and broken service facades, mission-dependent floor counts and safe-room placement, a wall-flush elevator randomly below the entry floor with reserved clearance, objective positions, walking surfaces/collision, and a navigation graph with explicit ramp/stair edges. Parameters include mission and survival duration; these must be finalized before generation when multiplayer integration is added.
- `client/src/game/parking.ts`: parking scene, prepared-model instances, concrete materials, fixed-budget nearby lights, fixture flicker, dust and one active-floor puddle reflection. Decks use 65 cm closed slabs with counterwound cutouts. Each upper deck owns the shared ceiling; only uncovered shifted footprints receive ceiling infill. Connectors have closed sloped floors and roofs with 2.65 m clearance, enclosed inside full-height architectural cores with trimmed entry/exit portals; incoming lower slabs remain inside the closed core. One concrete palette covers every deck; connector openings are excluded from beams and puddles. Measured pipe/duct modules form continuous closed runs with caps, elbows and ceiling supports, batched per floor. New cone/barrier/trash props occupy free painted bays. Emergency lights mark connector portals. Generator originals load only for the generator profile.
- A signed-in admin can launch **The Habitable Zone** from **F9 → World** in a public or private room. The usual room vote selects the mission. Survival duration is generated with the mission offer from the room seed.
- `server/src/parking-match.ts` validates movement, interactions, generator repairs and boarding, and runs the shared Skinwalker and Smiler AI. `client/src/game/parking-round.ts` renders the shared state with the main engine's player, inventory, mission HUD and elevator. E interacts and holds to activate generators, Tab opens the inventory, and F toggles the flashlight.
- `client/public/models/parking/catalog.json` and its README document prepared kits and existing-model reuse. `generator-original/` retains the downloaded glTF/buffer/textures/licence byte-for-byte, without optimization. Credits belong in root README/model documentation, not in the game overlay.

Parking interactions: `ParkingLevel.fits` supplies room-door progress to shared `parkingFits` and applies locker-leaf collision. Shared generation/navigation omit optional dynamic door state and describe potential open passages. Closure sweeps reject the player. Center-view ray hits within 2.25 m drive interactions. Locker loot uses shared item limits and goes into the player inventory. Safe-room membership is geometric and independent of door position. Static room meshes and locker bodies are batched per deck, and dynamic leaves and collectible items retain their interaction targets.

Parking visual fit revision: utility leaves are code-built beveled steel, with a continuous rebated jamb, 4 mm side/head clearances and 4–5 mm bottom clearance; 1 mm room floor finish avoids a raised slab intersecting the swing. Locker closed geometry is fitted to its body, retaining original vents/lock/handle; its fixed parent hinge is now (0.207,0,0.219) m. White upper column faces use the wall concrete with metric UVs and the lower striped skin stops at the same join. Scene fog is linear from 10 to 38 m and the reflector explicitly uses the same fog chunks/uniforms. Camera range is 48 m, exposure 1.0 and flashlight intensity 12 to preserve near material detail. Maintenance cabinets mount by their measured back face; chests sit on 0.75 m benches below them. FOG, DOOR-SIDE and LOCKER-SIDE inspection views support repeatable QA. No shared layout or generation parameters changed in this revision.

Parking assembly/clearance revision: pillar components are normalized together, preserving the upper concrete start at 1.195408 m and extending the top to 3.56 m (10 mm into the ceiling). `parkingWorkbench` mirrors the bench footprint with the room direction and is shared by renderer and collision. `parkingArea` assigns stable west-to-east A/B/C sectors within each floor; signs show numeric floor and area letter, matching HUD. Paint is a deduplicated set of upward planes on shared 3 m bay boundaries with back caps, constant depth units and no vertical/bottom faces. Floor concrete repeats every 3 m. Fog is now 6–26 m, camera clip range 0.12–40 m. PAINT targets a shallow row-edge regression view; PILLAR frames the whole column; ROOM-IN alternates room handedness for inspection.

Current parking material pass supersedes earlier wet-concrete notes: ground is dry nonreflective Poly Haven Asphalt 02 at 3 m UV repeat, MeshPhysicalMaterial roughness 1 with remapped >=0.95 roughness data and specular/environment/clearcoat zero. Reflector and paint-mask code are removed. DecalGeometry projects each deduplicated bay stroke onto the actual deck; only top-facing nondegenerate triangles remain, offset 0.5 mm with constant depth units, alpha texture and depth testing. The ASPHALT/PAINT inspection views cover near aggregate and grazing paint. Generator model preparation is retained, while repair gameplay/UI remains paused by user steering; it is not connected or verified as a delivered objective system.

Current structural/material correction supersedes previous decal and signage notes: FLOOR is alphabetic (A...) and AREA numeric (01...03). Signs use 512x768 enamel graphics, physical backing and restrained coat response. Asphalt remains nonreflective; wall, slab underside/cut edge, ceiling and ramp-roof concrete uses metric UVs at 2.71m repeat. Asphalt belongs only to upward driving caps. Decals remain actual DecalGeometry projections: disjoint stroke coverage, short-axis worn-alpha mapping, 2.5mm surface offset, bounded slope bias, alpha-tested depth-writing coverage, roughness .78/specular .12. No Reflector returned. The repeated dark serrated strip was a separate structural overlap: lower perimeter walls extended 4.2m to the upper floor top. Their height is now 3.55m, ending at the slab underside instead. PAINT-SCAN uses wall-clock sampling and displays actual depth bits. Generator gameplay remains paused.

Parking atmosphere/performance revision: interaction queries use a cached per-mesh/per-instance index and reject other floors, distant bounds and ray misses before nearest-surface mesh tests. Settled hinge transforms and hidden-floor tube uploads are skipped. Per-room interiors cull past18m within20m fog; nearby door/window views remain visible. The dev HUD reports CPU UPDATE/FOCUS/SUBMIT (submission is not GPU time) and detailed raycasts/candidates.

parking-atmosphere.ts owns a fixed pool of bounded noisy raymarched mist, soft fixture shafts, drips and matte impact rings. Normal budget:3volumes x10samples,3shafts,8drips. Low:1volume x4samples,1shaft,3drips. Anchors exclude walls, rooms, columns, cars, furniture, props and openings. Depth-tested mist stays below slabs and is disabled inside safe rooms. No fullscreen render target, Reflector or extra dynamic light. Rough concrete spall/fractures decorate about22% of eligible long wall sections, with tiny grounded fragments and occasional fallen unlit fixtures. This changes presentation, not navigation. ATMOSPHERE/DAMAGE inspection controls support QA. Generator gameplay remains paused.

Parking fixture lighting revision: parking-lighting.ts supplies deterministic per-fixture brightness and fault events. Most tubes remain steady; a seeded minority has irregular short double blinks or rare sub-0.75s dropouts on15-28s cycles. Room fixtures stay steady. The real named central tube pCylinder30_lambert1_0, local point pool and shaft uniform share one output value; mist/dust retain ambient visibility. Neutral/cool parking lights and slightly warmer room fixtures replace the lime cast. Four point slots keep assignments while relevant, fade to zero before repositioning and fade in; selection is cached every0.2s or after1m/floor movement, with room ownership and wall-segment rejection. No extra light/shadow pass. LIGHTING alternates fault-prone/steady fixtures and reports actual state/next event; its blink clock advances independently of clamped movement simulation. Generator gameplay remains paused.


Generator preview resumed: Controls adds optional bagHeld without changing the E pulse. In the generator profile, eight uninterrupted visible wall-clock seconds of close center-ray focus activate a generator permanently; release, range/look loss, blur or tab hiding resets incomplete progress. Circular progress and a local0/5counter are shown; GENERATOR cycles valid close inspections and HOLD REPAIR uses the same checked interaction as E. Before power, parking fixtures are off and safe-room fixtures supply dim emergency light. A Set of powered floors restores all fixtures steadily only on the activated generator's owning floor. Multiple generators on that floor still count separately toward five/elevator unlock. No enemies, server replication or active networked mission were added. This supersedes earlier paused-generator notes.


Skinwalker first playable local round: START LOCAL ROUND opts into one initial entity per floor; inspection alone remains enemy-free. ParkingSkinAI uses the existing multi-floor collision-sampled graph with A*, room/unsafe-edge exclusion, fixed50ms movement and actual mesh LOS from ParkingLevel. Disguises approach/run, transform only within3m with a1.15s readable crossfade/particles, and become a faster beast; measured speeds1.6/5.1/5.82m/s remain below player sprint6. Beam exposure affects only transformation/beast, locks the revealed form, refreshes3s retreat and attack immunity. Last-seen snapshots/search expire without learning hidden player positions. Dim routes cost less; footsteps/flashlight attention uses existing visible movement/beam state (no puddle events on dry asphalt). Safe rooms are permanently excluded; an occupied room adds exterior stand-off and cannot receive attacks.

Rendering reuses Rig, Cosmetics, hazmat and prepared animated skinwalker.glb. The solo account loadout or saved guest Look supplies tint/head/back; there is no multiplayer roster copy/network AI. Far rigs cull beyond fog distance, all forms initialize idle poses, per-actor fade materials are cloned, and retry disposes mixers, owned materials, VFX and cloned skeleton textures. Escape/blur/hidden tab pauses. RETRY ENCOUNTER resets local health/entities and returns to spawn while deliberately preserving generator progress, floor power, doors and storage. Existing generator interaction remains available during an active round. Encounter inspections move only the camera/player to valid existing entities, with explicit debug state cleared on ordinary play/resume.


Smilers now join the opt-in local entity round. No suitable asset existed; the renderer authors fogged/depth-tested round eyes, tooth-gapped grin and a soft dark veil without a body, extra lights or fullscreen pass. The three existing numbered areas per floor are occupancy sections, with at most one Smiler each and current-floor budgets3normal/2low. Old-floor entities release their budget into20s cooldown. Spawns require distance>11m, collision clearance, safe-room exclusion and actual normalized illumination<=.045. The illumination query uses live per-ID fixture state and generator power, cached static wall/room light occlusion, and remains independent of the four moving light slots or stale non-current-floor output arrays. Powered floors can retain genuinely unlit pockets.

Smilers watch, give a readable windup, then move quickly only over sampled dark navigation edges and0.08m collision/darkness substeps. Loud sprint noise can provoke them. Beam contact freezes immediately; interruption resets exposure and1.5continuous seconds removes the entity with20s section cooldown. Restored ceiling illumination at its position also removes it. Safe rooms and lit targets cannot be attacked. Both entity types share one health/immunity gate; pause/death/retry behavior is unchanged. SMILER/SMILER-NEAR inspect existing natural spawns only, showing debug darkness/exposure/cooldown; normal play has no entity labels.
