# MineRender playgrounds

Interactive demos and a [scene editor](src/editor/README.md) for trying out the library. The public website has its own examples; `examples/` holds minimal consumer setups.

```sh
yarn dev:web                       # http://127.0.0.1:3000/
yarn dev:web --host 0.0.0.0 --port 4000
yarn workspace @minerender/web typecheck
yarn workspace @minerender/web check       # loads every page and preset in headless Chrome
```

`check` starts the dev server on its own, reports the status line and console errors per page, and saves screenshots to `.screenshots/`. It uses the installed Google Chrome; set `CHROME_PATH` for another binary.

## Deploy to Cloudflare

Run these commands from the repository root:

```sh
yarn build:web                  # Build apps/web/dist/
yarn preview:web                # Preview at http://localhost:8787/demo/
yarn deploy:web --dry-run        # Check deployment packaging
yarn deploy:web                  # Deploy the minerender-web Worker
```

`apps/web/wrangler.jsonc` deploys the built files with Workers Static Assets.
The editor is at `/editor/`; the demo index is at `/demo/`. Individual demos stay
under `/demo/`, and test pages move from `/test/` to `/demo/test/`. The development
server keeps its existing paths. Missing deployed paths return 404 responses.

For Workers Builds, set the root directory to `.`, the build command to
`yarn build:web`, and the deploy command to
`yarn workspace @minerender/web exec wrangler deploy`.

Choose your hostname, then assign these four routes to `minerender-web`:
`YOUR_DOMAIN/editor`, `YOUR_DOMAIN/editor/*`, `YOUR_DOMAIN/demo`, and
`YOUR_DOMAIN/demo/*`. These routes leave the rest of the website with its existing
host. To manage routes in source, add this configuration to `wrangler.jsonc`,
replacing the example hostname and zone:

```json
"routes": [
    { "pattern": "example.com/editor", "zone_name": "example.com" },
    { "pattern": "example.com/editor/*", "zone_name": "example.com" },
    { "pattern": "example.com/demo", "zone_name": "example.com" },
    { "pattern": "example.com/demo/*", "zone_name": "example.com" }
]
```

Use `/editor/` and `/demo/` in links. The bare paths redirect to the trailing-slash
URLs, but Cloudflare's exact-path routes do not match `/editor?query` or
`/demo?query`. See [route matching](https://developers.cloudflare.com/workers/configuration/routing/routes/#matching-behavior).
On the Worker preview hostname, open `/demo/` or `/editor/`; there is no root page.

Minecraft assets and player textures load from their existing external providers.
Saved editor scenes remain in the browser or downloaded JSON files.

## Pages

These paths are relative to the development server root:

| Page | Content |
|---|---|
| `editor/` | Mixed scenes with object controls, transforms, animations, import, and export |
| `demo/block/` | Blockstates with property pickers, multipart models, block entities, tints |
| `demo/item/` | Item definitions or model files, display poses, tints |
| `demo/skin/` | Player skins and capes, model/layout overrides, poses, visible parts |
| `demo/entity/` | Dataset passes or manual layers, states, tints, texture overrides, keyframe animations |
| `demo/gui/` | Chest and recipe layouts, custom texture/item layers, layer JSON |
| `demo/structure/` | Built-in structures, local `.nbt`/`.schematic`/`.mca` files, random block workloads, section meshing, block edits |
| `test/custom_model/` | Java model JSON editor |
| `test/exports/` | Image and 3D export of a small instanced scene |
| `test/materials/` | Canvas material shader regression check |

The sidebar from `src/playground/Playground.ts` provides presets, renderer and camera settings, Minecraft version / hosted root / resource-pack ZIP, exports, and a shareable link or JSON that restores the page state. Local files are not part of shared links and have to be selected again.

## Adding a page

Create `src/<group>/<name>/index.html` (copy an existing one) and `script.ts`. A page constructs a `Playground` with serializable `defaults`, optional `presets`, an async `load(ctx, state)` that builds the scene for `state` and returns the content's bounds plus an `activate` callback that syncs the page controls, and optionally `code(state)` for the "Copy code" snippet. Loads run one at a time; a failed load keeps the previous preview and reverts the saved state.
