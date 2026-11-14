# SPEC: what the game is, rules, numbers, protocol

Source of truth is code; every constant below names its file. Items marked *(unverified)* were inferred, not confirmed by reading code. Code comments are mostly Spanish; docs are English.

## 1. What it is

Co-op (2-4 players) first-person horror in procedurally generated "Backrooms" levels. Server-authoritative (Node + Socket.IO), client in Three.js + React. Players meet in a 3D waiting room, the owner starts a round, the team votes one of 3 missions, plays the level, and returns via an elevator to collect money. Money buys items between rounds. Accounts (optional) persist achievements and cosmetics.

Round loop: `lobby` -> (owner presses START) `starting` (door opens, 7.5 s; then 15 s mission vote while every client loads the level) -> `playing` -> `over` (instant back to `lobby`, round++).

## 2. Phases and timings (`shared/src/index.ts`, `server/src/index.ts`)

| Phase | Meaning | Constants |
|---|---|---|
| `lobby` | waiting room, shop, settings, chat, emotes | positions clamped to `WAIT_HALF` 6x5 m box |
| `starting` | door animation then vote | `START_DELAY` 7500 ms; `VOTE_TIME` 15000 ms (shortened to 1.5 s once all voted); `LOAD_GRACE` 12000 ms extra wait for slow loaders; clients send `ready(true)` when level loaded |
| `playing` | the level | AI tick 20 Hz, players broadcast 15 Hz (volatile), world 10 Hz (volatile) |
| `over` | transient: payout computed, then `backToLobby` | if nobody boarded, defeat is delayed 5 s |

Round ends (`checkOver`) when nobody alive remains un-boarded, or `ASCENT_GRACE` 25 s after the first player boarded. Joining is only allowed in `lobby` (`Game in progress` error otherwise). Max players `MAX_PLAYERS` 4 (owner may lower to >= 2 and >= current count). `MAX_ROOMS` 200.

Room code: 5 letters from `ABCDEFGHJKLMNPQRSTUVWXYZ` (no I/O). Owner leaves -> next player in map order becomes owner. Room deleted when empty. State is in server memory only.

## 3. Rooms, settings, voting

- `RoomSettings`: `name` (<= `ROOM_NAME_MAX` 20), `public`, `max`, `difficulty`, `fixedSeed` (0 = random). Only owner, only in `lobby`. Changing `fixedSeed` re-runs `prepare()` (new map + missions).
- Difficulty (`DIFFICULTY`): easy {speed 0.85, grace 16 s, flashlight 140 s}; normal {1, 10, 90}; hard {1.2, 6, 60}. `grace` = seconds after start before entities can see players.
- `prepare(r)` (server) picks `nextSeed` (fixedSeed or random 1..2^31) and `levelId = pickLevel(seed)` (random among `LEVELS` minus `SPECIAL_LEVELS` minus `DEV_LEVELS`), then the 3 mission offers (level0: `offerMissions`; pool: `poolMissions` = survive + soaps only).
- Vote: one vote per socket, `''` removes; ties are drawn at random on close; no votes -> first offer.
- Guests: only free colours (`look` event). Accounts: look comes from DB loadout, re-validated with `lookAllowed`.
- Chat: `CHAT_MAX` 200 chars, `CHAT_GAP` 500 ms. Name <= `NAME_MAX` 16 (accounts use their username).
- Waiting-room emotes `EMOTES` = `['', WAVE, POINT, CLAP, SIT]` keys 1-4, `EMOTE_GAP` 200 ms.

## 4. Missions (`shared/src/missions.ts`)

