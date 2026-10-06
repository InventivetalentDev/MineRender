# MineRender V2 roadmap

Track V1 feature parity and the remaining V2 work here. Commands and architecture are in [AGENTS.md](./AGENTS.md).

Library paths below are relative to `packages/minerender/`; `res/` remains at the repository root.

## Monorepo imports

| Source | Destination | Revision |
|---|---|---|
| InventivetalentDev/MineRenderWeb | `apps/web/` | `01ff6efdb2d83549b4ac93f05ae9acc68ac96fee` |
| MineRender/example-vite | `examples/vite/` | `1c2fc275d8b3dc9f6c8beb0bcf7d5538975b577d` |
| MineRender/example-bundle | `examples/script-tag/` | `411044c1edf241bff8b919296a72183e53fcf709` |

V1 `master`, tags, bundles, and website URLs must remain available. V2 targets `main`;
legacy website cleanup is a separate task.

## Feature-parity matrix (V1 → V2)

| Feature | V1 | V2 today | Priority |
|---|---|---|---|
| Build & dev environment | webpack 4 per-feature IIFE bundles, works | Yarn 4 and tsup | complete |
| Packaging / npm hygiene | script-tag CDN | Browser/Node conditional exports, declarations, and a package files whitelist | complete |
| Clean import (no side effects) | window globals, telemetry beacon | Lazy platform initialization and Ticker; idle caches and queues let Node exit | complete |
| Browser/Node dual-target | browser-only by design | Separate entries register platform providers; Node canvas stays optional for browsers | complete |
| Renderer core | continuous loop, SSAA, fps limit, dispose() | Dirty-flag loop, start/stop, disposal, and resize invalidation; frame limiting; sRGB color handling | complete |
| Camera controls | built-in OrbitControls via `options.controls` | Opt-in renderer-owned OrbitControls, including redraw and disposal | complete |
| Skins — classic 64×64 | full, named toggleable parts | Vanilla dimensions, UVs, pivots, base opacity, and translucent overlays; model detection and named parts | complete |
| Skins — slim + legacy 64×32 | auto-detected, dedicated UVs | Classic/slim UVs and detection; legacy skins normalized with mirrored limbs and transparency rules | complete |
| Capes (vanilla/OptiFine/LabyMod) | full, 3 layouts, capes.dev | All three static layouts and capes.dev lookup; animated capes remain | medium |
| Block/item model rendering | full incl. tint, display transforms | UV locking, explicit per-index tints, automatic block preview colors, display poses, and chest/bed/mob-head item previews | high |
| Blockstate resolution | variants + weighted random + multipart AND/OR | Default states and model initialization awaited; multipart AND/OR and weighted alternatives supported; placement preserves rotations | high |
| Animated textures | frametime honored | Frame grids, sequences, durations, and stationary-camera redraw; interpolation remains | medium |
| Entity rendering | 76 hosted models, mirror, inheritance | Versioned dataset, nested parts, mirrored UVs, and selected layers with separate textures; renderer-specific effects remain | high |
| GUI / inventory / recipes | full GuiRender + Positions + recipe() | Cropped texture and item-model layers, pixel positioning, slot helper, and shaped/shapeless recipe layouts; sprite scaling remains | medium |
| Structure (.nbt) loading | works via ModelConverter | Bounded placement, signed coordinates, slot cleanup, DataVersion and entity NBT preservation; entities are not rendered | high |
| Legacy .schematic | full incl. AddBlocks nibbles | Numeric block IDs, metadata, AddBlocks and block/entity NBT parsed; unknown ID states reject | medium |
| Combined multi-renderer scene | CombinedRender wrapper | Superseded by design (one scene hosts all types) — **at parity** | — |
| Screenshots & 3D export | toImage(trim,mime), toObj/toGLTF/toPLY | Fresh captures with trim/MIME/quality; static OBJ/PLY and textured browser glTF/GLB snapshots | complete |
| Asset loading & resource packs | swappable assetRoot, fallback | Ordered whole-asset source selection; decode fetched bytes; failure-evicting caches; contextual errors; defaults to 1.21.11, ZIPs browser-only | high |
| Per-frame animation API | `<type>Render` CustomEvents | `onFrame` subscriptions with time/delta, FPS limiting, pause/resume, and disposal | complete |
| Entity keyframe animations | none | Vanilla animation definitions from the dataset, sampled like vanilla and played on `EntityObject` with caller-driven time; procedural `setupAnim` motion and blending remain | partial |
| Embeds & website | minerender.org + iframe embeds | Workspace demos and examples; V2 website and embeds remain | low |
| **Large-scale worlds (V2 goal)** | n/a | Paletted signed chunks, opt-in static opaque section meshes, and opaque-neighbor face culling; no lighting/LOD | high |
| **Anvil .mca / world formats (V2 goal)** | n/a | Java 1.13+ paletted regions, selected chunk loading and DataVersion; no LZ4, external chunks, or data fixing | high |
| **Node headless rendering (V2 goal)** | faked externally by MineRenderServer | No DOM-free Renderer construction, no render-to-buffer API | high |
| Bedrock geometry (V2 ambition) | n/a | Type declarations only | low |
| Instancing architecture | merged Geometry + instanced-mesh fork | Reusable slots, growing buffers, and explicit mesh ownership; whole-object transforms still affect all live instances | high |

