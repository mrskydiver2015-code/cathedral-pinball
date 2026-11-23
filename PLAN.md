# Pinball Project Master Plan

Architecture and phased delivery roadmap for a cathedral stained-glass 3D pinball game built with **Blender 5.2.3 LTS**, **Three.js WebGPU (`three/webgpu` r186+)**, **Rapier3D (`@dimforge/rapier3d-compat`)**, and **100% procedural Web Audio**.

---

## Phase 0 — Environment Warmup & Architectural Freeze (Complete)
- Verified non-deprecated 2026 APIs via Context7: `three/webgpu` (`WebGPURenderer`, `await renderer.init()`, `THREE.RenderPipeline`, `pass`, `mrt`, `bloom`, `MeshPhysicalNodeMaterial`, `castShadowNode`, `THREE.Timer`) and `@dimforge/rapier3d-compat` (`await RAPIER.init()`, `kinematicPositionBased`, `setNextKinematicRotation`, `setCcdEnabled`, `EventQueue`).
- Created the `6.5°` tilted base cabinet blockout in live Blender 5.2.3 LTS (`Pinball_Table_Root`, cabinet walls/floor, `Playfield_Deck`, `Plunger_Lane_Divider`, `Flipper_Pivot_Left/Right`).
- Froze engineering rules in [AGENTS.md](./AGENTS.md).

---

## Phase 1 — Minimal Scaffold & Shared Contracts (Pre-Swarm Gate)
Scaffold Vite + TypeScript + `three` (r186+) + `@dimforge/rapier3d-compat` + Playwright in `C:\AI-ProjectsAG\Pinball` and freeze cross-track contracts before launching `/swarm`:
- `src/shared/tableSpec.ts` — Single source of truth for dimensions, `6.5°` tilt, ball radius (`0.0135 m`), flipper pivot coordinates, bumper/slingshot/target anchors, and lane sensor boxes.
- `src/shared/events.ts` — Typed event bus decoupling physics impacts/triggers from WebGPU lighting/VFX, procedural Web Audio, and HUD scoring.
- `src/shared/types.ts` — Ball transform snapshots, multiball lock/active counts, input state, and Playwright debug/telemetry interface.

---

## Phase 2 — Parallel `/swarm` Execution (3 Independent Tracks)

Each worker owns disjoint directories and communicates solely through `src/shared/*` contracts.

### Track A (`assets-blender`) — Blender `.glb` & PBR Stained-Glass Textures
- **Owned Paths:** `public/assets/`, `blender/`, `src/assets/manifest.ts`
- **Scope:**
  - Evolve the `6.5°` Blender 5.2.3 LTS blockout into the complete cathedral stained-glass pinball table: arched cabinet trim, plunger rod/housing, curved upper shooter arch, wire/acrylic guide rails, slingshot assemblies, 3 pop bumpers, drop target bank, elevated translucent stained-glass ramp, and gothic rose-window playfield inserts/backglass.
  - Author/bake procedural PBR stained-glass texture maps (albedo, roughness, normal, emissive insert masks) with lead-came framing.
  - Export clean `+Y Up` `.glb` (`public/assets/pinball-table.glb`) preserving named anchor/pivot nodes (`Flipper_Pivot_Left`, `Flipper_Pivot_Right`, bumper/target/lamp nodes) aligned to `tableSpec.ts`.
- **Exit Criteria:** `.glb` loads cleanly via `GLTFLoader`, all pivot/anchor transforms match `tableSpec.ts` within `1 mm`, and Blender multi-angle `look` checks pass without overlap or z-fighting.

### Track B (`render-audio`) — Three.js WebGPU Renderer & Procedural Web Audio
- **Owned Paths:** `src/render/`, `src/audio/`, `src/ui/`
- **Scope:**
  - Initialize `THREE.WebGPURenderer` (`await renderer.init()`) with automatic WebGL 2 fallback and `?forceWebGL=1` override; report active backend (`webgpu` / `webgl2`) to HUD/telemetry.
  - Build `THREE.RenderPipeline` with `pass(scene, camera)` and MRT selective emissive bloom (`mrt({ output, emissive })` + `bloom`), using `THREE.Timer` and `AgXToneMapping`.
  - Upgrade stained-glass meshes/inserts to `MeshPhysicalNodeMaterial` (`transmission`, `ior`, `thickness`, `renderer.shadowMap.transmitted = true`, `castShadowNode`) plus reactive lamp flash animations driven by `events.ts`.
  - Implement framed player/overhead/plunger camera rig, crisp minimal arcade HUD (score, ball count, multiplier, multiball status, mute/backend badge), and a 100% procedural Web Audio synthesizer (mechanical flippers, plunger spring, pop bumpers, slingshots, ball roll, stained-glass chimes, multiball fanfare).
- **Exit Criteria:** Clean 60 fps rendering in both WebGPU and `forceWebGL: true` modes, zero external audio files in repo, and synchronized visual/audio response to all `events.ts` triggers.

### Track C (`physics-qa`) — Rapier3D Multiball Physics, Flippers & Playwright QA
- **Owned Paths:** `src/physics/`, `src/game/`, `tests/e2e/`, `playwright.config.ts`
- **Scope:**
  - Build `@dimforge/rapier3d-compat` simulation (`await RAPIER.init()`) with `240 Hz` fixed-timestep accumulator (`FIXED_DT = 1 / 240`), `6.5°` tilted playfield deck, cabinet/arch/rail colliders, and `EventQueue` collision draining + `.free()` teardown.
  - Implement CCD-enabled dynamic steel pinballs (`setCcdEnabled(true)`, `setCanSleep(false)`), `kinematicPositionBased` left/right flippers (`setNextKinematicRotation`), spring-loaded plunger shooter, radial pop bumper impulses, slingshot kickers, drop target banks, 3-ball multiball lock/release ruleset, drain trough sensor, and controlled table nudge + tilt lockout.
  - Build headless Playwright E2E QA suite verifying boot, zero console/page errors, WebGPU/WebGL 2 canvas rendering, plunger launch, flipper actuation, multiball state transitions, and exporting screenshots + logs strictly to `C:\AI-ProjectsAG\Pinball dok\`.
- **Exit Criteria:** Zero ball tunneling during 3-ball multiball stress runs, deterministic physics/scoring ruleset tests passing in Playwright, and QA evidence archived in `C:\AI-ProjectsAG\Pinball dok\`.

---

## Phase 3 — Integration, Tuning & Final Verification
- Wire Track A (`.glb` + stained-glass PBR), Track B (WebGPU `RenderPipeline` + procedural Web Audio + HUD), and Track C (Rapier3D `240 Hz` multiball physics + ruleset) inside `src/main.ts`.
- Tune flipper crispness, ramp entry velocity, bloom thresholds, and audio mix.
- Run full Playwright E2E checks (default + `?forceWebGL=1`), visually inspect captures in `C:\AI-ProjectsAG\Pinball dok\`, and stage/commit explicit source paths cleanly.
