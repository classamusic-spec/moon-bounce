# Moon Bounce — Build Guide for Claude Code

You are taking a **fully working single-file prototype** of a children's game and turning it
into a **proper, structured, installable app**. This file is your brief. Read it fully before
starting, then follow the build plan at the bottom.

---

## What this game is

**Moon Bounce: Solar System Adventure** — a gentle, autism- and toddler-friendly 2.5D
side-scrolling platformer built with **Three.js (r128)**. A cute astronaut "blob" travels
across all 8 planets (Mercury → Neptune in order), collecting stars, bumping "?" fact boxes
for spoken space facts, hopping on friendly aliens, finding a glowing "Piece of the Sun" to
finish each level, then flying a rocket to the next planet via a 60-second flight mini-game.

The complete, working prototype is in this folder:
- **`moon-bounce.html`** — the shipped game. Self-contained, runs by double-clicking. Three.js
  is inlined (~700KB). This is the source of truth for *behavior* — when in doubt about how a
  feature should work, run this file and look.
- **`moon-bounce-source.html`** — the same file BEFORE Three.js was inlined. It contains the
  placeholder string `__THREEJS__` where the library gets injected. This ~94KB file is the
  clean source to read and refactor (don't wade through 600KB of minified Three.js).

---

## Non-negotiable design principles (DO NOT break these)

This game is explicitly designed for young children, including kids on the autism spectrum.
Every feature must respect these rules:

1. **No fail state.** No deaths, no game-over, no falling off the map, no score loss, no timers
   that punish. Obstacles *slow or gently nudge*, never kill. In vertical levels a safety net
   catches falls and sets the player gently back down.
2. **Sensory-safe.** Soft eased motion, rounded shapes, gentle Web Audio sounds with soft
   attack. No flashing, no strobe, no harsh noise, no jump-scares.
3. **Calm Mode.** A toggle that slows everything to ~0.55x and mutes all audio. Must keep working.
4. **Big touch targets, simple predictable controls.** Left / Right / Jump. That's it in the
   platformer. The flight mini-game uses Up / Down / Shoot.
5. **Accessibility.** Facts are read aloud via the device's speech synthesis (toggle), with a
   "Hear it again" replay button. Optional ambient music (off by default).

If you add features, they must fit these rules. When unsure, prefer the gentler option.

---

## Current feature set (all working in the prototype)

- **Core platformer:** hold ◀ ▶ to move, JUMP to bounce, squash-and-stretch animation,
  3-layer parallax, per-planet color palettes, planet-progress dots.
- **Fact boxes:** 5 "?" boxes per level, bump from below or land on top → pops and shows a fact
  card; facts are read aloud. 40 kid-friendly facts total (5 per planet).
- **Enemies:** cute googly-eyed aliens waddle on ground; jump on top = squish + reward star;
  walk into = gentle bounce-back (no damage).
- **Piece of the Sun:** glowing goal at the end (horizontal) or top (vertical) of each level.
- **Per-planet terrain** (data-driven, this is the key architecture):
  - Mercury — rolling cratered dunes
  - Venus — stepped plateaus + golden wind zones that push you back
  - Earth — green hills, cloud platforms, bouncy bushes, background birds
  - Mars — canyon steps, rolling rocks, rust spires
  - **Jupiter — VERTICAL CLIMB** (start on ground, scale up stacked gas-band ledges)
  - Saturn — icy flats, floating ring-ice moving platforms, slippery ground
  - **Uranus — VERTICAL CLIMB** (tilted staggered ice shelves)
  - Neptune — trenches/rises, alternating gusts, floating bubble lifts
- **Per-planet dynamic elements:** wind zones, bounce geysers, rolling rocks/sun-flares,
  moving platforms (horizontal shuttles + vertical elevators), ice patches, bubbles, etc.
- **60-second flight mini-game** between levels: blob hops into a rocket (intro animation),
  then a steerable flight (▲▼ to steer, 🔫 to shoot space rocks for reward stars,
  hold-to-autofire, Skip button), collecting bonus stars, target planet grows to fill screen,
  arrival shows a "rocks blasted" tally, then the next level loads.
- **UI:** splash screen, main menu, How-to-Play, Settings (Read / Music / Calm toggles),
  pause menu, and a **Choose Planet** level-select for testing any level.
- **Cleaned HUD:** planet name, ⭐ star count, 🎁 box count, small ⏸ pause button.

---

## How the code is currently organized (single file)

Inside `moon-bounce-source.html` everything lives in one `<script>`:

- **Constants** declared ABOVE the planet data (critical ordering): `LEVEL_LEN=95`,
  `GROUND_Y=-2.0`, `CHAR_R=0.7`. The `PLANETS` array references `LEVEL_LEN`, so these must
  come first or you get a temporal-dead-zone crash.
- **`PLANETS[]`** — the heart of the game. Each planet object has: name, sky colors,
  ground/hill/char/dust/enemy colors, gravity, jump strength, emoji, headline fact, 5 facts,
  a `dyn:{}` block (dynamic elements), and a `terrain:{}` block (`type:'horizontal'|'vertical'`,
  ground shape/steps, platforms, movingPlats, climb data). **The game is fully data-driven from
  this array — adding a level = adding an object here.**
- **Global state:** `pIndex, smallStars, boxesFound, calm, started, paused, mode` (`'platformer'`
  | `'flight'`), `flight` (the flight scene state), plus entity arrays (`platforms, starItems,
  factBoxes, enemies, sunPiece, movers, rollers, bubbles, bouncePads, windZones, movingPlats`, etc).
- **Key functions:** `init()`, `loadLevel(i, instant)` (the terrain interpreter — reads
  `terrain` data and builds the level), `buildDynamics(P)`, `clearLevel()`, mesh factories
  (`makeStarMesh, makeCharacter, makeFactBox, makeEnemy, makeCloud, makeRock, makeGeyser,
  makeIceChunk, makeBubble, makeFlare, makeBush`), `animate()` (main loop, branches on `mode`),
  the physics step, `reachSun()`, `onFactBtn()`, `startFlight()/updateFlight()/endFlight()`,
  audio (`tone, sJump, sStar, sBox, ...`), music, and speech (`speak, replayFact`).
- **Build trick:** the source uses `__THREEJS__` as a placeholder; the shipped file replaces it
  with the inlined library. When you move to npm you delete this and `import * as THREE from "three"`.

---

## THE BUILD PLAN — do these in order

### Step 1 — Scaffold a real project
Create a **Vite + TypeScript** project. Pull Three.js from npm (`npm i three` +
`npm i -D @types/three typescript vite`) instead of the inlined copy. Get `npm run dev` (hot
reload) and `npm run build` working with an empty shell first.

### Step 2 — Port the game into modules
Refactor the single file into a clean module structure. Suggested layout:
```
src/
  core/        constants.ts, types.ts
  data/        planets.ts          ← the PLANETS array (typed)
  entities/    meshes.ts           ← all make* mesh factories
  systems/     level.ts            ← Stage (scene/camera/renderer) + loadLevel terrain interpreter
               dynamics.ts         ← buildDynamics + per-frame dynamic updates
               flight.ts           ← the whole flight mini-game (intro + 60s flight + arrival)
               audio.ts            ← sfx, music, speech
               storage.ts          ← NEW: save progress (see Step 3)
  ui/          ui.ts, styles.css   ← HUD, splash, menu, settings, pause, planet-select
  main_game.ts                     ← the Game class: state, input, physics, loop
  main.ts                          ← entry point
index.html                          ← the DOM scaffold
```
**Keep gameplay identical.** Verify each planet still loads, both vertical climbs work, the
flight mini-game runs, and all menus function. Port behavior faithfully before adding anything.
The TypeScript must compile under `strict` with zero errors.

### Step 3 — Add depth, one feature per commit
Once parity is confirmed:
- **Saved progress** (localStorage): unlocked planets + which facts/stars each planet has.
  Restore on load; resume at highest unlocked planet.
- **Data-driven level layouts**: move platform/star/box positions into JSON so new levels need
  no code. Add 2–3 layout variants per planet.
- **Galaxy level-select map**: turn the planet dots into a real map screen.
- **Real assets**: swap procedural meshes for GLTF models and real audio files (wire up loaders).
- **Settings expansion**: voice-speed slider, volume, motion-reduction toggle.
- **Reward book / sticker collection**: gentle, non-competitive collectibles meta-layer.

### Step 4 — Make it a real installable app (NOT html)
Wrap the built web app as a native app:
- **Mobile (iOS + Android):** add **Capacitor** (`npm i @capacitor/core @capacitor/cli`,
  `npx cap init`, `npx cap add ios`, `npx cap add android`, build the web app, `npx cap sync`,
  open in Xcode / Android Studio). This produces installable App Store / Play Store apps.
- **Desktop:** alternatively **Tauri** or **Electron** for Windows/Mac/Linux builds.
- Handle mobile specifics: lock orientation to portrait, safe-area insets for notches, prevent
  pinch-zoom/scroll, request audio on first tap (already done in the prototype), and make sure
  speech synthesis falls back gracefully on devices without voices.

### Step 5 — Polish & ship
- Performance pass (the prototype is frame-rate-independent already via `clock.getDelta()` —
  keep that). Test on a low-end phone.
- App icon, splash image, store screenshots, privacy policy (it collects nothing — say so).
- Optional: a simple settings/parent-gate before external links.

---

## Testing notes (learned the hard way building the prototype)

- **`THREE.CapsuleGeometry` does not exist in r128.** Use `CylinderGeometry`. (When you upgrade
  to a current Three.js via npm, Capsule is available again.)
- Keep all motion **frame-rate independent** using delta time, not fixed per-frame increments —
  the flight timer especially must be real-seconds (it's a true 60s).
- Vertical-level platform gaps must stay **below the jump height** (jump²/(2·gravity)). The
  prototype keeps gaps ≤ ~2.8 vs jump heights of 6–8.5. Verify any new climb the same way.
- Constants must be declared before the `PLANETS` array (TDZ crash otherwise).
- When testing in a headless browser, top-level `const`/`let` aren't on `window`; expose a small
  debug hook if you need to drive state from tests.

---

## What "done" looks like

A Vite + TypeScript codebase that builds clean, runs in the browser identically to the
prototype, saves progress, and packages via Capacitor into installable iOS and Android apps —
with the gentle, no-fail, sensory-safe design fully intact.
