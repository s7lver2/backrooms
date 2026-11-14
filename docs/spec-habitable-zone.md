# Habitable Zone — level specification

Status: approved by the owner on 2026-11-08. Branch: `Lucy` (current checkout reports `lucy`).
This specifies the new browser-game level, not a Unity or VRChat project. Work directly from this specification, step by step; the owner explicitly requested no separate implementation plan. No commit requested.

## 1. Intent and chosen direction

A procedural underground parking complex with a strong liminal atmosphere: apparently endless parking bays, sparse cars, low ceilings, repetitive concrete pillars, damp surfaces, fluorescent lighting, and empty space. Multiple floors connect through enclosed pedestrian stairs and vehicle ramps. Players explore, complete a voted mission, discover the hidden elevator, and physically enter it to escape.

Approaches considered:
- Realistic parking structure: convincing construction and orderly circulation, but less spatial unease.
- Impossible parking maze: exaggerated connections and disorientation, at the expense of realism.
- **Chosen: mostly realistic, subtly wrong.** Believable construction with unusually long sections, repeated markings, inconsistent lighting, and occasional oversized empty spaces. This matches the owner's reference images.

The map is finite but feels endless. Actual infinite streaming, drivable cars, new weapons, and new equipment are outside this version. No mandatory lore accuracy beyond the owner's supplied description and images.

## 2. Confirmed round rules

Only this level offers these three mission types:
1. **Cursed tapes:** collect eight tapes. Each pickup increases entity aggression and environmental disturbances.
2. **Generators:** activate five generators to supply electricity to the elevator. Every activated generator also restores steady lighting across its whole owning floor.
3. **Survival:** survive for a voted duration while entity aggression gradually increases. No safe rooms exist in this mode.

The first vote selects the mission. Only if survival wins, a second vote selects 5, 10, or 15 minutes. This second vote is exclusive to the Habitable Zone. Default survival duration is five minutes.

| Mission / duration | Random floor count | Relative deck size |
| --- | --- | --- |
| Tapes | 3–5 | Standard |
| Generators | 5 | Standard |
| Survival: 5 minutes | 3–5 | Standard |
| Survival: 10 minutes | 5–7 | Larger |
| Survival: 15 minutes | 7–9 | Largest |

Completing any objective unlocks the elevator; it never ends the round automatically. Its location remains hidden, including after mission completion. No reveal marker, directional announcement, or completion signal that exposes its location. Local appearance can show that a discovered elevator is unlocked.

Use the existing health, damage, death, revival, inventory, and escape flow. Entities deal heavy damage with a short interval between hits, not automatic instant death. Sanity is disabled for this level. Existing difficulty can continue to affect combat, but must not change the explicitly voted mission duration or counts.

## 3. Layout and generation

- Seeded generation shared by server and client. Same seed and finalized generation parameters must yield the same map, floor connections, safe rooms, objectives, and item identifiers.
- Generate 3–9 vertically separated decks as dictated by the table. Each deck has parking sections, columns, driving lanes, sparse static cars, walls, service infrastructure, stairs, and ramps.
- Floors vary within one concrete complex: standard parking decks, occasional brighter industrial areas, and darker/wetter lower floors.
- Players can use stairwells and car ramps to change floors. Cars are obstacles only, never searchable or drivable; no alarms or interaction mechanics.
- Place the exit elevator randomly and guarantee it is reachable from spawn. Its placement is independent of whether players have unlocked it. Reserve clear space around its footprint and an unobstructed approach in front of the doors; adjacent walls, columns, props and connectors must not crowd or intersect it (owner clarification).
- Distribute all eight tapes over every floor in tape rounds. Generate five floors with exactly one generator on each. Report floors still missing power in the mission HUD.
- Guarantee paths to every objective and the exit, including across stairs/ramps, around cars, and through doorways. Avoid objectives inside decorative blockers or inaccessible recesses.
- Repetition should conceal scale, not invalidate navigation. Environmental markings can be repetitive but connections must remain stable during the round.
- No ordinary light-switch interactions. Lighting follows generated circuits, flickering, mission escalation, and activated generators.

Proposed initial generation tuning, left to implementation/playtesting: standard decks approximately 72 × 72 m, larger decks 90 × 90 m, largest decks 108 × 108 m. These are starting bounds, not approved exact dimensions. Select actual footprints to fit browser performance and traversal pacing. Use modular parking bays with sensible vehicle clearance, rather than forcing architectural dimensions onto the existing 1.5 m grid.

## 4. Safe rooms

