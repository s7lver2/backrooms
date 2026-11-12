# Backrooms docs index

Co-op multiplayer Backrooms game (monorepo: `shared/` `server/` `client/`). Dev: `python tools/build.py` -> client http://localhost:5180, server :5181. Typecheck: `python tools/build.py --check`.

Start here (for LLMs): `workflow/PROJECT-CONVENTIONS.md` (owner conventions) -> `ARCHITECTURE.md` -> `SPEC.md` -> `CONTRIBUTING-LLM.md`.

| Doc | Content |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | layout, file roles, data flow, authority model, persistence, build/dev/test, gotchas |
| [ANIMATION.md](ANIMATION.md) | animation system: pack, blend tree, dances, variants, IK stack, `?anim` tool |
| [SPEC.md](SPEC.md) | game rules, constants, levels, missions, economy, death/revive, admin, socket/HTTP protocol |
| [GLOSSARY.md](GLOSSARY.md) | terms (EN/ES) mapped to code |
| [CONTRIBUTING-LLM.md](CONTRIBUTING-LLM.md) | how to add item/level/mission/entity/event/achievement, checklist, don'ts |
| [level-caps.md](level-caps.md) | `LevelCaps`: per-level component switches |
| [shader-cache-escritorio.md](shader-cache-escritorio.md) | why there is no persistent shader cache on the web, the SHADER WARM-UP setting, and the future desktop-app plan (Spanish) |
| [poolrooms.md](poolrooms.md) | Poolrooms design and implemented mechanics (sections 10-11 = current state) |
| [spec-fase1-multijugador.md](spec-fase1-multijugador.md), [spec-fase2-sala-de-espera.md](spec-fase2-sala-de-espera.md), [spec-fase3-cuentas.md](spec-fase3-cuentas.md), [spec-lobby-pulido.md](spec-lobby-pulido.md), [spec-mapa-abierto-escondites.md](spec-mapa-abierto-escondites.md) | historical phase specs (Spanish); may lag the code |
| [../DESIGN.md](../DESIGN.md), [../ROADMAP.md](../ROADMAP.md) | design decisions and idea backlog (Spanish) |

Conventions in one line: code comments Spanish, in-game text English UPPERCASE, shared code pure and seeded, server authoritative, no tests unless asked, one commit per feature.
