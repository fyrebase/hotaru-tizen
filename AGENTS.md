# Hotaru for Samsung TVs

A TizenBrew app module that browses and plays a Plex server: the TV counterpart of the macOS app in `../gpui-player`. `app.js` is the whole app, `index.html` its markup and styles, `package.json` the TizenBrew module manifest, and `check.js` the one test.

## Working here

- No framework and no build step. TizenBrew serves the repo's files as they are, through jsDelivr.
- Write for Tizen 4, which runs Chromium 56: no `?.`, `??`, object spread, `.at()` or trailing commas in calls in JS; no CSS grid, flex `gap`, `aspect-ratio` or `inset`.
- How the app looks and moves, and why, is in `DESIGN.md`. Its rules come from the Mac app's `../gpui-player/DESIGN.md`, and the Plex API usage from its `src/plex.rs`: port from there before inventing.
- A `ponytail:` comment marks a deliberate shortcut and names its ceiling and the way past it.
- Run `node check.js` after changing anything it exercises: it covers the pure functions `app.js` exports.

## Testing in a desktop browser

Serve the repo with `npx serve -l 8081` and open `http://localhost:8081` at a 1920×1080 viewport. It has to be a `localhost` or `127.0.0.1` address: Plex Media Server answers CORS only for those and `https://app.plex.tv`, so from a LAN address such as `http://192.168.1.17:8081` every server check fails and sign-in ends in "No Plex server on this account answered". From another machine, tunnel the port (`ssh -L 8081:localhost:8081 <mac>`). TizenBrew serves the app from `http://127.0.0.1:8081`, so the TV is fine. The arrow keys, Enter, Escape (Back) and Space (play/pause) stand in for the remote. hls.js plays HLS where the browser can't.

## Publishing to the TV

TizenBrew loads the module from `gh/<owner>/<repo>` through jsDelivr, which caches a branch for up to 12 hours. To see a change on the TV sooner, purge each changed file once, a few seconds after pushing: `https://purge.jsdelivr.net/gh/<owner>/<repo>/<file>`. Repeated purges get a file throttled (`"throttled": true`) for about half an hour, and purging while throttled seems to extend it. To test a commit at once, add the module pinned to it, `<owner>/<repo>@<sha>`, which jsDelivr has never cached; remove it afterwards.

On the owner's TV, TizenBrew's autolaunch is off; if it's on, pressing Up repeatedly while TizenBrew starts skips it for that start. Holding Back in a running app returns to TizenBrew's menu; history.back() from the app doesn't. In the Module Manager, **Add GitHub module** adds `gh/` itself, so type only `fyrebase/hotaru-tizenbrew`. The box saves when it loses focus, not on Enter. Enter on a module's card asks to delete it.

Running on the TV so far: sign-in, the libraries, D-pad navigation, HLS playback without hls.js, and HEVC MP4 played straight off the server: Dolby Vision profile 8 (Tuner) shows as Dolby Vision, smoothly. Not yet checked there: the media keys.

## Guardrails

- The Plex server is the owner's real library, shared with other people. Reads are safe. Leave marking watched or unwatched (`scrobble`, `unscrobble`) untested against it. Test progress reports (`/:/timeline`) and OpenSubtitles downloads only on the item the owner set aside for them, The Terminal List S1 E1: reports move its resume point and can mark it watched, and a download attaches and selects a subtitle track on the server for a few seconds before unselecting it. Searching OpenSubtitles only reads. Stop only the HLS sessions this app started.
- Sign-in goes through plex.tv/link; the chosen server's address and token live in the browser's `localStorage`. Keep the token out of files, commits and command output.