| kind | text | goal | reward (rounded to 10) | progress source (server `Match.progress`) |
|---|---|---|---|---|
| `photos` | PHOTOGRAPH n ENTITIES | 2-4 | 80+90n | valid photos (camera in hand, entity in 24 deg cone, visible, <= 50 m, once per entity per player, 800 ms gap) |
| `tapes` | FIND n TAPES | 3-6 | 50+60n | ids `t*` picked up |
| `soaps` | FIND n SOAPS | 3-5 | 60+60n | same as tapes (pool: soaps are `tape` items) |
| `survive` | SURVIVE n MINUTES | 4-8 min (seconds in goal) | 40+55n | `floor(elapsed)` |
| `tvs` | TURN OFF n TVS | min(3-5, tv count) | 70+80n | `tvOff.size`; only offered if map has >= 3 CRT props |

Mission done -> `room.mission.done` -> elevator opens. Boarding needs `canBoard` (within 2.5 m of elevator, alive, `r.done`). `TAPES_NEEDED` = 8 tapes exist in the level0 map (the mission asks for 3-6 of them).

## 5. Economy and inventory

| Const | Value | File |
|---|---|---|
| `START_BANK` | 250 per player who joins a fresh room (shared team money) | missions.ts |
| `PENALTY` | 25 % of bank on failed round (`penaltyOf`) | missions.ts |
| Win condition | mission done AND >= 1 player boarded alive -> +reward; else penalty | server `finish` |
| Fates | `back` (boarded alive: keeps inventory), `dead` / `stranded` (inventory reset to `EMPTY_INV`) | server `finish` |
| `START_INV` | 1 spare flashlight | missions.ts |
| `INV_MAX` | spares 6, water 5, totem 2, ammo 8 (2 packs), others boolean | missions.ts |
| `AMMO_PACK` | 4 rounds per ammo pack; the rifle holds `RIFLE_MAG` = 2 (reload every 2 shots); gun purchase / map rifle gives 1 pack; ~4 % of loot spots are loose ammo (`a`). Entities have 3 hp, 1 per shot; misfire `blast` event: shooter dies, 5 m area damage | missions.ts, server `gain` |
| Drops | `DROP_MAX` 6 per player, `DROP_TTL` 300 s, `DROP_GAP` 250 ms, ids `d<n>`; key Y | missions.ts |

Shop (`SHOP`, bought in lobby at the waiting-room computer, money is team-wide, item goes to buyer; 150 ms anti-spam): flashlight 40, camera 250, gun 450, ammo 70, water 90, caution 40, radar 300, tank 250, watergun 150, totem 400. Errors (English strings): `NOT AVAILABLE`, `TOO FAST`, `CANNOT CARRY MORE`, `NOT ENOUGH MONEY`.

Server tracks two inventories per player: `inv` (persists between rounds: shop + what you ascended with) and `cap` (what you may carry this round = inv at start + picked up - dropped). On `ascend(inv)` the server stores `cleanInv(inv, p.cap)`: client-declared inventory is clamped to `cap`.

Item pickup ids by first letter (`GAIN` in server index.ts): `t` tape/soap (counted in progress), `f` flashlight, `w` water can, `m` totem, `r` radar, `c` camera, `g` gun (`g1`.. extra rifles), `k` tank, `p` watergun, `d` dropped. Reach `PICK_REACH` 3.6 m (client 2.4/REACH 1.6 plus slack).

## 6. Player, health, death, revive

- `HP_MAX` 100; entity hit `HIT_DAMAGE` 60 (two hits kill; hit while hiding in a niche = instant death). Almond Water (`drink`) restores HP to 100 (server tracks), stamina, sanity (client).
- Client movement (`player.ts`): WALK 1.6, RUN 3.6 m/s, jump 0.9 m, stamina drains 1/9 s running, refills 1/6 s walking, 1/4 s still; sanity drains in level0 and kills at 0 (`insane` event, only if `caps.insane`).
- Server clamps movement speed: `MAX_SPEED` 6.5 m/s + `MOVE_SLACK` 2 m (admin exempt; a rising `jam` = legit portal teleport, not clamped).
- Death sources: entity (`dead` event), `fell` (y < -1 and `caps.fall`), `insane`, admin kill. Dead players spectate a living teammate's camera (`Hud.spectating`).
- Totem of Life: a living carrier uses `totem(targetId)` on a dead teammate -> `reviving` broadcast -> the dead client plays level "Run for your life" (`runlevel.ts`, simulated entirely client-side) -> `runDone` (server requires >= `REVIVE_MIN` 30 s) or `runFail` (stays dead, one chance). Revive: full HP, `REVIVE_IMMUNE` 3 s immunity, placed 0.7 m beside a living teammate. Totem spawns in ~35 % of seeds (`TOTEM_CHANCE`) and only with >= 2 players, level0 only (`caps.ents`).
- Round end resets: dead=false, hp, water, totem, ready, position to `waitSpot(i)`.

