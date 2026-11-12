# Backrooms

Co-op (2-4 players) multiplayer Backrooms horror game. Monorepo (npm workspaces): `shared/` (pure seeded game logic and protocol types), `server/` (Node + Socket.IO, authoritative), `client/` (Vite + React + Three.js).

Install Git LFS before cloning or building the Habitable Zone. In an existing clone, run `git lfs install` and `git lfs pull` to download the models and textures. Build and deployment checkouts need LFS assets too.

Run `git config --local core.hooksPath .githooks` once per clone to enable the staged-file guard and the LFS upload hook. The guard rejects ignored files and ordinary Git blobs larger than 5 MiB. Keep local screenshots and raw asset sources in ignored folders. For new required binaries outside the existing LFS patterns, run `git lfs track` for the asset path before staging it, and stage `.gitattributes` with it.

```
npm install
python tools/build.py            # dev: client http://localhost:5180, server :5181
python tools/build.py --check    # typecheck
python tools/build.py --build    # production client build
```

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
