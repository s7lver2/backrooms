# Backrooms

Co-op (2-4 players) multiplayer Backrooms horror game. Monorepo (npm workspaces): `shared/` (pure seeded game logic and protocol types), `server/` (Node + Socket.IO, authoritative), `client/` (Vite + React + Three.js).

Install Git LFS before cloning or building the Habitable Zone. In an existing clone, run `git lfs install` and `git lfs pull` to download the models and textures. Build and deployment checkouts need LFS assets too.

The staged-file guard and the LFS upload hook are installed by lefthook on `npm install` (see "Git hooks" below); the legacy `.githooks/` folder is only needed if you do not use lefthook, and `core.hooksPath` must then stay unset. The guard rejects ignored files and ordinary Git blobs larger than 5 MiB. Keep local screenshots and raw asset sources in ignored folders. For new required binaries outside the existing LFS patterns, run `git lfs track` for the asset path before staging it, and stage `.gitattributes` with it.

```
npm install
python tools/build.py            # dev: client http://localhost:5180, server :5181
python tools/build.py --check    # typecheck
python tools/build.py --build    # production client build
```

## Working here (read this first, agents and humans)

**Owner rules (they override defaults).** Simplest solution that works (no new dependency unless it clearly pays for itself). **No tests** unless asked. **One commit per finished feature**, no intermediate commits, **never push** unless told. Code comments in Spanish, in-game text English UPPERCASE, UI replies to the owner in Spanish. Design tasks: propose 2-3 directions before building; no generic "AI slop" UI. At most 2 subagents at once. Do not open the browser for routine checks, only to reproduce or verify something visual. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `git checkout`/`reset` files you did not change: the owner or another agent may be editing at the same time.

**Stack.** TypeScript everywhere. Client: Vite 7, React 18 (UI only; the game itself is plain three.js 0.160 with `WebGLRenderer` + `EffectComposer`: bloom, film, VHS), gsap, socket.io-client. Server: Node 22 + Express + Socket.IO + better-sqlite3 + JWT. `shared/`: pure, seeded logic (maps, missions, entity sim `EntitySim`) that runs identically on client and server. Windows 11 is the dev machine (use PowerShell/Git Bash syntax accordingly).

**Commands.**

```
python tools/build.py --check    # typecheck client + server (= npm run typecheck); must pass before any commit
npm run lint                     # Biome linter (formatter is OFF on purpose; ~140 old warnings, do not "fix them all")
npm run check:glb                # audit every .glb (materials, bones, textures, height); informative, never blocks
python tools/pack_glb.py --max 512   # compress a model before adding it (credit it in client/public/models/CREDITS.md)
```

**Git hooks.** `npm install` runs `lefthook install`: pre-commit runs `tools/check_staged_files.py` (rejects ignored files and plain blobs > 5 MiB), `biome lint --staged` and the typecheck. Never use `--no-verify`; fix what blocks. Do not also set `core.hooksPath` (it would bypass lefthook). Models and textures are Git LFS: `git lfs install && git lfs pull`.

**Dev routes (only on `localhost` with the Vite dev server, see `client/src/devGate.ts`; they vanish in production builds).** `window.__game` is the live game in the console.

| URL | What it does |
|---|---|
| `/?suites&god&seed=944362207` | straight into Las Suites (level -20), solo, god mode, fixed seed (the usual perf/test route) |
| `/?pool` , `/?poolmap` , `/?parking` , `/?runlevel` | Poolrooms, its map, Habitable Zone preview, "Run for your life" |
| `/?seed=N` | fixed maze seed (solo) |
| `/?debug` | live tuning panel (lil-gui): hemisphere/flashlight light, fog, bloom, VHS, "copy JSON" (`client/src/game/debugPanel.ts`) |
| `/?mapviewer&seed=N&level=level0\|suites\|poolrooms[&floor=N]` | 2D view of the generated map (`client/src/dev/MapViewer`) |
| `/?anim` | animation/IK studio (see [ANIMATION.md](docs/ANIMATION.md)) |
| `/?terms` | shows the terms-of-service screen (skipped in local dev otherwise) |
| `&low` | force low quality |

In the in-app browser: give the pane a viewport first (a hidden/0-size canvas makes the game fail to load), and the game pauses on focus loss (`__game.paused = false`). Console helpers: `__game.adminDiag()` (GPU, canvas, counters), `__game.stateHash()` (map/entity hashes), `__game.adminInfo()`.