## Continuation plan (ordered)

### 1–4. Build and platform support

- ~~Build tooling, package exports, import-time initialization, and browser/Node providers.~~
- ~~Update cache and queue dependencies so idle imports let Node exit.~~

### 5. Renderer core

- ~~Fix start/stop, disposal, resize invalidation, and scene listeners.~~
- ~~Integrate opt-in OrbitControls.~~
- ~~Implement frame limiting.~~
- ~~Align Three types and color spaces; fix direct/composer brightness.~~
- ~~Compile the shaded model material for both instanced and non-instanced meshes.~~

### 6. Asset pipeline

- ~~Resolve sources in priority order and return the first defined asset.~~
- ~~Initialize node-persist before use.~~
- ~~Decode fetched image bytes without refetching them; reject invalid images and allow retry.~~
- ~~Skip nullish persistent writes and evict missing or rejected async cache loads.~~
- ~~Bound request concurrency, retries, cancellation, timeouts, and shutdown.~~
- ~~Propagate hosted/archive and model initialization errors with source context.~~
- ~~Default to 1.21.11 with static item definitions, animal texture paths, structure directory aliases, and versioned cache keys.~~
- ~~Add an asset-version selection API.~~
- ~~Support chest, bed, and mob-head special item models.~~ Other special renderers, composite models, tint sources, and gameplay-dependent item selection remain.
- ~~Fix `WrappedImage` frame math.~~

### 7. Model/blockstate correctness — high
Small, high-impact: (1) ~~`Axis.X = "X"` → lowercase (x-rotations silently no-op)~~; (2) ~~await `BlockStates.getDefaultState`~~; (3) ~~texPosition-undefined crash~~; (4) ~~ModelMerger: child `elements` must override, not concat~~; (5) ~~remove the 150ms rotation workaround and preserve multipart rotations during placement~~; (6) ~~multipart AND/OR + `apply` arrays + weighted variants~~; (7) ~~`AssetKey.parse` extension fallback + broken `isAssetKey`~~. Then ~~tintindex with explicit colors~~, ~~automatic block preview colors~~, ~~uvlock~~, ~~display transforms~~.

### 8. Finish skins: slim, cape, legacy — high
~~Correct slim arm/sleeve UVs and preserve named parts, poses, visibility, and shared resources when switching classic/slim.~~ ~~Add 64×32 legacy layout and slim/legacy auto-detection.~~ ~~Match vanilla base opacity, overlay blending, dimensions, UVs, and joint pivots.~~ Consider sharing geometry construction with `EntityObject`; the unused `src/skin/playerModels.json` needs conversion from the legacy schema before reuse. ~~Add vanilla cape meshes wired to the existing `Skins.ts` resolvers.~~ ~~Add OptiFine/LabyMod layouts and capes.dev lookup.~~ Animated capes remain.

### 9. Entity rendering completion — high
~~Recurse `ModelPart.children` (most multi-part entities currently render incomplete).~~ ~~Implement `mirror`.~~ ~~Verify the five TODO face-UV methods in `MinecraftCubeTexture.ts` and the possibly-doubled pivot translation.~~ ~~Compose selected entity layers with separate textures and named groups (e.g. sheep body and wool).~~ Emissive, scrolling, and gameplay-dependent layer effects remain. Variant textures (bed colors, chest types, horse coats) are selected by the caller through the texture key. In `res/tools`, remap intermediary names (`field_20813`) in blockEntityModels and ~~regenerate the hosted JSON~~. Root transforms are renderer-specific in vanilla; block entities need `flip: false` and some use other axes (signs/banners scale `(0.667, -0.667, -0.667)`).

