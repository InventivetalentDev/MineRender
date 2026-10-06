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
- `src/examples/*.ts` define the live examples. Each `Example` has a `setup()` that builds the scene and a `code` block shown next to the viewport; keep the two equivalent. `scene.ts` is the composed hero scene.
- `src/playground/Playground.ts` is the hero stage: tabs over one viewport with a status line and a reset button.
- `src/viewport/` keeps the page cheap: `Viewport` creates a renderer only while on screen, and `RendererPool` caps the number of live renderers (two by default, evicting the one farthest from the screen centre). Evicted viewports keep a snapshot of their last frame.
- `src/showcase/Showcase.ts` renders one example group: chips to pick an example, a single viewport, and the code panel.
- `src/icons.ts` draws the 8×8 pixel icons used in the feature list.

## Design notes

Fonts: Bricolage Grotesque for headings, IBM Plex Sans for text, IBM Plex Mono for code. Colours come from the subject (stone, paper, ink, moss, sprout, loam) and are defined once as tokens at the top of `src/style.css`, with a dark variant. The hero stage is the only element with a hard offset shadow; everything else uses hairlines.