**Terms and error reports.** `client/src/Terms.tsx` shows the terms of service before the game; acceptance is stored in `localStorage` (`br-consent`, versioned by `TERMS_VERSION` in `consent.ts`: bump it when the text changes). Error reports are a separate optional checkbox. `client/src/telemetry.ts` sends them to GlitchTip (Sentry-compatible) **only** if `VITE_SENTRY_DSN` is set in `client/.env` and the player opted in; no PII, no breadcrumbs, context = level/floor/seed/position (`Game.crashContext()`). The legal text is a base draft: have it reviewed before publishing.

**Performance: what you must know.** The game is **CPU-bound by draw-call submission** (~26 us per draw, ~6 GL calls each), not by GPU or resolution. Level -20 (Las Suites) is the hardest case; the target is 120-180 fps and ~150-200 draw calls (it was ~876 in the lobby, now ~330). Measure draw calls (`renderer.info.render.calls`) before and after any render change. Techniques already in place and **not to be undone** are listed with reasons in [DECISIONES.md](docs/DECISIONES.md): mesh fusing per material (`fuse.ts`), `InstancedMesh` for repeated decor, room/distance culling (`cullRoom`, `PROP_FAR`, `farObjs`, `levelObjs`), reflector at 256 px every 3rd frame, baked lightmaps (`lightmap.ts`, patch handles only `USE_INSTANCING`, not `BatchedMesh`), capped dynamic lights (pool of 3 point lights in `vents.ts`), `shadowMap.autoUpdate` tied to the flashlight, CPU-aware dynamic resolution. Do **not** toggle `shadowMap.enabled`/`castShadow` at runtime (triggers multi-second shader recompiles). Remaining work: skinned Faceling meshes (~20 draws each), exit signs, door leaf + plates (unique canvas materials), cameras, handrails; `BatchedMesh` needs three >= r187. Studies: [CPU/performance tools report](docs/Backrooms%20herramientas%20y%20paquetes%20para%20bajar%20la%20CPU%20del%20nivel%20-20.md) and [dev tools report](docs/Backrooms_herramientas_desarrollo_informe.md). Known environment issue: some machines cap at ~85 fps because the OS refresh rate is not 180 Hz (check with an empty `requestAnimationFrame` loop before blaming the game).

**Las Suites (level -20) specifics.** Hotel with a repeating hallway, suites with doors, Facelings (staff). Rules implemented: caution tape item disabled there (`Player.noCaution`, not sold by the Faceling); power switches ("power switch" pickups, `gens`) need holding **G** for 1.5 s (`GEN_HOLD` in `pickups.ts`); a Faceling that is shot and survives becomes enraged, and killing one enrages all (`EntitySim.hit/rage` in `shared/src/sim.ts`). Design: [suites.md](docs/suites.md).

**Determinism.** `shared/` must not use `Math.random`/`Date.now` for anything that has to match across client and server (a Biome GritQL rule warns in `shared/src`). Known violations: `EntitySim` AI (11 sites) and `parking-smiler-ai.ts`; entities are server-driven and sent as snapshots, so only the **map** hash is compared (`ready(true, hash)` -> server logs `[desync]`). A real entity desync check would need a seeded RNG in `EntitySim`.

**Gotchas collected the hard way.**
- Fused meshes: only static models go through `fuse`/`fuseAll`; never skinned or animated ones.
- Anything placed in a Las Suites room must be registered with `world.cullRoom(obj, x, z)` (or it renders through closed doors); dropped items already do it via `Pickups.onPut`.
- Vite HMR: editing `game.ts` or what it imports reloads the whole page on purpose (`main.tsx` unmounts React in `hot.dispose`); do not "fix" it.
- Test credentials/seeds: use the dev routes above, never real accounts.
- Docs and repo language: docs in English/Spanish mixed; keep new docs in the language of the file you edit.

Documentation index: [docs/README.md](docs/README.md) (architecture, spec/protocol, glossary, contributor guide for LLMs).

