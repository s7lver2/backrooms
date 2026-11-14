# Habitable Zone asset library

Prepared assets for the approved level design; the level itself is not implemented by this asset import.

- `catalog.json`: asset URLs, roles, source credits, texture limits, source-unit bounds and named components; includes existing-model reuse paths.
- `LICENSES.txt`: full bundled licences and modification notes. Root `../CREDITS.md` lists attribution links.
- `skinwalker.glb`: one Mixamo rig with `idle`, `walk`, `run`, `attack`, `surprised`, and optional `dance` clips. Root motion is preserved. `surprised` is not a finished transformation animation.
- `car.glb`: extracted static car, centred with feet/wheels on the ground and scaled to 4.5 m long.
- `textures/concrete-*.webp`: repeating concrete base colour, normal, and packed metallic/roughness maps. Base colour is sRGB; data maps are linear.

Load with the existing Three.js GLTFLoader and MeshoptDecoder. WebP and meshopt support are required. Use only the needed kit files; do not preload this entire library for every game mode.

Kits contain multiple alternatives laid out for inspection. Select components by node name and preserve relative transforms for multi-part assemblies. Do not place a whole showroom kit as a single prop. Bounds retain authored source units: particularly the low-poly fluorescent kit needs centimetre-to-metre scaling. Determine architectural module dimensions during placement rather than stretching parts independently.

Normal/roughness maps and transparency are retained. Textures are limited to 512 or 1024 px as listed in the catalog. No blanket geometric decimation was applied; unused geometry and duplicate data were removed before meshopt compression.

Original archives, extracted sources, processing scripts, detailed audit, source previews, and animation preview are under ignored `assets-src/habitable-zone/`. Game dependencies and existing model files were not changed.

`generator-original/`: "Small Electric Generator" by [H10_Official](https://sketchfab.com/H10_Official), [source](https://sketchfab.com/3d-models/small-electric-generator-9bace223c69e4f4bb0e138b0d379ae37), [CC-BY-ND-4.0](https://creativecommons.org/licenses/by-nd/4.0/). Original files are copied unchanged, excluded from optimization, and loaded/placed only for the generator profile. Full bundled licence: [generator-original/license.txt](generator-original/license.txt). Credits appear in documentation, not as an in-game overlay.

Not staged: the non-commercial concrete stair kit, dense share-alike cabinet, and redundant/reference-only downloads. See the detailed audit before selecting those.

Validation: all prepared GLBs passed Khronos structural validation and Three.js 0.160.1 parsing with Sharp image decoding. CPU-skinned poses of all six animations were visually inspected. Browser rendering, final placement/collision, lighting, looping/root-motion choices, and frame rate must be checked during level implementation.

Parking surface materials: [Concrete Floor Worn 001](https://polyhaven.com/a/concrete_floor_worn_001), [Garage Floor](https://polyhaven.com/a/garage_floor), and [Concrete Wall 008](https://polyhaven.com/a/concrete_wall_008) from Poly Haven, CC0. Runtime files are 2K WebP base colour, OpenGL normal and roughness maps (`parking/textures/<asset>-{diff,nor_gl,rough}.webp`); base colour is sRGB and data maps are linear. Credits are documentation-only.

Additional runtime props: `damaged-trash-can.glb` (0.85 m, 620 triangles), `traffic-cone.glb` (one cone, 0.65 m, 278 triangles), `weathered-barrier.glb` (one red barrier, 0.8 m, 1,460 triangles), and `emergency-light.glb` (0.26 m, 38 triangles). Textures are 2K WebP maximum and geometry uses meshopt. These are grounded, metre-scale selections; do not load their whole source showrooms.

New source inventory also includes the complete Basement Parking Garage Environment Underground (PolyNeast, Sketchfab Standard), Emergency exit (Shorty_Digitan, Sketchfab Standard), and Emergency Fire Escape / Exit Door (Prem Mane, CC-BY-4.0). They remain source-only: the garage is a fixed 80,798-triangle environment; the small exit sign duplicates the chosen emergency light; the double fire door is redundant and wider than the safe-room openings. `uno_reverse_tex.png` is retained as supplied and has no assigned parking role. Receipts, analyses and preparation tooling are in ignored `assets-src/habitable-zone/`.

Interactive room derivatives: `interactive-locker.glb` separates the authored open locker into fixed body/shelves and its complete leaf/lock/handle, restored to a closed pose with a measured side hinge. The empty `LockerDoor` parent is the animation pivot; its `LockerLeaf` child owns meshopt decoding transforms. Do not rotate the quantized mesh node directly. `interactive-room-door.glb` retains the earlier room-kit leaf as a library asset; runtime parking utility doors are now beveled painted-steel assemblies with lever handles, kickplates and three hinge barrels. `garage-pillar.glb` extracts only Object_13/Object_14 from the supplied basement garage, with actual bounds 0.75 Ã— 3.55 Ã— 0.75 m. These derivatives use 1K WebP and meshopt. Full original notices and modification credits are in LICENSES/CREDITS. The complete garage remains source-only; the selected column is now used.

Locker refit: 0.414 m closed leaf with approximately 4 mm outer reveals, fixed hinge parent at (0.207, 0, 0.219) m, original vents/lock/handle preserved, desaturated diffuse with retained contrast, roughness 0.86 and metalness 0.12. Pillar upper faces use the same Poly Haven concrete as the walls with metric UVs; lower striped geometry is clipped at 1.19541 m to avoid overlapping the upper skin.

Column runtime assembly preserves a common origin for Object_13/Object_14; do not ground each selected piece independently. The concrete starts at its authored 1.195408 m joint, above the non-overlapping hazard base, and reaches 3.56 m for 10 mm ceiling embed. Validation now checks actual placed instances and high-level ray hits across multiple floors rather than only source bounds. No source files were changed.

Current ground: `textures/asphalt_02-{diff,nor_gl,rough}.webp` from Poly Haven Asphalt 02, Rob Tuytel, CC0, 2K and 3 m physical repeat. Matte roughness data is remapped to >=0.95; material specular/environment/clearcoat are zero. All ground Reflector/puddle code and floor paint masks are removed. Parking lines are actual Three.js DecalGeometry projections with generated transparent worn-edge texture, filtered to deck-top faces and merged per floor.

`generator-repair.glb` stages the new Generator LP asset (10,902 triangles, 1.4 m tall, about 2.16 Ã— 1.465 m), CC-BY-4.0 by YoeriBervoets. Original sources and both supplied generator ZIP receipts are preserved. The repair UI/interaction task is paused and is not delivered as active gameplay. The old ND original remains unchanged as an archive.

### Smiler

`parking/smiler.glb` is adapted from **Accurate Smiler Backrooms Blender 3.22** by **ultramirage10**, licensed under **CC-BY-4.0**. Source: https://sketchfab.com/3d-models/accurate-smiler-backrooms-blender-322-902975161a7047baa5cda8fb7b5a292e — author: https://sketchfab.com/ultramirage10 — license: https://creativecommons.org/licenses/by/4.0/ . Changes: baked static bind pose, centered/oriented/rescaled, narrowed and elongated individual teeth, compressed GLB; runtime omits black pupil pieces and adds glow, chromatic fringes and smoke. Original archive is preserved.