- Tape and generator rounds generate **2–7 small safe rooms on every floor**. Survival generates zero; decorative rooms must not accidentally provide the same protection.
- Variants are small break rooms and maintenance rooms. Include windows, a normal-sized closable door, lockers, tables, and possible pickups of existing items.
- They are permanently safe. Both Skinwalkers (including disguised form) and Smilers are prohibited from entering, even through an open door. Players inside cannot be attacked through the door, windows, walls, or threshold.
- Skinwalkers do not approach occupied safe rooms closely. They wait at a distance and resume approaching after a player leaves.
- Closing the door visibly secures the room, but entity exclusion does not depend on closing it.
- Furniture is furnishing/cover; separate enter-locker or crawl-under-table hiding interactions are not required for this version. Room safety is the agreed hiding mechanism.

Proposed implementation defaults: a 5 m exterior stand-off from an occupied room entrance, adjusted for clear circulation; no entity camping directly in the doorway. Doors cannot lock teammates out. Room interiors stay steadily lit and are exempt from blackouts.

## 5. Skinwalker

### Identity and population

Spawn one Skinwalker per floor at round start. Each Skinwalker stays on its spawn floor and pursues only players on that floor. Its patrol and pursuit routes stop at stairs and ramps. If displaced to another floor, it stops hunting and uses the connecting routes to return home. If it cannot reach home on foot, it resets to its original spawn point. Copy any participant's exact appearance, including cosmetics; in solo play it can copy the sole player. Suspicious behaviour is the intended clue. No explicit monster label or forced visual glitch reveals the disguise.

While idle it can wander, stand still, or pretend to complete tasks. Fake tasks never change real mission progress. Avoid strongly lit areas; prefer dim routes. Lights affect route preference rather than silently teleporting it or making every bright parking section a safe room.

### Behaviour sequence

1. Disguised idle/patrol or fake task.
2. On seeing a player, spend at least one second walking. While in disguise, use a reachable route toward the player's side or rear when the layout allows.
3. Once nearer, run toward the player while still disguised.
4. At very close range, transform into the beast, then remain stationary and unable to attack for three seconds. The flashlight works throughout this recovery window. Pursuit can begin only after that window.
5. If the target escapes, search around their last known position for seven seconds. If not reacquired, return to disguise and resume roaming.
6. Beast pursuit uses last-seen and last-heard information and a local search after losing the player.
7. Every 10 seconds, a Skinwalker free to roam checks a snapshot of an exposed player's location on its floor. It walks there through the parking navigation graph. Active pursuit, recent tracks, and safe-room protection take priority.

A player sprinting at 6 m/s can outrun both forms at base speed. At eight tapes, the beast reaches 6.02 m/s. With all five generators repaired, it reaches 6.27 m/s. The disguised form remains slower throughout the round. A player eventually exhausting stamina remains a risk.

Flashlights, footsteps in puddles, and other meaningful player noise can attract attention. Isolated players have a higher hunting preference. Detection respects range, line of sight, floor separation, and sound propagation through usable openings. Investigate the sound's position rather than learning the source's future position.

### Flashlight defence

The flashlight has **no repelling or identifying effect on the disguise**. It works only during transformation or in beast form. A valid beam hit forces the entity to flee away from the illuminating player and prevents attacks for **three seconds**. This is the only direct stop/repel tool; ordinary evasion and safe-room protection still apply. Retreat lasts those three seconds, then the entity can reassess its target.

Current local tuning: sight and flashlight-attention range 12 m; approach-to-run at 5 m; transformation at 3 m; disguised run at 85% and beast run at 97% of player sprint speed. These are explicitly tuning defaults, not owner-specified numbers. Give transformation a readable animation; the beam can interrupt it. Repeated valid illumination refreshes retreat without stacking durations. Attack immunity covers all players during retreat to prevent immediate target-switch attacks.

## 6. Smiler

- Smilers are their own dark creature with glowing eyes and a smile. They never imitate players.
- They appear only in near-total darkness: unlit areas or areas temporarily dark during flickering/blackouts. Never spawn inside safe rooms.
- Stationary in darkness. Uninterrupted sight of an exposed player within 16 m intensifies a screen glitch each second. The base lethal time is 10 seconds and drops as the team collects cursed tapes or repairs generators. Walls, floor separation, safe rooms, leaving range, and a valid flashlight beam reset the stare.
- Direct flashlight illumination from 6 m or closer freezes a Smiler before its lethal sight check, then makes it disappear after 1.5 seconds of continuous illumination. It can return in eligible darkness after a cooldown.
- A ceiling light restoring illumination at its location makes it disappear immediately.
- Its sight attack immediately sets health to zero and bypasses the Skinwalker damage immunity interval. Paused rounds and safe-room occupants remain protected.