## 7. Entities (level0 only; `shared/src/sim.ts`, painted by `client/src/game/entity.ts`)

Two kinds: `bacteria` (height 3), `partygoer` (2.2). One of each at start (`maze.spawns`). States `wander|chase|attack|dance|dead|inspect`. Constants: WANDER 1.1 m/s, CHASE 2.9 m/s (faster than walk 1.6, slower than run 3.6), attack REACH 1.2 m, LOSE 4 s, vision cone 50 deg; sight dark 7 m, lit 14 m, torch 20 m, crouching halves; teleport-closer if > 45 route cells away for 30 s (cooldown 70 s). Rifle kill needs `hp` hits (`hit(p, id)`, <= 32 m, one shot per 200 ms, rifle in hand); a kill respawns the other kind at the farthest spawn, +10 % speed (cap 1.2x), +1 hp.
Hiding: wall niches (`maze.hides`); entity within ~3.3 m may "inspect" for 4-5.5 s; hider must hold breath (Space; `Breath` class in sim.ts, server uses 1.2 margin). Caught inspecting = death. `held_breath` achievement on success.

## 8. Levels

Registry: `LEVELS` in `shared/src/missions.ts`; capabilities `LEVEL_CAPS` in `shared/src/caps.ts` (see `docs/level-caps.md`).

| | level0 "THE LOBBY" | poolrooms "LEVEL 37 THE POOLROOMS" |
|---|---|---|
| caps | pool=false, ents=true, fall=true, insane=true, swim=false | pool=true, ents=false, fall=false, insane=false, swim=true |
| Map | `generateMaze(seed, players)` grid 38-60 cells (`CELL` 1.5 m, `HEIGHT` 2.7 m), route target 160-270 cells (7-10 min), zones pits/hall/cubicles/office/shelves, voids (pits), niches, 8 tapes, camera, rifles (1 per 2 players), flashlights, 5 water cans, radar (r0), totem | `generatePools(seed)` 64x64 cells, two floors, pools (water 0/1/2), stairs, tubes, slides, bottomless portal tunnels, windows; `poolMaze(seed)` flattens it into a `Maze` for the server |
| Missions offered | 3 of photos/tapes/survive/(tvs) | survive, soaps |
| Dangers | entities, pits (fall = death), darkness, sanity | oxygen, faint, slow routes; no entities yet |
| Special items | all | diving tank `k0`, water gun `p0` (+ refills at fountains), soaps (tape items, some on pool floors) |
| Client | `World` (world.ts), `lightmap.ts` baked light | `PoolLevel` (poolmap.ts), own render scene, planar `Reflector` water, VHS disabled |

Poolrooms details: oxygen client-side (`O2_SECONDS` 30 s, x2.5 with tank, tank speed x0.85, refill 2.5 s, faint 2.4 s then teleport to last air position, o2 reset 0.35); water gun: `WET_MS` 4000 (speed x0.5), stun after 1200 ms continuous spray (`STUN_MS` 3000, cooldown 6000), reach 6 m, cone 12 deg, only hits teammates, `squirt` capped at ~20 msg/s; radar jammed (`jam` ms, client sets 12000 on portal use, server clamps 0-20000). Full design/mechanics: `docs/poolrooms.md` (sections 10-11 are the implemented ones; 7-9 partly design only).

