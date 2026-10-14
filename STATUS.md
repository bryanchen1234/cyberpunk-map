# STATUS (Bryan's fork) — 2026-10-13

Free, personal replacement for "Game Maps IRL"'s cyberpunk map. A website you
add to the iPhone home screen (a PWA: it opens fullscreen like an app).

**Live URL:** https://bryanchen1234.github.io/cyberpunk-map/
**Code:** https://github.com/bryanchen1234/cyberpunk-map (fork of ggigelmo/games-map, MIT)

## What works (tested in the browser on 2026-10-13)
- Cyberpunk neon map, follows your GPS, turns with your heading.
- **Neon: on / off** button: swaps to a normal street map and back; remembered.
- Search (Photon) → route (Valhalla) → GO turn-by-turn with spoken directions.
- US units: mi / ft / mph.
- `npm test` → 60 passed.

## Not done / limits
- **No CarPlay.** It needs a $99/yr Apple Developer account *and* Apple
  approving a navigation entitlement. They may refuse a hobby app. Use the phone in a mount.
- Search and routing use free "fair use" public servers: fine for one person,
  no uptime guarantee. If they go down, search or routing shows an error and
  the map still works.
- Not yet driven on a real road by me. The original author verified GPS in
  the home-screen PWA on a real iPhone.

## How to change it
```bash
npm install
npm run dev          # http://localhost:5173
npm test
git push             # GitHub Actions rebuilds and redeploys the live URL
```
Main files: `app/src/main.ts` (buttons, neon toggle), `style/build.mjs`
(the neon colors; it regenerates `style/cyberpunk.json`),
`app/src/services/{geocoding,routing}.ts` (search and routes).