Base population tuning allows two active Smilers. The first spawn attempt is after 20 seconds and subsequent attempts are 30-45 seconds apart. Eligible locations are dark, 9-22 m from players, and out of direct sight. Ceiling lighting at the creature's location clears it. The Cursed Tapes thresholds change the active cap and the base 75-second section cooldown.

## 7. Mission interactions and escalation

### Cursed tapes

Exactly eight real pickups; objectives on every floor. Each increments a shared escalation stage, replicated to all clients. Early stages bring irregular flickers, distant metallic sounds, and increased attention to noise. Later stages introduce brief local blackouts in selected sections, creating Smiler opportunities. Never black out the entire complex or safe rooms. Keep fog restrained enough to read nearby dangers. Stage eight remains active during the escape to the elevator.

| Team tapes collected | Skinwalker movement bonus | Skinwalker investigation interval | Smiler lethal stare | Smiler section cooldown | Maximum active Smilers |
| --- | --- | --- | --- | --- | --- |
| 0-2 | 0 m/s | 10 s | 10 s | 75 s | 2 |
| 3-7 | +0.15 m/s | 9.5 s | 8.5 s | 65 s | 3 |
| 8 | +0.20 m/s total | 8.5 s | 6.5 s | 55 s | 4 |

### Five generators

Hold interact for **eight uninterrupted seconds** within reach and facing the generator. Show a circle in front of the player that fills from empty to full; clear completion feedback marks the generator as permanently on. Releasing interact or moving away resets incomplete progress to zero. No repair minigame. Activation is not an entity-attracting noise event.

Each completed generator restores steady lighting across its whole owning floor and contributes one of five power steps for the elevator. Restored areas clear Smilers and are less attractive to Skinwalkers. After all five, the elevator unlocks without revealing its location. Each repair adds 0.09 m/s to Skinwalker movement and shortens its investigation interval by 0.5 seconds. It also shortens the Smiler lethal stare by 0.5 seconds and its section cooldown by 8 seconds. The five-repair totals are a +0.45 m/s movement bonus, a 7.5-second investigation interval, a 7.5-second lethal stare, and a 35-second cooldown. The active Smiler cap rises from two to three after the second repair and to four after the fourth. These settings remain in effect through extraction.

Proposed defaults: leaving reach, death, disconnection, or beginning another incompatible interaction cancels progress. Completed generators cannot be farmed. Multiple players cannot accelerate one generator; server awards a single completion to a valid uninterrupted hold. Powered generator circuits do not flicker off again in this mission.

### Survival

Duration is the second vote's result, in server-measured active-round time. Larger durations choose larger deck footprints and floor ranges before generation/preload finishes. No safe rooms or alternative furniture hiding interactions. Every 90 seconds, add 0.05 m/s to Skinwalker movement, cut its investigation interval by 0.4 seconds, and shorten the Smiler lethal stare by 0.3 seconds. Every 210 seconds, raise the active Smiler cap by one, starting at two. Timer completion unlocks the hidden elevator and locks the difficulty at that point for extraction.

Proposed voting defaults: reuse current mission-vote duration and participant eligibility. Duration ties follow existing vote tie behaviour; no duration votes defaults to five minutes. Departed players' votes are removed. Mission selection locks before the duration vote; finalize generation parameters afterward, invalidate any stale ready/preload state, and start the timer only after final loading/round start. Other levels retain their existing flow.

## 8. Equipment

Reuse existing items; no new item or weapon is requested. **Guns are not allowed here**: no gun pickups, purchases, equipping, firing, or effective gun damage. Enforce on the server and client.

Implementation proposal consistent with existing capability conventions: temporarily disable carried guns and preserve them for later levels rather than deleting player property. Other existing items keep their supported behaviour; level-specific features such as swimming are not invented merely because their equipment exists. Start with current flashlight/consumable supply rules, then tune enough flashlight supply for unavoidable encounters. Do not introduce a new ammunition, battery, or durability system.

## 9. Visuals, assets, sound, and effects

Primary references are the eleven parking images and four entity images supplied in this design conversation. They are visual references, not licensed production assets. The selected mood combines images with low ceilings, long pillar rows, exposed red/grey pipes, fluorescent fixtures, stained concrete, worn white/yellow markings, rare cars, and wet reflective patches. Avoid applying heavy chromatic aberration or VHS grain everywhere simply because some references contain it.