### 10. Instance lifecycle overhaul — high (prerequisite for worlds)
~~Limit `InstancedMesh.count` to allocated slots~~; ~~add a free-list so removal reclaims slots~~; ~~grow capacity on demand instead of silent out-of-bounds writes~~; route whole-object transforms through per-index `InstanceReference`s (owner transforms affect all live instances); ~~replace the `children[0]`-is-the-InstancedMesh assumption with a stored reference~~; extend dedup beyond `assetType === "models"` to blockstate level.

### 11. World subsystem redesign for scale — high (the V2 differentiator)
Immediate fixes: ~~fix `getChunkAt` to use `Map.get(key)`~~; ~~remove the 4×4×4 bound and negative-coordinate rejection~~; ~~remove hardcoded debug wireframes~~; ~~fix `BatchedExecutor`'s missing setInterval delay + add `stop()`~~; ~~place structures and chunks in bounded batches with one final neighbor-culling pass~~. Then the real redesign: ~~palette + typed-array section storage~~, ~~opt-in merged meshes and bounded atlas pages per chunk section for static opaque cubes~~ (complex, transparent, animated, and multipart models retain per-block objects), ~~neighbor face culling via model `cullface` against opaque full cubes~~ (partial-shape and matching transparent-block rules remain), chunk load/unload + frustum culling, baked per-vertex AO (SSAO was abandoned at ~2fps), biome tint. For fluid parity, obtain vanilla block-state fluid definitions, face-occlusion shapes, and solidity/flow-blocking flags; ~~cover intrinsic water in kelp, seagrass, and bubble columns~~; add water overlays against glass/leaves. Keep 1 block = 16 units.

### 12. Node headless rendering entry point — high
Make `Renderer` constructible without DOM: injectable canvas + GL context (headless-gl or OffscreenCanvas), `renderOnce()`/`renderToBuffer()` bypassing the animation loop, `toImage()` returning a Buffer in Node (V1's `trimCanvas` is portable). `InventivetalentDev/MineRenderServer` is the reference contract — it faked all of this against V1 and reached into `_scene`/`_camera`; V2 already exposes them publicly. Then a thin V2 server can revive `GET /render/skin/:texture` and `GET /render/model/:type/:model`.

### 13. Anvil region (.mca) + schematic loaders — high
~~Add a world-format layer feeding chunk storage: `.mca` sector tables, section palettes and DataVersion; preserve NBT type/compression metadata; implement legacy `.schematic` ID/metadata and AddBlocks conversion; retain structure entities and DataVersion.~~ Pre-1.13 numeric Anvil chunks, LZ4 and external `.mcc` payloads, Sponge `.schem`, Litematica, entity rendering, and DataVersion-based migration remain.

### 14. GUI renderer parity — medium
~~Implement `GuiObject`: layered textured planes with UV crop, pixel positioning, and ordered layers.~~ ~~Wire `scene.addGui(...)`, `inventorySlot`, and a chest demo with camera fitting.~~ ~~Add item models in the GUI display pose.~~ ~~Add shaped/shapeless recipe layouts and update crafting for the newer recipe format.~~ Add modern GUI sprite scaling (stretch, tile, nine-slice). Update V1's boss bar and book layouts for the newer texture paths.

### 15. Polish: exports, animation API, inspector, demos, docs — medium
~~Port toObj/toGLTF and toImage trim/mime.~~ ~~Add a per-frame callback integrated with the dirty flag (replaces V1's CustomEvent contract).~~ ~~Fix `SceneInspector` raycast normalization (against canvas rect, not window)~~. ~~Fix `SceneStatsDisplay`'s leaked interval.~~ ~~Fix animated-texture timing, frame grids/sequences, and stationary-camera redraw for all scenes sharing an atlas, respecting `fpsLimit`; stop unused atlas tickers.~~ Texture interpolation remains. Finish the demos and V2 website, including embeds. Remove unused V1 website files from the V2 tree while preserving V1 delivery URLs. Add regression coverage for remaining model and blockstate work; keep the consumer API contract in AGENTS.md as the beta compatibility baseline.
