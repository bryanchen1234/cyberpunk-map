# STATUS (Bryan's fork) — 2026-10-13

Free, personal replacement for "Game Maps IRL"'s cyberpunk map. A website you
add to the iPhone home screen (a PWA: it opens fullscreen like an app).

**Live URL:** https://bryanchen1234.github.io/cyberpunk-map/
**Code:** https://github.com/bryanchen1234/cyberpunk-map (fork of ggigelmo/games-map, MIT)

## What works (tested in the browser on 2026-10-13)
- Map styled like the **Cyberpunk 2077 in-game map** (patch 2.x): navy
  ground, red 3D building blocks, wide see-through cyan streets, yellow GPS
  route, green player arrow. Colors were measured from real game
  screenshots (references not in the repo; no game files used).
- **Night City: on / off** button: swaps to a normal street map and back; remembered.
- Search (Photon) → route (Valhalla) → GO turn-by-turn with spoken
  directions, auto-reroute. Works anywhere in the world, not just SD.
- **Avoid hwy / Avoid tolls** buttons (remembered; re-plans the route).
- US units: mi / ft / mph.
- `npm test` → 62 passed.

## Not done / limits
- **No CarPlay.** A website can't show on CarPlay. That needs a native iPhone
  app, a $99/yr Apple Developer account, *and* Apple approving a navigation
  entitlement (they may refuse a hobby app). Use the phone in a mount.
  If Bryan pays for it later: rebuild with MapLibre Native + CarPlay; the
  style JSON carries over.
- Search and routing use free "fair use" public servers: fine for one person,
  no uptime guarantee. The free router refuses trips longer than ~930 mi
  (1500 km) straight-line; the app shows that reason. If they go down, search or routing shows an error and
  the map still works.
- Not yet driven on a real road by me. The original author verified GPS in
  the home-screen PWA on a real iPhone.

## How to change it
```bash
npm install
npm run dev          # http://localhost:5173
npm test
git push             # goes to Bryan's fork (origin); Actions redeploys the live URL
# (the original project is the `upstream` remote)
```
Main files: `app/src/main.ts` (buttons, Night City toggle, route options),
`style/build.mjs` (the game palette; it regenerates `style/cyberpunk.json`),
`app/src/route/route-layer.ts` (yellow GPS line), `app/src/map/map.ts` (green arrow),
`app/src/services/{geocoding,routing}.ts` (search and routes).
