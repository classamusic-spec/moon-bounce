# Moon Bounce — Hand-off to Claude Code

This folder is everything you need to take the Moon Bounce prototype into **Claude Code** and
build it into a full, installable app.

## What's in here

| File | What it is |
|------|------------|
| `moon-bounce.html` | The **complete working game**. Double-click to play it right now (offline). Three.js is baked in. |
| `moon-bounce-source.html` | The **clean source** to refactor (Three.js not inlined — has a `__THREEJS__` placeholder). Read this one. |
| `CLAUDE.md` | The **brief for Claude Code** — what the game is, its architecture, the design rules, and a step-by-step build plan. Claude Code reads this automatically. |
| `README.md` | This file. |

## Before you start

Claude Code is a **local** command-line tool that runs on your computer — it is not this chat.
You'll need:
- **Node.js** installed (LTS version). Check with `node -v`.
- **Claude Code** installed and signed in.

Install steps and requirements change, so get the current ones from the official docs rather
than trusting any pasted command:
- https://docs.claude.com  (search "Claude Code install")

## Steps to port it

1. **Unzip** this folder somewhere sensible, e.g. `~/projects/moon-bounce/`.

2. **Open a terminal** in that folder:
   ```bash
   cd ~/projects/moon-bounce
   ```

3. **Start Claude Code** in the folder:
   ```bash
   claude
   ```
   (Or open the folder in the Claude Code VS Code / JetBrains extension.)

4. **Give it the kickoff message.** Claude Code will auto-read `CLAUDE.md`, but start it with:

   > Read CLAUDE.md, then run the game in moon-bounce.html so you understand how it plays.
   > Then do **Step 1 and Step 2** of the build plan: scaffold a Vite + TypeScript project
   > pulling Three.js from npm, and refactor moon-bounce-source.html into the module structure
   > described. Keep gameplay identical and make `npm run build` pass with zero TypeScript
   > errors. Don't add new features yet — get faithful parity first, then check in with me.

5. **Review and iterate.** When parity is confirmed, work through Step 3 (depth features) one at
   a time, then Step 4 (Capacitor for a real iOS/Android app). The plan and order are all in
   `CLAUDE.md`.

## Tips

- Let Claude Code work **one step at a time** and review each change. The refactor (Step 2) is
  the big one — confirm every planet, both vertical climbs, the flight mini-game, and all menus
  still work before moving on.
- Keep the **design rules** in `CLAUDE.md` front and center — this game's whole point is being
  gentle and no-fail. If a change makes it harsher, push back.
- The prototype is the **behavior reference**. Any time there's a question about how something
  should feel, run `moon-bounce.html` and look.

---

## Developing the ported app (Vite + TypeScript)

Steps 1 & 2 of the build plan are done: the prototype has been scaffolded as a Vite + TypeScript
project (Three.js pulled from npm) and refactored into modules under `src/`. Gameplay is a
faithful port of `moon-bounce-source.html` — same constants, physics, and data.

```bash
npm install       # install deps (three, vite, typescript)
npm run dev       # hot-reload dev server (http://localhost:5173)
npm run build     # tsc --strict + vite production build → dist/
npm run preview   # serve the production build
npm run typecheck # type-only check (strict, zero errors)
```

### Module layout
```
src/
  core/        constants.ts, types.ts
  data/        planets.ts          ← the PLANETS array (typed)
  entities/    meshes.ts           ← all make* mesh factories
  systems/     level.ts            ← Stage + loadLevel terrain interpreter
               dynamics.ts         ← buildDynamics + per-frame dynamic updates
               flight.ts           ← the 60s flight mini-game (intro + flight + arrival)
               audio.ts            ← sfx, music, speech
  ui/          ui.ts, styles.css   ← HUD, splash, menu, settings, pause, planet-select
  main_game.ts                     ← the Game class: state, input, physics, loop
  main.ts                          ← entry point
index.html                         ← the DOM scaffold
```

The reference prototype (`moon-bounce.html`, `moon-bounce-source.html`) is kept in the repo
as the behavior source of truth. Step 3 (depth features: saved progress, etc.) is not started yet.