Environment kit: modular concrete floor/ceiling/wall/beam/column pieces; pillars with floor/zone markings and impact guards; parking lines, wheel stops, drains, pipes, cable trays, vents, fluorescent fixtures, ramps, stairs, doors/windows, elevator, break/maintenance-room furniture, five generator instances only in generator missions, rare parked-car variants, and existing pickup models. Per owner clarification, use the downloaded Small Electric Generator's original unmodified files, retain its bundled CC-BY-ND licence and attribution, and do not run the optimization pipeline on it.

Entity kit: existing player rig/cosmetic rendering for disguises; beast mesh/rig with walk/run/attack/retreat/search animations; Smiler eyes/mouth and a restrained dark silhouette/effect. The Skinwalker transformation uses VFX to transition from the copied player appearance to the beast; no dedicated transformation animation is required (owner clarification). Reference screenshots must not be extracted into production monster textures.

Small detail is spatially motivated: puddles below leaks, damp trails to drains, rust beneath pipe joints, tyre marks along driving routes, chipped paint at corners, low-density dust in light, occasional dripping and surface ripples. Reflective wetness varies; the entire floor is not a mirror. Floor seams, decals, and prop variation break texture repetition while structural repetition remains intentional.

Sound: fluorescent hum, distant ventilation, concrete/reverberant footsteps, puddle splashes, occasional pipe ticks, drops, and distant metallic disturbances. Positional audio must support threat reading. Generator interaction creates no attraction event. Ambient decorative sounds do not automatically lure entities as if they were player actions.

Implementation proposals: local fog pockets plus distance haze, inexpensive light-shaft geometry/particles near selected fixtures, baked or procedural ambient shading, fixed-budget dynamic lights near players, and pooled particles. Use shared/limited reflection passes or cheaper approximations rather than a planar reflector per puddle/floor. Fog and lighting need scalable quality presets. Critical flicker, powered circuits, and darkness eligibility must agree with server state; visual particles and cosmetic reflections need not replicate.

## 10. Architecture and authority constraints

Introduce a shared layered parking-map contract containing floor/cell or node identity, world heights, geometry occupancy, connections, section/circuit identifiers, room safe volumes, objective/item locations, and navigation data. Navigation needs an actual multi-floor graph; do not collapse all floors into the existing flat Poolrooms server adapter.

Server owns finalized generation parameters, votes, active timer, generator holds/completions, tape pickups, escalation, entity identities/AI, damage, lighting circuits, safe-zone protection, flashlight repulsion, spawn/despawn cooldowns, and elevator eligibility. Client owns rendering and responsive input presentation. Share seeds and small parameters; do not transmit derived whole maps.

Validate position/floor/reach, interaction duration, health/phase, flashlight equipped/on state and beam cone/line of sight, noise event plausibility/rate, and gun restrictions. Prevent cross-floor hits, pickups, generator use, and flashlight effects through ceilings. Apply safe-room immunity on damage as well as navigation. Noise across floors follows openings and connections, not horizontal distance alone. Entity snapshots include stable IDs, state, position, copied appearance, and animation state as appropriate.

Use capability-driven routing for parking movement, guns, sanity, and entity families. Adding a level must not automatically give it bacteria/partygoer or a totem merely because existing `ents` is enabled. Keep other levels' gameplay unchanged. New snapshots/events/types require shared protocol definitions and updates to the canonical architecture/spec docs when implemented.

Level-specific loading: finalize mission/duration/layout before spawning content, gate readiness on the final configuration, then create server Match and client scene from identical inputs. Reuse the existing renderer/composer lifecycle, with complete teardown of lights, materials, listeners, particles, and network subscriptions on exit. Stage the level as dev-only while unfinished.

## 11. Build order and acceptance

This is a suggested sequence, not an implementation plan or authorization to start coding:
1. Shared multi-floor layout and greybox: ramps, stairs, random reachable exit, spawn, and mission-dependent room/objective placement.
2. Movement, collision, safe zones, doors, and server navigation.
3. Three missions, survival-only duration vote, loading synchronization, elevator extraction, item restrictions.
4. Skinwalker disguise/state machine and Smiler darkness/flashlight rules.
5. Environment kit, lighting, puddles/reflections, audio, particles, escalation, performance tuning.

