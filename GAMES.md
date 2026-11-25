# Writing a game for the VR Playground

Every game is a folder `games/<id>/` with an `index.js` that exports `create(ctx)`.
The platform (`src/platform/`) owns the renderer, the WebXR session, input, audio and the hub.
A working minimal example lives in `games/_template/index.js`.

## Contract

```js
export async function create(ctx) {
  // build your world into ctx.scene (a fresh THREE.Scene per launch)
  return {
    spawn: { x: 0, z: 0, yaw: 0 },   // optional: where the player's head is placed on load / VR start
    update(dt, time) { },            // called every frame; dt in seconds (clamped to 0.05)
    dispose() { },                   // remove window/document listeners, DOM nodes, timers, audio loops
    render(renderer, scene, camera) { }, // optional: replace the default renderer.render call
    onXRStart() { }, onXREnd() { },  // optional
  };
}
```

The platform disposes geometries/materials/textures in `ctx.scene` after `dispose()`, removes anything
you parented to the rig or controllers, and resets the rig. Module-level state survives relaunches, so
keep game state inside `create`.

## ctx

| field | what |
|---|---|
| `ctx.scene` | fresh `THREE.Scene` for this launch. Set background, fog, lights yourself. |
| `ctx.camera` | the camera (child of `ctx.rig`). In VR its pose comes from the headset. Don't reparent it. |
| `ctx.rig` | `THREE.Group` holding camera and controllers. Move/rotate it for locomotion. Origin = floor under the player. |
| `ctx.input` | see below |
| `ctx.audio` | `{ ctx: AudioContext, out: GainNode }`, already created by a user gesture. Connect to `ctx.audio.out`. |
| `ctx.kit` | helpers from `src/platform/kit.js` (also importable directly) |
| `ctx.renderer` | the `THREE.WebGLRenderer` (xr enabled). If you render to a render target in VR, toggle `renderer.xr.enabled` off around it. |
| `ctx.isXR()` | true while in VR |
| `ctx.recenter(x, z, yaw)` | put the player's head at (x, z) facing yaw (0 = -Z) |
| `ctx.exit()` | go back to the hub |
| `ctx.save(key, value)` / `ctx.load(key, fallback)` | localStorage, namespaced, never throws. Prefix keys with your game id. |
| `ctx.setHud(html)` | desktop-only status line at the bottom of the screen |

## ctx.input

`input.main` / `input.off` (dominant / other hand; respects `input.leftHanded`), `input.left` / `input.right`:

- `present`, `gripPos`, `gripQuat`, `rayPos`, `rayQuat` (world space), `rayDir()`
- `trigger`, `squeeze` (0..1), edges `triggerDown`, `triggerUp`, `squeezeDown`, `squeezeUp`
- `a`, `b`, `stick` (edges: A/X, B/Y, thumbstick click), `aHeld`, `bHeld`, `stickHeld`
- `axes` = `[x, y]` thumbstick, y = -1 pushed forward
- `velocity` (Vector3 m/s, grip), `angularSpeed` (rad/s) for swings and throws
- `haptic(intensity 0..1, ms)`

`input.head` = `{ pos, quat, fwd, up }` world space. `input.desktop` / `input.xr` booleans.
`input.trackedHand('left'|'right')` returns `{ joints }` (XRHand joint Object3Ds keyed by WebXR joint name, e.g. `'index-finger-tip'`) when hand tracking is active, else null. With hand tracking and no controller, `trigger` = pinch.

Reserved: **holding X or Y on the left controller, or B on the right, for 1 s returns to the hub** (Tab on desktop). Short presses still reach the game, so avoid long-hold actions on those buttons.

### Desktop emulation
Pointer-locked mouse look. Main hand ray = crosshair (camera ray); main grip sits lower right of view, off grip lower left.
LMB/RMB = main trigger/squeeze, E/R = main A/B, C = main stick click, arrow keys = main stick.
Q/F = off trigger/squeeze, X/Z = off X/Y, V = off stick click, WASD = off stick. `input.mouse`, `input.key(code)`,
`input.keyDown(code)` give raw access. Set `input.lookEnabled = false` to take over the mouse.

## kit.js helpers

`Panel` (canvas board with buttons) + `Pointer` (laser for Panels), `Teleporter` (arc teleport),
`Locomotion` (stick move + snap turn), `rotateRigAround`, `makeLabel` (text sprite), `Sfx` (one-shot synth tones/noise with optional 3D position), `disposeObject`, `FONTS`.

## Rules

- Import only `three` and `three/addons/...` from the vendored set: `utils/BufferGeometryUtils.js`, `math/ImprovedNoise.js`, `math/SimplexNoise.js`, `geometries/RoundedBoxGeometry.js`. No other network: no CDNs, no fetched assets, no fonts beyond the ones the page loads (Ma Shan Zheng, Noto Serif SC, Cormorant Garamond, Inter). Generate textures with canvas, sounds with WebAudio. Web Workers from your own files are fine (`new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`).
- Performance target is a standalone headset (Snapdragon-class) at 90 Hz, rendered twice: keep draw calls under ~150, avoid shadow maps (or one small one), prefer MeshLambert/MeshStandard with few lights, use InstancedMesh and merged geometry, avoid per-frame allocations in hot loops.
- Must work with controllers in VR and be playable on desktop with the emulation above.
- Stand-up scale: 1 unit = 1 metre, floor at y = 0, player starts at the origin facing -Z.
- Original content only: genre conventions are fine, but don't copy another game's name, characters, art, music or levels.

## Testing

Serve the repo root (`python3 -m http.server <port>`), then open `/index.html?game=<id>&desktop=1`.
`window.__platform` exposes `{ ctx, launch, input, current, currentId, scene }`.
Headless Chromium works with `chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })`
but runs at ~8 fps, so game time advances slowly; wait accordingly. In tests set `__platform.input.locked = true; __platform.input.freezeLook = true`
and drive `input.yaw` / `input.pitch` and `page.mouse.down()/up()` / `page.keyboard` directly.
