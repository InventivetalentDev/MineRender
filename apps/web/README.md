# MineRender playgrounds

Interactive demos and a [scene editor](src/editor/README.md) for trying out the library. The public website has its own examples; `examples/` holds minimal consumer setups.

```sh
yarn dev:web                       # http://127.0.0.1:3000/
yarn dev:web --host 0.0.0.0 --port 4000
yarn workspace @minerender/web typecheck
yarn workspace @minerender/web check       # loads every page and preset in headless Chrome
```

`check` starts the dev server on its own, reports the status line and console errors per page, and saves screenshots to `.screenshots/`. It uses the installed Google Chrome; set `CHROME_PATH` for another binary.

## Pages

These paths are relative to the development server root:

| Page | Content |
|---|---|
| `editor/` | Mixed scenes with object controls, transforms, animations, import, and export |
| `demo/block/` | Blockstates with property pickers, multipart models, block entities, tints |
| `demo/item/` | Item definitions or model files, display poses, tints, data components and properties, banner, shield, shulker box, trident, and bundle previews |
| `demo/skin/` | Player skins and capes, model/layout overrides, poses, visible parts |
| `demo/entity/` | Dataset passes or manual layers, states, tints, texture overrides, keyframe animations |
| `demo/gui/` | Chest, recipe, boss bar, and book layouts, custom texture/item/text layers, layer JSON |
| `demo/structure/` | Built-in structures, local `.nbt`/`.schematic`/`.schem`/`.litematic`/`.mca` files, random block workloads, section meshing, block edits |
| `demo/world/` | Local Java world folders and region files, dimension selection, view-center chunk streaming, sample terrain |
| `demo/custom_model/` | Java model JSON editor |
| `demo/exports/` | Image, video, and 3D export of a small instanced scene |
| `demo/materials/` | Canvas material shader regression check |

The sidebar from `src/playground/Playground.ts` provides presets, renderer and camera settings, Minecraft version / hosted root / resource-pack ZIP, image, video, and 3D exports, and a shareable link or JSON that restores the page state. Local files are not part of shared links and have to be selected again.

The world page uses a separate streaming viewer. Select a world folder or region files with their external `c.x.z.mcc` chunk files, choose a dimension, then pan or enter chunk coordinates. Pre-1.13 numeric chunks use the legacy schematic mappings and modern assets; those mappings do not reconstruct states from neighbors or block-entity NBT. For paletted chunks, choose the matching asset version. Local saves start with one chunk; increase the load radius to include neighbors. Enable **Render saved mobs** to load supported mobs from embedded records and the dimension's `entities/` folder. Entity regions require a world-folder selection; loose files are treated as terrain. File contents stay in the browser. Lighting, biome tint, and LOD remain unsupported.

## Adding a page

Create `src/demo/<name>/index.html` (copy an existing one) and `script.ts`. A page constructs a `Playground` with serializable `defaults`, optional `presets`, an async `load(ctx, state)` that builds the scene for `state` and returns the content's bounds plus an `activate` callback that syncs the page controls, and optionally `code(state)` for the "Copy code" snippet. Loads run one at a time; a failed load keeps the previous preview and reverts the saved state.
