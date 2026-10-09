# MineRender V2 website

The public site for MineRender V2: feature overview, live examples for every content type, and usage documentation.

- `yarn dev:site` starts a Vite dev server (builds the library first).
- `yarn workspace @minerender/site build` writes a static site to `apps/site/dist/`.

## Deploying

The site is static and deploys as a Cloudflare Worker with assets only (`wrangler.jsonc`, worker name `minerender-site`). Log in once with `yarn workspace @minerender/site wrangler login`, then from the repository root:

- `yarn deploy:site:preview` builds the library and site and uploads a new version without promoting it. Wrangler prints a `*-minerender-site.<account>.workers.dev` preview URL for that version.
- `yarn deploy:site` builds and deploys to `minerender-site.<account>.workers.dev` (and any route attached in the dashboard).
- `yarn workspace @minerender/site preview:cf` serves the built `dist/` through the local Workers runtime, which includes the `_headers` rules.

`public/_headers` marks hashed files under `/assets/` as immutable; the HTML stays revalidated on every request. Unknown paths return a plain 404.

## Layout

- `index.html` holds the static copy: hero, "what changed" list, usage docs, and the V1 migration guide. Keep the copy plain; it describes what the library does, not how great it is.
- `src/examples/*.ts` define the live examples, one file per group (skins, blocks, items, entities, structures, gui, exports, resourcepacks). Each `Example` has a `setup()` that builds the scene and a `code` block shown next to the viewport; keep the two equivalent. `scene.ts` is the composed hero scene.
- `src/playground/Playground.ts` is the hero stage: tabs over one viewport with a status line and a reset button.
- `src/viewport/` keeps the page cheap: `Viewport` creates a renderer only while on screen, and `RendererPool` caps the number of live renderers (two by default, evicting the one farthest from the screen centre). Evicted viewports keep a snapshot of their last frame.
- `src/showcase/Showcase.ts` renders one example group: chips to pick an example, a single viewport, and the code panel.
- `src/icons.ts` draws the 8×8 pixel icons used in the feature list.

## Announcement video

`video.html` is a render stage, not part of the deployed site (Vite only builds `index.html`). `yarn video` renders the timeline in `src/video/timeline.ts` to `apps/site/.video/hero.mp4`; pass `--timeline vertical --size 1080x1920` for the portrait cut, `--shots id,id` for a subset, `--headed` to render through a visible Chrome with the real GPU (recommended for the final render; headless uses SwiftShader), and `--fps`, `--transition`, or `--out` to adjust the encode. Headed renders emulate the viewport at half size with device scale 2 (`--scale`), so the window fits a laptop screen while the frames stay full resolution. `--supersample 2` renders at twice the size and scales down in ffmpeg, which smooths cutout textures such as leaves at four times the GPU cost. ffmpeg must be on the path.

- `scripts/render-video.mjs` starts a Vite dev server, opens the stage in Chrome through puppeteer-core, loads one shot at a time, steps it frame by frame, and pipes screenshots into ffmpeg. Per-shot clips are joined with crossfades.
- `scripts/virtual-clock.js` is injected before any page script. It replaces timers, `performance.now`, and `requestAnimationFrame` so time only advances when the driver steps a frame; while a shot loads, time runs normally so request queues work. Loading time never appears in the video.
- `src/video/shots/*.ts` define shots: `prepare()` loads assets, `update(t)` sets the camera, poses, and overlay for one frame. Shots can reuse the site examples through `runExample()`. Nothing in the stage uses CSS transitions; every visual change goes through `update()` so it is deterministic.
- Opening `/video.html` in a normal browser (`yarn dev:site`) plays the timeline in real time as a preview.

## Design notes

Fonts: Bricolage Grotesque for headings, IBM Plex Sans for text, IBM Plex Mono for code. Colours come from the subject (stone, paper, ink, moss, sprout, loam) and are defined once as tokens at the top of `src/style.css`, with a dark variant. The hero stage is the only element with a hard offset shadow; everything else uses hairlines.