| Doc | Content |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | layout, file roles, data flow, authority model, persistence, build/dev/test, gotchas |
| [ANIMATION.md](docs/ANIMATION.md) | animation system: pack, blend tree, dances, variants, IK stack, `?anim` tool |
| [SPEC.md](docs/SPEC.md) | game rules, constants, levels, missions, economy, death/revive, admin, socket/HTTP protocol |
| [GLOSSARY.md](docs/GLOSSARY.md) | terms (EN/ES) mapped to code |
| [CONTRIBUTING-LLM.md](docs/CONTRIBUTING-LLM.md) | how to add item/level/mission/entity/event/achievement, checklist, don'ts |
| [level-caps.md](docs/level-caps.md) | `LevelCaps`: per-level component switches |
| [shader-cache-escritorio.md](docs/shader-cache-escritorio.md) | why there is no persistent shader cache on the web, the SHADER WARM-UP setting, and the future desktop-app plan (Spanish) |
| [Habitable Zone](docs/spec-habitable-zone.md) | Parking layout, missions, entities, and escape |
| [poolrooms.md](docs/poolrooms.md) | Poolrooms design and implemented mechanics (sections 10-11 = current state) |
| [spec-fase1-multijugador.md](docs/spec-fase1-multijugador.md), [spec-fase2-sala-de-espera.md](docs/spec-fase2-sala-de-espera.md), [spec-fase3-cuentas.md](docs/spec-fase3-cuentas.md), [spec-lobby-pulido.md](docs/spec-lobby-pulido.md), [spec-mapa-abierto-escondites.md](docs/spec-mapa-abierto-escondites.md) | historical phase specs (Spanish); may lag the code |
| [../DESIGN.md](DESIGN.md), [../ROADMAP.md](ROADMAP.md) | design decisions and idea backlog (Spanish) |

Conventions in one line: code comments Spanish, in-game text English UPPERCASE, shared code pure and seeded, server authoritative, no tests unless asked, one commit per feature.

## Asset credits

Model authors, source links, licences, and modification notes are listed in [Model credits](client/public/models/CREDITS.md) and [Habitable Zone licences](client/public/models/parking/LICENSES.txt).

