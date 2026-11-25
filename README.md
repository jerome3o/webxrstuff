# 百步穿杨 · Bǎi Bù Chuān Yáng

A WebXR archery range at dusk, built for the Steam Frame (and any WebXR headset), with a desktop mode for quick testing.

The name is an idiom: *to pierce a willow leaf at a hundred paces*. There is a willow leaf about 90 m down the range. Hitting it with the bow is the legendary shot.

## Play

WebXR needs HTTPS. The easiest route is GitHub Pages (workflow included):

1. Repo **Settings → Pages → Source: GitHub Actions**.
2. Push to `main`. The page lands at `https://<user>.github.io/webxrstuff/`.
3. Open that URL in the headset browser and press **进入 Enter VR**.

Local testing on desktop: `python3 -m http.server 8000` and open `http://localhost:8000`.

## Weapons

| | Weapon | Behaviour | Ammo |
|---|---|---|---|
| 弓 | Horn bow | Real draw: bring your main hand to the string, hold trigger or grip, pull, release. Draw length sets arrow speed. Gravity and drag drop the arrow. | 20 to start, 30 cap |
| 火龙 | Fire-dragon rocket | Slow launch, accelerates while the motor burns, corkscrews a little, 5.5 m blast. Lead moving targets. | 4 to start, 8 cap |
| 穿云 | Cloud-piercer rifle | Hold trigger to charge (1.25 s), release to fire. 850 m/s round. Scope renders a live 6° zoom on the eyepiece. | 5 to start, 10 cap |
| 手铳 | Hand cannon | Fast, unlimited. The only gun that cracks the floating supply crates (补给箱). | ∞ |

Crates are labelled 箭 (arrows), 火 (rockets) or 弹 (rifle rounds) and spawn weighted toward whatever you're lowest on.

## Targets

- **箭靶** ring targets at 10–86 m. Score by ring, ×distance. Dead centre pays coins.
- **灯笼** hanging lanterns on swaying ropes. **孔明灯** sky lanterns that rise; higher is worth more.
- **锣** gong: shoot it to start a 90-second round (一炷香, "one stick of incense". Watch the incense burner by the rail burn down).
- **青花瓷** porcelain vases. **福** plaques (hung upside down because 倒 *dào* sounds like 到 *dào*: "luck has arrived").
- **铜钱** a giant cash coin: send a projectile through the square hole.
- **龙风筝** dragon kite: body segments for points, head shot brings it down.
- **杨柳叶** the willow leaf. **仙鹤** cranes. Don't shoot the cranes.

Hits build a combo (×1.5 every 5 hits, up to ×4). A miss breaks it. Points earn 铜钱 copper coins, spent at the 兵器库 armoury board on upgrades and bow skins. Progress is saved in the browser.

## Controls

**VR:** bow in the off hand, main hand draws. Guns go in the main hand. A/X next weapon, B/Y previous. Thumbstick forward aims a teleport arc (release to jump), sideways snap-turns, click returns you to the shooting line facing the range. Your ammo and coins float beside the weapon you're holding. Point at a board and pull the trigger to click. Handedness switch is on the armoury board.

**Desktop:** mouse aims (click to lock the pointer), hold left to draw or charge, right button zooms the rifle, 1–4 or Q/E switch weapons, WASD moves, G rings the gong, M toggles music.

## Code map

No build step. ES modules plus a vendored Three.js r170.

| File | What it does |
|---|---|
| `src/config.js` | Every tuning number: weapon speeds, drag, charge time, ammo, scoring, shop. Start here. |
| `src/physics.js` | Swept-segment collision (sphere, box, disk) in object-local space, plus raycast against static meshes. No tunnelling at rifle speeds. |
| `src/projectiles.js` | Arrow, rocket and bullet flight: gravity, quadratic drag, wind, rocket thrust; sticking and wobble. |
| `src/weapons.js` | Bow model and draw mechanics, gun models, scope render-to-texture, firing and haptics. |
| `src/targets.js` | All target types and how they respond to hits and blasts. |
| `src/game.js` | Scoring, combos, ammo economy, coins and shop, rounds, wind, spawner, saving. |
| `src/environment.js` | Sky, shan-shui mountains, walls, gate, pagodas, pond and koi, plum tree, bamboo, willow, banners, cranes. |
| `src/audio.js` | All sound is synthesised: weapons, impacts by material, gong, firecrackers, and generative guzheng-style music in D pentatonic. |
| `src/particles.js` | Pooled GPU point particles for sparks, smoke, paper, porcelain shards, explosions, fireworks. |
| `src/ui.js`, `src/hud.js` | Canvas-texture boards with laser pointing, floating score popups, wrist display. |
| `src/main.js` | Renderer, XR session, controller input, desktop fallback, frame loop. |

`window.__game` exposes the game objects in the console for poking at things.