Acceptance during implementation:
- Matching seeds and generation parameters give matching layouts, identifiers, and floor count on both sides.
- All objectives and the hidden elevator are reachable for every supported generation profile. Players can traverse ramps and stairs. Each Skinwalker stays on its spawn floor during patrol, investigation, pursuit, and retreat.
- Tape/generator rounds contain 2–7 safe rooms on each floor; survival contains none.
- Objectives cannot be bypassed; all modes require elevator extraction.
- Only this level has the additional duration vote; loading cannot start a stale/wrong-size match.
- Disguises match player cosmetics; detection/approach/run/transform/search sequence follows section 5.
- Flashlight cannot expose a disguise, but interrupts transformation/beast attacks and forces three-second retreat.
- Smilers never move through lit areas; restored ceiling lights clear them; flashlight freeze/disappearance/cooldown work consistently across clients.
- Safe-room players are protected against both entities regardless of open doors; entities cannot enter or hit through boundaries.
- Generator circle takes eight continuous seconds, resets on interruption, and activation is silent to AI.
- Guns cannot function or appear as level loot; disabled carried guns survive the round. No sanity death.
- Visual quality is checked in-browser, including reflections, flicker, dark-route readability, and multiple floors. Multiplayer is checked with at least two clients.
- Main code verification: `python tools/build.py --check`. No added tests or dependencies unless separately requested; manual checks should include several seeds and the largest 15-minute profile.

## 12. Review notes

Confirmed decisions are stated as rules above. Exact distances, speeds, Smiler occupancy/cooldown, damage interval, lighting thresholds, deck dimensions, aggression curves, per-profile performance budgets, and asset sourcing are explicitly left as proposed tuning/builder decisions. Review them during greybox/visual work before treating them as final balance.

The independent builder check found no important unanswered requirements, and the owner approved the design. No gameplay files were changed during specification work. Do not commit unless requested.

## 13. Implementation progress

First environment milestone: seeded shared parking layout/nav/collision and a local `/?parking` preview with ramps/stairs, room geometry/furniture, cars, ceiling services, lights, fog, dust and puddle reflections. Elevator placement reserves a 9 × 9 m area before room/prop generation; connector openings also cut overhead beams. Generator originals are loaded/placed only by the generator profile, with attribution in README/model documentation, not on screen. Transformation remains specified as VFX for the later entity milestone.

Active missions/votes, enemy AI, safe-room door interaction and multiplayer integration remain subsequent work. The preview explicitly labels this scope and does not enter normal level selection.

Environment revision: decks now use a 90 m base footprint (plus survival-size tiers), with shifted bounds and full-height staggered partitions, connecting passages and dead-end branches. Every floor uses the same worn-concrete surface. Structural slabs are 0.65 m thick with opaque cut faces; enclosed stair/ramp passages have solid sides, floors and roofs. The hidden elevator is selected on a seeded random floor below the entry deck, sits flush in the service facade and has no exterior alcove. Reachability and connector reservations remain generation requirements.

Solo escape milestone. Eight VHS pickups, five generator repairs, and the selected survival timer unlock the same hidden elevator. Press E to slide the doors open, then cross into the enclosed cabin to finish. Tape pickups increase Skinwalker alertness and introduce lighting faults. Survival increases Skinwalker alertness as active time passes. Pausing suspends the survival clock, and retrying resets it. These mission rules currently run in the solo preview.

Main game milestone. **The Habitable Zone** now appears in the title menu as a solo level. It uses the main game's player, inventory, mission HUD, renderer and round lifecycle with parking's seeded decks, collision, entity prefabs and audio. The shared 3D elevator completes the round. Inspection shortcuts now live in F9. Authoritative room play and the survival duration vote are pending.

Room integration and entity tuning. The main menu opens the normal room browser. A signed-in admin launches the Habitable Zone from F9 > World in a public or private room. The room mission vote selects Tapes, Generators, or Survival. The survival duration currently comes from the room seed. The server shares objective, door, loot, entity, and elevator state across players.

Skinwalkers see up to 15 m, start running within 7 m, and transform within 5 m after their initial walking approach. Disguise sprint speed is 5.1 m/s, and beast chase and retreat speed is 5.82 m/s. After losing the trail they check the last known location and search nearby along the last observed direction of travel. A valid flashlight hit repels them for 2 seconds, followed by 25 seconds of resistance.

Smilers can spawn together at randomly chosen eligible dark positions 9-22 m from players and outside their line of sight. The Cursed Tapes table sets the lethal stare duration, cooldown, and active cap during that mission. Gaze timers and flashlight interruption are tracked independently for each Smiler.