The generator is based on [Small Electric Generator](https://sketchfab.com/3d-models/small-electric-generator-9bace223c69e4f4bb0e138b0d379ae37) by [H10_Official](https://sketchfab.com/H10_Official), licensed under [CC-BY-ND-4.0](https://creativecommons.org/licenses/by-nd/4.0/). The original model files are retained unchanged; the bundled licence is in [generator-original/license.txt](client/public/models/parking/generator-original/license.txt).

Parking surface materials: [Concrete Floor Worn 001](https://polyhaven.com/a/concrete_floor_worn_001), [Garage Floor](https://polyhaven.com/a/garage_floor), and [Concrete Wall 008](https://polyhaven.com/a/concrete_wall_008) from Poly Haven, CC0. Runtime files are 2K WebP base colour, OpenGL normal and roughness maps (`parking/textures/<asset>-{diff,nor_gl,rough}.webp`); base colour is sRGB and data maps are linear. Credits are documentation-only.

Additional parking props use the [damaged trash can](https://sketchfab.com/3d-models/realistic-trash-can-damaged-lowpoly-free-1f124d5de6364378bb937d5bf7c9da6d) by Carlbon 3D, [Roadsign & Cones Pack](https://sketchfab.com/3d-models/roadsign-cones-pack-6cce13f3eb3946a9bbae864c3343326d) by kris vidotto, [Weathered Concrete Barriers](https://sketchfab.com/3d-models/weathered-concrete-barriers-58b198cf6f054a68882852924c6a2a2c) by Guy in a Poncho, and [emergency light](https://sketchfab.com/3d-models/low-poly-exit-sign-emergency-light-3d-model-fdbada9b16c4448c9fc6377a8e6b271d) by KenVeel, all CC-BY-4.0. Component selection, metre scaling, 2K WebP textures and meshopt compression are documented in [model credits](client/public/models/CREDITS.md).

Parking room storage reuses [Metal School Lockers](https://sketchfab.com/3d-models/metal-school-lockers-7f1460adacd346a4a68c3e5f7a5d0d43) by Zixel; the prepared library also retains the [Abandoned Building kit](https://sketchfab.com/3d-models/abandoned-building-modular-environment-kit-376aead6cd3d41bda715cbab99c440fa) by olegolegperepelica (CC-BY-4.0). Selected columns from [Basement Parking Garage Environment Underground](https://sketchfab.com/3d-models/basement-parking-garage-environment-underground-1ce0cc998a654a408d25832ab620a5d1) by PolyNeast use the supplied Sketchfab Standard licence. The current utility doors are built as painted steel assemblies in code. Extraction, hinge preparation, scaling and texture changes are documented in [model credits](client/public/models/CREDITS.md).

Parking ground now uses [Asphalt 02](https://polyhaven.com/a/asphalt_02) by Rob Tuytel (Poly Haven, CC0), at a 3 m repeat with 2K base colour, OpenGL normals and roughness. Roughness is remapped to a matte range; ground specular, environment contribution and clearcoat are disabled. White bay lines are generated-alpha projected decals; ground reflections and the floor paint-mask path were removed.

The supplied [Generator LP](https://sketchfab.com/3d-models/generator-lp-9127ac84a3c84d56be6e3993ed350eff) by YoeriBervoets (CC-BY-4.0) has been prepared at 1.4 m height with 2K WebP and meshopt. The local generator preview now supports an uninterrupted eight-second E hold, circular progress, permanent activation and whole-floor lighting restoration. It is not connected to server missions. The previous ND generator remains unchanged as an archive, rather than the runtime model.
Parking preview atmosphere adds bounded mist/light shafts, dust, drips and restrained wall damage with reduced low-quality budgets. Safe-room interaction raycasts filter floors and nearby bounds before detailed mesh tests; local CPU timings are visible in its dev HUD.

The solo parking preview supports all three elevator objectives. Collect eight VHS tapes with E, hold E for eight seconds at each of five generators, one per floor, or survive the selected five-, ten-, or fifteen-minute timer. After the objective unlocks the hidden elevator, press E at its doors and walk into the cabin to finish.

START LOCAL ROUND enables the survival clock and solo entities. Skinwalker disguises use the saved solo or guest appearance. Pausing stops the survival clock. RETRY ENCOUNTER keeps collected tapes and generator repairs and restarts survival from the selected duration. Mission and entity progress are local to the preview.

Smilers use the supplied close-up face PNG over dark smoke. Unbroken sight within 8 m builds a screen glitch each second and becomes lethal at 10 seconds. A valid flashlight beam or a break in sight resets the stare.

Local encounter balance: one active Smiler maximum, first spawn attempt at 20 seconds, later attempts 30–45 seconds apart and a 75-second section cooldown. Skinwalker sight is 12 m. It walks for the first second after spotting a player, then runs within 5 m, and completed transformation grants a three-second stationary recovery window before pursuit or damage. Losing the player triggers a seven-second search before returning to disguise.


### Smiler

`parking/smiler.glb` is adapted from **Accurate Smiler Backrooms Blender 3.22** by **ultramirage10**, licensed under **CC-BY-4.0**. Source: https://sketchfab.com/3d-models/accurate-smiler-backrooms-blender-322-902975161a7047baa5cda8fb7b5a292e — author: https://sketchfab.com/ultramirage10 — license: https://creativecommons.org/licenses/by/4.0/ . Changes: baked static bind pose, centered/oriented/rescaled, narrowed and elongated individual teeth, compressed GLB; runtime omits black pupil pieces and adds glow, chromatic fringes and smoke. Original archive is preserved.

### Habitable Zone items

These models use [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The game bundles them as GLBs with textures reduced to a maximum of 1024 pixels per side.

- X-Ray Glasses use [Glasses (Rose) – Character Items (Free)](https://sketchfab.com/3d-models/glasses-rose-character-items-free-75fd5330df9c4cb28a183931493c19e3) by [CT Reed](https://sketchfab.com/continuumreed).
- Pills use [Pill Bottle](https://sketchfab.com/3d-models/pill-bottle-c5bfdf003ead4c4793f4e9b93a9b1b79) by [stfuaahil](https://sketchfab.com/stfuaahil).
- Steel Card uses [Steel Card](https://sketchfab.com/3d-models/steel-card-b384c4e6c28346efb4f8419afa86b98d) by [Nothing Works Studio](https://sketchfab.com/Dark_Matrix).
- Beer Bottle uses [Beer Bottle](https://sketchfab.com/3d-models/beer-bottle-c3de7f8b092e4092aef14d4ffc9fac7f) by [gelmi.com.br](https://sketchfab.com/rodrigogelmi).
