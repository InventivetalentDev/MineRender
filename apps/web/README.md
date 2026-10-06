# Standalone playgrounds

Use these pages to experiment with MineRender content, renderer options, and asset sources. The website has its own simpler examples. The Vue and script-tag workspaces remain compact integration examples.

Run from the repository root:

```sh
yarn dev:web
```

The preview listens on all network interfaces (`0.0.0.0`) on port `3000`. Open <http://127.0.0.1:3000/> on this computer, or use its LAN address from another device on the same network. The terminal lists the available addresses.

To choose a port, run:

```sh
yarn dev:web --port 4000
```

Use `--host 127.0.0.1` for a preview accessible only on this computer, or `--host` with a specific LAN address. `HOST` and `PORT` environment variables are also supported; command-line flags take precedence. After building the library, use `yarn workspace @minerender/web dev --port 4000` to restart the preview without rebuilding it.

To verify changes, run `yarn workspace @minerender/web typecheck` and `yarn workspace @minerender/web build`. Root `yarn typecheck` includes this workspace.

## Shared controls

Each playground has a collapsible sidebar. Content controls vary by page. The remaining sections provide presets, renderer and camera settings, asset sources, exports, configuration sharing, and an inspector.

1. Choose content or a preset. A failed load keeps the last successful preview and configuration.
2. Open **Renderer and camera** to change projection, field of view, clipping planes, pixel ratio, frame limit, antialiasing, composer, and debug helpers. Select **Apply renderer settings** to rebuild the renderer. Use **Fit content**, **Reset camera**, or the position and target fields to frame it.
3. Open **Assets** to choose a Minecraft version, hosted root, or resource-pack ZIP. Source priority is ZIP, hosted root, then vanilla. Changing sources reloads the content and its suggestions.
4. Open **Export** to download PNG/JPEG or a static OBJ/PLY/glTF/GLB snapshot. Pixel ratio controls image resolution. Multipart content and worlds should use **Whole scene**. OBJ/PLY omit texture images; glTF does not bake custom shader lighting.
5. Open **Save and restore** to copy a link, configuration, or code, download/import JSON, or reset the page. Links store versioned configuration in the URL fragment, including imported model JSON. Local binary assets and inspector-only changes are excluded; reselect named files after reopening.

**Pause rendering** pauses the renderer. The entity page has separate animation playback controls for pausing or scrubbing a clip while keeping camera interaction active.

## Pages

| Page | Content controls |
|---|---|
| `demo/block/` | Namespaced IDs, blockstate properties, tints, merge/instance/wireframe options, multipart and block-entity presets |
| `demo/item/` | Item definition or raw model source, display pose, tints, merge/instance/wireframe options |
| `demo/skin/` | Player or texture lookup, local PNGs, model/layout overrides, capes, poses, part and overlay visibility |
| `demo/entity/` | Automatic passes or manual layers, state labels, per-draw textures/tints, coordinate mode, keyframes, visibility |
| `demo/gui/` | Inventory slots, concrete recipe ingredients, texture/item layer editing and ordering, JSON import/export, pixel zoom |
| `demo/structure/` | Built-in structures, local NBT/schematic/MCA files, chunk selection, atlas size, section meshing, coordinate edits |
| `test/custom_model/` | Validated Java model JSON, file import, parent-model import, model options |
| `test/exports/` | A rotating instance and tinted model for comparing export formats |
| `test/stonecube/`, `test/blocksphere/`, `test/v2test/` | Seeded workloads, dimensions/radius/spacing, block palette, fluid and neighbor-culling presets |

World instancing follows the library's model pipeline; section meshing is independently configurable. Structure suggestions merge hosted directory indexes and uploaded ZIP paths. Sources without indexes still accept explicitly entered IDs.

Entity manual layers replace the dataset's automatic passes. Texture overrides use asset IDs; hosted roots and resource packs provide their images. Animation availability depends on the selected model and game version. GUI recipes use concrete ingredient choices and do not draw stack counts. GUI text, sprite scaling, texture interpolation, and special item renderers require separate library work.

## Implementation

`src/playground/Playground.ts` owns the sidebar, staged renderers, asset-source changes, configuration, and exports. A page supplies serializable defaults, optional presets and code generation, and an asynchronous `load` callback. It registers owned cleanup before initialization and returns content bounds plus activation and rollback callbacks where needed.

Loads run in order because asset sources and caches are global. Superseded loads release their staging resources. A successful load swaps previews; a failed load restores the successful configuration and its upload handles. Renderer rebuilds preserve the camera, except when switching projection or selecting a preset. Live edits use `record` to update saved content without rebuilding.

Keep page behavior in `apps/web`. Public library changes and website changes belong in separate work.