Special level `runforyourlife` (`SPECIAL_LEVELS`): hospital corridor played by a dead client after a Totem, never in the draw.

## 9. Achievements and cosmetics (`shared/src/progress.ts`)

10 achievements in 4 branches (ESCAPE, COLLECT, SURVIVE, COMBAT), some by counter (`games, escapes, tapes, photos, holds, kills, falls`). Awarded server-side only for accounts (uid > 0) via `award`/`count`; guests accumulate nothing. Cosmetics: slots `color` (12), `head` (5 hats), `back` (1); `need` = achievement key or null (free). Models in `client/public/models/cosmetics/<id>.glb`. Server pushes `achievement(key)` to all sockets of that account.

## 10. Admin console

Account whose username equals `ADMIN_USER` (`s7lver`, `shared/src/progress.ts`; check via `isAdminName`). Opened with backtick or F9 (`client/src/game/Admin.tsx`; tabs PLAYER WORLD ENTITIES ITEMS ROOM DEBUG). Every `admin` socket call re-verifies the session cookie server-side; others get `FORBIDDEN`. Payloads validated by `parseAdmin` (`server/src/admin.ts`, money limit 1,000,000). Actions: `level{id,seed}`, `run`, `lobby`, `kill|revive|heal`, `god`, `ammo`, `tp{start|elevator|player}`, `money{add|set}`, `give`, `mission` (complete), `end{ok}`, `tvs`, `ent{spawn|clear|freeze|thaw}`, `info`. Effects on a client arrive as `adminFx` (`tp|give|heal|ammo`). `t` target: `'me'`, `'all'`, or a socket id.

## 11. Settings (client, `client/src/settings.ts`, localStorage key `br-settings`)

volume, sfx*, ambient*, sens, invertY, vhs*, fov (70), fps, crosshair, reduceMotion*, toggleBreath*, resScale (0.5-1), brightness (0.6-1.6). (*) marked "not applied yet" in source comments; verify before relying. Mobile/touch handled by `Touch.tsx`.

Default controls (`input.ts`): WASD/arrows, Shift run, Space jump (hold = breath), F flashlight, G pick up (hold = refill / peel tape), E inventory, R reload, Q swap hands, X use selected hotbar slot, Y drop, 1-4 hotbar, wheel cycles hotbar, RMB aim camera, LMB fire, C/Ctrl crouch (only "Run for your life"), Esc pause, Enter chat.

## 12. Protocol contract (`shared/src/index.ts`, types `ClientToServer` / `ServerToClient`)

Transport: socket.io, websocket first then polling, `withCredentials` (session cookie `br_sid` identifies the account at handshake). Dev: client origin proxies `/socket.io`, `/api`, `/status` to the server (`client/vite.config.ts`).

### Client -> server

| Event | Payload | Rules / notes |
|---|---|---|
| `create` | `{name, public}`, ack `Joined` | leaves current room; error `Maintenance` / `Server full` |
| `join` | `{code, name}`, ack | errors `No such room`, `Game in progress`, `Room is full` |
| `list` | ack `RoomInfo[]` | public rooms only |
| `settings` | `Partial<RoomSettings>` | owner, lobby only |
| `ready` | boolean | lobby: ready flag (informational); `starting`: "level loaded" |
| `start` | - | owner, lobby |
| `state` | `PlayerState` @ ~15 Hz | trusted only after clamping (see section 6); includes sender clock `t` for interpolation |
| `ping` | ack | RTT |
| `vote` | missionId or `''` | phase `starting`, vote open |
| `buy` | `ItemId`, ack `{ok,error?}` | lobby |
| `pickup` | itemId, ack bool | must be near; first wins; items that don't fit are left on the ground |
| `drop` | `ItemId`, ack bool | playing |
| `hit` | entityId | rifle in hand, range, 200 ms gap |
| `photo` | - | camera in hand |
| `tv` | index, ack | TURN OFF TVS, within `TV_REACH` 2.4 (+1.2 server slack) |
| `drink` | - | needs `cap.water > 0` |
| `totem` / `runDone` / `runFail` | targetId / - / - | see section 6 |
| `fell` / `insane` | - | ignored unless caps allow |
| `ascend` | `Inventory` | mission done, near elevator |
| `strip` / `unstrip` | `pts[]` (x,z pairs, <= `STRIP_PTS` 60, gap >= `STRIP_GAP` 0.4*0.75) / id | max `STRIP_MAX` 4 per player, oldest dropped |
| `squirt` | `{x,z,yaw}` | water gun, ~20/s |
| `look` | colour id | guests only, free colours |
| `chat` | text | |
| `leave` | - | also on `pagehide` |
| `admin` | `AdminAction`, ack `AdminReply` | see section 10 |

