# MineRender V2 website

The public site for MineRender V2: feature overview, live examples for every content type, and usage documentation.

- `yarn dev:site` starts a Vite dev server (builds the library first).
- `yarn workspace @minerender/site build` writes a static site to `apps/site/dist/`.

## Layout

- `index.html` holds the static copy: hero, feature grid, getting started, usage docs, and the V1 migration table.
- `src/examples/*.ts` define the live examples. Each `Example` has a `setup()` that builds the scene and a `code` block shown next to the viewport; keep the two equivalent.
- `src/viewport/` keeps the page cheap: `Viewport` creates a renderer only while on screen, and `RendererPool` caps the number of live renderers (two by default). Evicted viewports keep a snapshot of their last frame.
- `src/showcase/Showcase.ts` renders one example group: chips to pick an example, a single viewport, and the code panel.
