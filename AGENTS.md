# Engineering Guardrails (`Pinball`)

Strict rules for every contributor, subagent, and `/swarm` worker operating in `C:\AI-ProjectsAG\Pinball`.

## 1. Workspace, Documentation & Git Hygiene
- **Project Boundary:** Keep all Git-tracked source code, Blender generator scripts, and build assets inside `C:\AI-ProjectsAG\Pinball`.
- **Companion Docs Folder:** Store all screenshots, Playwright QA logs, visual diffs, render captures, and working specifications in `C:\AI-ProjectsAG\Pinball dok` (outside Git). Never commit screenshots, logs, or temporary captures into the repository.
- **Language:** Use English in all code, filenames, comments, and commit messages.
- **Git Discipline:** Before committing, run `git status`, stage explicit file paths with `git add -- <path>` (never `git add -A`), inspect `git diff --cached`, and verify `git config user.name` (`mrskydiver2015-code`) and `git config user.email`.

## 2. Graphics Stack — Three.js WebGPU First (`three/webgpu`, r186+)
- **Imports:** Always import core Three.js APIs from `'three/webgpu'` and shader/post-processing nodes from `'three/tsl'`. Never use legacy `'three'` `WebGLRenderer`, `EffectComposer`, or `THREE.Clock`.
- **Renderer Initialization & Fallback:** Instantiate `new THREE.WebGPURenderer({ antialias: true })` and **always** `await renderer.init()` before the first render or backend inspection. Rely on `WebGPURenderer`'s built-in automatic WebGL 2 fallback when WebGPU is unavailable, and support `?forceWebGL=1` (`forceWebGL: true`) for explicit fallback testing and headless Playwright QA.
- **Post-Processing:** Use `THREE.RenderPipeline` with `pass(scene, camera)` and MRT selective emissive bloom (`mrt({ output, emissive })` + `bloom` from `'three/addons/tsl/display/BloomNode.js'`), executed via `renderPipeline.render()`.
- **Frame Timing:** Use `THREE.Timer` instead of deprecated `THREE.Clock`.
- **Stained-Glass PBR:** Use `MeshPhysicalNodeMaterial` (`transmission`, `ior`, `thickness`) paired with `renderer.shadowMap.enabled = true`, `renderer.shadowMap.transmitted = true`, `castShadowNode` for colored translucent shadows, and `AgXToneMapping` or `ACESFilmicToneMapping`.
- **GPU Performance Guardrail (Intel Arc Integrated Graphics, 60+ FPS):** Apply `MeshPhysicalNodeMaterial` `transmission` **selectively** — only on hero translucent elements (elevated stained-glass ramps, rose-window playfield inserts, and pop bumper caps). **Never** enable `transmission` on the full playfield deck, cabinet enclosure, or large background surfaces, so full-screen refraction passes do not bottleneck integrated Intel Arc GPUs. Use opaque PBR + emissive masks (`'opaque'` or `'emissive'` material tier) everywhere else, reserving `'selective-transmission'` strictly for focal stained-glass geometry.

## 3. Physics Stack — `@dimforge/rapier3d-compat` Fixed-Timestep
- **Initialization:** Use `@dimforge/rapier3d-compat` (base64-embedded WASM, zero bundler WASM plugin issues) and **always** `await RAPIER.init()` before creating any `World`, `RigidBodyDesc`, or `ColliderDesc`.
- **Deterministic Stepper:** Run a fixed-timestep accumulator (`FIXED_DT = 1 / 240` s; clamp incoming frame delta to `<= 0.05` s) with `world.timestep = FIXED_DT`.
- **Pinballs (No Tunneling):** Dynamic pinballs (`0.027 m` diameter, `0.0135 m` radius) must enable continuous collision detection (`setCcdEnabled(true)`) and disable sleeping (`setCanSleep(false)`).
- **Flippers:** Model flippers with `RigidBodyDesc.kinematicPositionBased()` and drive them exclusively via `setNextKinematicRotation(...)` (never `setRotation`) so Rapier derives physical contact sweep velocities cleanly.
- **Events & Cleanup:** Enable `ActiveEvents.COLLISION_EVENTS` on interactive colliders, use `setSensor(true)` for drain/rollover/lane sensors, step with `new RAPIER.EventQueue(true)` (`world.step(eventQueue)` + `eventQueue.drainCollisionEvents(...)`), and call `.free()` on `World` and `EventQueue` during teardown.

## 4. Audio Stack — Zero External Audio Assets
- **100% Procedural Web Audio API:** Synthesize all sounds dynamically in code via `AudioContext` (lazily unlocked/resumed on the first user gesture).
- **Zero Audio Files:** Do **not** add `.mp3`, `.wav`, `.ogg`, `.flac`, or external audio samples to the repository. Synthesize flippers, solenoids, pop bumpers, slingshots, plunger spring release, ball rolling friction, stained-glass chimes, and multiball fanfares procedurally.

## 5. Canonical Dimension & Coordinate Contract (`Blender 5.2.3 LTS ↔ Three.js ↔ Rapier3D`)
- **Scale & Tilt:** `1 unit = 1 meter` across Blender, glTF/Three.js, and Rapier3D. Playfield tilt is `6.5°` around `+X` (rear elevated, front lowered toward player).
- **Axis Mapping:** Blender Z-up glTF export (`+Y Up`) maps Blender `(X, Y, Z)` → Three.js/Rapier `(X, Z, -Y)`.
- **Single Source of Truth:** Once scaffolding begins, `src/shared/tableSpec.ts` owns all canonical coordinates matching the Blender `Pinball_Table_Root` blockout:
  - Inner playfield: `0.515 m` wide (`x ∈ [-0.2575, +0.2575]`) × `1.070 m` long
  - Right plunger lane: `0.036 m` wide; divider (`0.008 m` thick, `0.800 m` long) at `x = +0.2175 m`
  - Main active playfield center: `x = -0.022 m`
  - Flipper pivots: Left `x = -0.114 m`, Right `x = +0.070 m`, Blender `y = -0.345 m` (Three.js/Rapier local `z = +0.345 m`), rest angle `28°`, blade length `0.076 m`
  - Pinball radius: `0.0135 m` (`27 mm` standard steel ball)