### Server -> client

| Event | Payload | When |
|---|---|---|
| `status` | `{maintenance, message, at?}` | connect and on change (also `GET /status`; `maintenance.json` or env `MAINTENANCE=1`) |
| `room` | `RoomView` | on any room change (phase, players, votes, mission progress, bank...) |
| `players` | `Record<id, PlayerState & {name, dead, hp}>` | 15 Hz volatile; lobby and playing; server overrides `hp`, `hiding`, `holding` |
| `world` | `WorldSnapshot` | 10 Hz volatile, playing only |
| `inv` | `Inventory` | join, buy, round start, back to lobby |
| `chat`, `dead`, `over`, `achievement`, `reviving`, `revived`, `runFailed`, `strip`, `unstrip`, `wet`, `adminFx` | see types | |

### Key payloads
- `RoomView = Room & { players: Member[] }`: `code, tape, name, public, ownerId, max, difficulty, fixedSeed, phase, seed, bank, round, levelId, caps, offers[], leading, vote{left,loaded}|null, mission{progress,done,...}|null, ascent{left,boarded}|null`.
- `PlayerState`: `x,y,z,yaw,pitch,anim,light,held('none'|'camera'|'gun'),duck?,tank?,jam?,emote?,hiding?,holding?,t?,hp?`.
- `WorldSnapshot`: `t` (server `Date.now()`), `ents[] {id,kind,x,z,yaw,state,hp,speed}`, `taken[]` ids, `tapes`, `insp?[]` (players being inspected), `drops?[] {id,kind,x,z,by}`, `tvOff?[]`.
- `RoundResult` (`over`): `won, completed, mission, reward, penalty, bank, fates{id: back|dead|stranded}`.

### HTTP (`server/src/auth.ts`, same port as sockets)
`GET /status`, `GET /api/me`, `POST /api/register|login|recover|loadout|import|avatar|avatar-remove|logout`, `GET /api/avatar/<id>`. JSON bodies <= `BODY_MAX` 4096; avatar <= 40 KiB, 128 px, webp/jpeg. Passwords 8-128, argon2id; sessions 30 days sliding, only SHA-256 stored; login attempts rate-limited by IP and user; CSRF = POST JSON + allowed Origin.

## 13. Where numbers live (quick index)

`shared/src/index.ts` (timings, HP, strips, difficulty, wait room), `missions.ts` (money, items, shop, missions), `sim.ts` (entity AI), `caps.ts`, `progress.ts` (accounts/achievements/cosmetics), `server/src/match.ts` (reach limits, wet/stun), `client/src/game/player.ts`, `poolmap.ts` (oxygen etc.).

Noise radii (m, `sim.ts`; entities hear x`hearing`): `NOISE_RUN` 9, `NOISE_SHOT` 30, `NOISE_DROP` 7, `NOISE_PHOTO` 16 (client `snap` event, camera in hand), `NOISE_PICK` 8 (accepted pickup).

- Rifle misfire: client `Items.onMisfire` → `Game.misfire()` (fireball `explosion.ts`, flash, camera ragdoll via `fly`) + socket `blast`; the server kills the shooter, hurts players/entities within 5 m and broadcasts `blastFx` so everyone sees the explosion and the body tumbling (`Remote.launch`).
