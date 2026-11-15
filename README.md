# DUSTLINE — Yard Siege

A round-based tactical FPS in three.js. Two teams of four fight short rounds
in a dusk industrial yard: Vanguard attacks, Cinder defends. Win a round by
wiping the other team or by planting the spike at site A or B (and holding it
until it detonates); Cinder wins by defusing or running the clock out. First
to 5 rounds takes the match. Between rounds you get a buy phase: spend the
money you earned on rifles, SMGs, a DMR, a shotgun, armour and grenades.
Weapons you survive with stay yours.

## Play

Open `game/index.html` from any static server — no build step, no network at
runtime, everything is vendored or generated locally:

```sh
node serve.ts            # serves game/ at http://localhost:8080
```

or `python3 -m http.server` from `game/`. Then click **Click to play**
(the browser asks for pointer lock; Esc pauses).

| Key | Action |
| --- | ------ |
| W A S D | Move · Shift walk · Space jump · Ctrl crouch |
| Mouse | Look · Click fire · Right mouse scope (DMR) |
| 1–5 | Weapons · 6 grenade · R reload · B buy menu |
| E | Plant / defuse the spike (hold, near a site) |

Single player against bots: 3 ally bots and 4 enemy bots with waypoint
routes, line-of-sight perception, reaction times, burst fire, hearing,
planting and defusing. The HUD shows health, armour, ammo, money, round
timer, round score, kill feed, a live minimap and the spike state.

## Layout

- `main.ts` — Node 22 entrypoint: copies `game/` and `screenshots/` to
  `/output` and writes `/output/dossier.json` (see `vendor/makefun-threejs.ts`).
- `game/` — the playable game: static ES modules, three.js 0.187.0 vendored
  under `game/vendor/three/`, exactly one import map in `game/index.html`.
- `game/src/` — the game itself: `map.js` (yard, nav graph), `mover.js`
  (shared player/bot physics), `bots.js` (bot AI), `combat.js` (hitscan,
  damage, grenades), `weapons.js` (magazines, shop, view models), `hud.js`,
  `input.js`, `audio.js` (synthesised WebAudio sounds), `game.js` (rounds,
  economy, spike, spectating), `main.js` (boot + fixed-step loop).
- `screenshots/` — three captured frames: menu, mid-round firefight, round win.
- `serve.ts` — a tiny static server for local playtesting.

Deterministic captures: `game/index.html?shot=start|play|end&seed=1` sets up
a fixed frame and signals `window.__shotReady` once it is painted twice.

MIT licensed. Built for the make.fun bounty "Make the best three.js tactical
FPS" (threejs-fps-02).
