# MineRender V2 roadmap

Track V1 feature parity and the remaining V2 work here. Commands and architecture are in [AGENTS.md](./AGENTS.md).

Library paths below are relative to `packages/minerender/`.

## Monorepo imports

| Source | Destination | Revision |
|---|---|---|
| InventivetalentDev/MineRenderWeb | `apps/web/` | `01ff6efdb2d83549b4ac93f05ae9acc68ac96fee` |
| MineRender/example-vite | `examples/vite/` | `1c2fc275d8b3dc9f6c8beb0bcf7d5538975b577d` |
| MineRender/example-bundle | `examples/script-tag/` | `411044c1edf241bff8b919296a72183e53fcf709` |

V1 `master`, tags, bundles, and website URLs must remain available. V2 targets `main`.

## Feature-parity matrix (V1 → V2)

Details and remaining work for each row are in the [continuation plan](#continuation-plan-ordered).

| Feature | V1 | V2 | Status | Priority |
|---|---|---|---|---|
| Build & dev environment | webpack 4 per-feature IIFE bundles | Yarn 4 and tsup | complete | — |
| Packaging / npm hygiene | script-tag CDN | Browser/Node conditional exports, declarations, files whitelist | complete | — |
| Clean import (no side effects) | window globals, telemetry beacon | Lazy platform setup and Ticker; idle Node processes exit | complete | — |
| Browser/Node dual-target | browser-only | Per-platform entries; Node canvas optional for browsers | complete | — |
| Renderer core | continuous loop, SSAA, fps limit, dispose() | Dirty-flag loop, frame limit, disposal, sRGB output | complete | — |
| Camera controls | OrbitControls via `options.controls` | Opt-in OrbitControls or `FlyControls` (`controls.mode`) | complete | — |
| Skins — classic 64×64 | named toggleable parts | Vanilla dimensions, UVs, pivots, overlays, named parts | complete | — |
| Skins — slim + legacy 64×32 | auto-detected | Slim/legacy UVs and detection; legacy skins normalized | complete | — |
| Capes (vanilla/OptiFine/LabyMod) | 3 layouts, capes.dev | All three static layouts and capes.dev lookup | partial | medium |
| Block/item model rendering | tints, display transforms | Tints, display poses, composite and special items, glint | partial | high |
| Blockstate resolution | variants, weighted, multipart | Variants, weighted alternatives, multipart AND/OR | complete | — |
| Animated textures | frametime | Frame grids, sequences, durations, interpolation | complete | — |
| Entity rendering | 76 hosted models, mirror | Versioned dataset, passes, render modes, transforms | partial | high |
| Entity keyframe animations | none | Native and sampled clips, layer playback, weights | partial | high |
| GUI / inventory / recipes | GuiRender, Positions, recipe() | Layers, containers, recipes, bitmap/Unihex text, layouts | partial | medium |
| Structure (.nbt) loading | via ModelConverter | Bounded placement, block entities, opt-in saved mobs | partial | high |
| Legacy .schematic | incl. AddBlocks nibbles | IDs, metadata, AddBlocks, custom mappings, lenient mode | complete | — |
| Combined multi-renderer scene | CombinedRender wrapper | Superseded: one scene hosts all types | complete | — |
| Screenshots, video & 3D export | toImage, toObj/toGLTF/toPLY | Trimmed captures, browser video, OBJ/PLY, textured glTF | complete | — |
| Asset loading & resource packs | swappable assetRoot | Ordered sources, ZIP overlays, version selection | partial | high |
| Per-frame animation API | `<type>Render` CustomEvents | `onFrame` with time/delta, FPS limit, pause | complete | — |
| Scene documents & editor | n/a | Versioned scene JSON and a browser editor | complete | — |
| Embeds & website | minerender.org, iframe embeds | V2 site, playgrounds, editor, API reference, embeds | complete | — |
| **Large-scale worlds (V2 goal)** | n/a | Paletted chunks, section meshes, streaming, light, AO | partial | high |
| **Anvil .mca / world formats (V2 goal)** | n/a | Anvil regions, Sponge, Litematica, entity regions; ID renames only | partial | high |
| **Node headless rendering (V2 goal)** | MineRenderServer | `NodeRenderer`, PNG buffers, scene-document HTTP API | complete | — |
| Bedrock geometry (V2 ambition) | n/a | Type declarations only | not started | low |
| Instancing architecture | merged Geometry, instancing fork | Reusable slots, growing buffers, per-placement refs | partial | high |

## Continuation plan (ordered)

### 1–4. Build and platform support

Done:

- Build tooling, package exports, import-time initialization, and browser/Node providers.
- Update cache and queue dependencies so idle imports let Node exit.
- Build the browser ESM output per module, and load optional object types, exporters, and storage on first use.

### 5. Renderer core

Done:

- Fix start/stop, disposal, resize invalidation, and scene listeners.
- Integrate opt-in OrbitControls.
- Implement frame limiting.
- Align Three types and color spaces; fix direct/composer brightness.
- Compile the shaded model material for both instanced and non-instanced meshes.

### 6. Asset pipeline

Done:

- Resolve sources in priority order and return the first defined asset.
- Initialize node-persist before use.
- Decode fetched image bytes without refetching them; reject invalid images and allow retry.
- Skip nullish persistent writes and evict missing or rejected async cache loads.
- Bound request concurrency, retries, cancellation, timeouts, and shutdown.
- Propagate hosted/archive and model initialization errors with source context.
- Default to 1.21.11 with static item definitions, animal texture paths, structure directory aliases, and versioned cache keys.
- Add an asset-version selection API.
- Load versioned registry and rendering data from `minerender-data`, replacing bundled runtime datasets.
  The nearest published release is used when the exact registry version is unavailable.
- Replace renamed block, item, and saved-entity IDs through the optional versioned `renames` dataset.
- Read ZIP pack metadata, select version-applicable overlays, and filter lower-priority resources.
- Fix `WrappedImage` frame math.

Done (item rendering):

- Chest, bed, mob-head, and shulker-box items, including shulker textures, openness, and six orientations.
- Banner and shield items with supplied base colors and ordered banner patterns.
- Held and throwing trident poses, static conduits, and decorated pots with four supplied sherd sides.
- Player-head items from supplied profiles: skin lookup, texture properties, resource-pack texture overrides, and default skins.
- Copper-golem statue variants and poses from supplied block-state components.
- Nested composite items with each child's textures, display pose, lighting, and tints.
- Item properties from supplied data components, stack counts, display contexts, and overrides.
  Shared playground controls include bundle, bow, crossbow, and indexed custom-model-data presets.
- Static and default item tint sources.
- Supplied dye, map, firework, potion custom-color, and indexed custom-model-data tints, including GUI item contexts.
- Potion and tipped-arrow colors from supplied potion IDs and visible custom effects, with a playground potion selector.
- Animated enchantment glint on ordinary and composite items, shields, and held or throwing tridents, with explicit overrides.
- Vanilla glint defaults by item ID, retaining explicit overrides and resource-pack model replacements.
- Projected glint on compasses, recovery compasses, and clocks; normal-compass glint from supplied lodestone tracking.
- Vanilla durability and stack-size defaults in model selectors and GUI bars, with editable playground overrides.

Composite items and items with glint do not use instancing.

Remaining:

- Glint on other special renderers.
- Other special renderers.
- Team colors (only declared defaults are used).
- Other item registry defaults.
- Automatic calculation of world and player state.
- ZIP resource packs outside the browser (archive sources are browser-only).

### 7. Model/blockstate correctness — complete

Done (small, high-impact fixes):

- `Axis.X = "X"` → lowercase (x-rotations silently no-op).
- Await `BlockStates.getDefaultState`.
- Fix the texPosition-undefined crash.
- `ModelMerger`: child `elements` override the parent's instead of concatenating.
- Remove the 150ms rotation workaround and preserve multipart rotations during placement.
- Multipart AND/OR, `apply` arrays, and weighted variants.
- `AssetKey.parse` extension fallback and the broken `isAssetKey`.

Done (follow-ups):

- `tintindex` with explicit colors.
- Automatic block preview colors.
- `uvlock`.
- Display transforms.
- Honor element `shade: false` in block models and world sections; item previews keep directional shading.

### 8. Skins and capes — medium

Done:

- Correct slim arm/sleeve UVs; preserve named parts, poses, visibility, and shared resources when switching classic/slim.
- Add the 64×32 legacy layout and slim/legacy auto-detection.
- Match vanilla base opacity, overlay blending, dimensions, UVs, and joint pivots.
- Add vanilla cape meshes wired to the existing `Skins.ts` resolvers.
- Add OptiFine/LabyMod layouts and capes.dev lookup.
- Add opt-in deadmau5 ears and Dinnerbone/Grumm upside-down players.

Remaining:

- Animated capes.
- Consider sharing geometry construction with `EntityObject`.

### 9. Entity rendering completion — high

Done:

- Recurse `ModelPart.children`.
- Implement `mirror`.
- Verify the face UVs and pivot translation.
- Compose selected entity layers with separate textures and named groups (e.g. sheep body and wool).
- Support dataset render passes, emissive and scrolling materials, tint overrides, and renderer-specific root transforms.
- Render supported block entities during block placement.
- Play native and sampled procedural clips with synchronized, layer-specific playback.
- Blend clips within a layer with explicit weights, and update weights without restarting playback.
- Store clip blends in scene documents and edit them in the scene editor.
- Publish the `1.21.11` entity dataset with the procedural clips from
  [minecraft-entity-models #7](https://github.com/InventivetalentDev/minecraft-entity-models/pull/7).
- Load entity geometry, lists, animations, and the block-entity index from the nearest published dataset version.
  Textures keep the requested version.

Default textures and root transforms come from the versioned entity dataset. Callers can override textures and select conditional passes.
`flip: false` explicitly keeps raw model space rather than applying the dataset transform.

Remaining:

- Runtime gameplay state selection, visibility changes, and animated renderer transforms.
- Upside-down mobs named Dinnerbone or Grumm. Vanilla raises them by their bounding-box height, which no published dataset provides yet.

### 10. Instance lifecycle overhaul — high (prerequisite for worlds)

Done:

- Limit `InstancedMesh.count` to allocated slots.
- Add a free-list so removal reclaims slots.
- Grow capacity on demand instead of silent out-of-bounds writes.
- Provide per-placement transforms through `InstanceReference`s.
- Replace the `children[0]`-is-the-InstancedMesh assumption with a stored reference.

Remaining:

- Shared-owner transforms still affect all live instances; changing that API is separate work.
- Extend deduplication beyond `assetType === "models"` to blockstate level.

### 11. World subsystem redesign for scale — high (the V2 differentiator)

Done (immediate fixes):

- Fix `getChunkAt` to use `Map.get(key)`.
- Remove the 4×4×4 bound and negative-coordinate rejection.
- Remove hardcoded debug wireframes.
- Fix `BatchedExecutor`'s missing setInterval delay and add `stop()`.
- Place structures and chunks in bounded batches with one final neighbor-culling pass.

Done (redesign):

- Palette and typed-array section storage.
- Opt-in merged meshes and bounded atlas pages per chunk section, for models of any shape and for fluid surfaces.
  This covers cutout, translucent, multipart, and animated models; block entities keep per-block objects.
- Neighbor face culling via model `cullface` against opaque full cubes.
  Vanilla's same-block and connected-block rules from the `blockCulling` dataset also hide shared faces.
- Explicit chunk load/unload.
- `await world.unloadChunkColumns(positions)` removes columns together and refreshes surviving neighbors once.
  The streamer requires this method, which `MineRenderWorld` provides, for eviction and disposal.
- Per-block visibility without deleting block data.
- Camera-driven streaming.
- Opt-in baked per-vertex ambient occlusion on axis-aligned boundary faces, with runtime toggling.
  It honors model opt-outs and refreshes edited or streamed neighbors.
- Seed weighted blockstate alternatives by world position, so unloading and reloading a chunk preserves its appearance.
  Individual blocks and section meshes share vanilla-identical selection from absolute block coordinates.
  Standalone previews remain random unless given `variantPosition`.
- Pick individual world blocks through `world.raycast`, including merged terrain.
  The world demo inspects their coordinates, properties, and saved biome.
- Pick rendered mobs through `world.raycastEntities`; the world demo inspects their type and saved position.
- Resolve each block state once per placement group and yield to the event loop instead of a timer-driven batch queue.
- Build section geometry in a browser worker.
- Group ready streamed columns with a four-column read window and refresh shared borders once per placement group.
- Sort transparent model and fluid quads back to front within each atlas page.

Done (biomes and light):

- Preserve modern Anvil biome palettes during import and placement, including air-only sections, with world-coordinate lookup.
- Apply biome colors to grass, foliage, dry foliage, and water in both rendering modes.
  This includes merged fluid sections, resource-pack colormaps, and dark forest/swamp grass modifiers.
- Opt-in biome color blending in section meshes, with a runtime radius, cached color averaging, and border refreshes after biome edits or streaming.
- Import saved sky/block light and apply opt-in flat lighting to blocks and fluids in section meshes.

Done (fluids):

- Render sloped water/lava surfaces with still/flow textures and waterlogged blocks.
- Cover intrinsic water in kelp, seagrass, and bubble columns.

Remaining:

- Exact partial-shape ambient occlusion.
- Light propagation. The published `blockLighting` dataset is not read yet.
- Intersecting surfaces and quad ordering across pages or sections remain approximate.
- Per-position flower offsets. The published `blockAppearance` offsets are not read yet.
- Draw glass and panes on the translucent page, as vanilla's render layers do (`blockAppearance` render layers);
  they currently use the solid/cutout page.
- Chunk-level visibility management and LOD. Section meshes already have bounds for Three.js frustum culling.
- Older numeric biome arrays (the published `legacyBiomes` dataset is not read yet) and world-seed-based biome sampling.
- Region decoding still runs on the main thread. Wasm or worker-side chunk parsing remains a scale option once placement stops dominating.
- Measure real-world decoding, placement, frame stalls, and retained memory before choosing further worker or LOD work.
  Use the [world-streaming benchmark](./apps/web/benchmarks/README.md): it records fixed local-save routes with cold and warm asset passes,
  operation timings, frame-callback gaps, and JavaScript heap samples.
- Fluid parity: read the published `fluidStates` dataset (fluid definitions, face-occlusion shapes, solidity and flow-blocking flags)
  and add water overlays against glass/leaves.

Keep 1 block = 16 units.

### 12. Node headless rendering entry point — high

Done:

- Make `Renderer` constructible without DOM through an injected canvas and WebGL 2 context.
- Add `renderOnce()` and Node-only `NodeRenderer.renderToBuffer()` for fresh frames and PNG buffers without the animation loop.
- Add a V2 HTTP rendering service.

`NodeRenderer.create({ width, height, ...options })` owns a native context from optional `gl@9.0.0-rc.10` (experimental WebGL 2).
The Node entry uses `canvas` 3 for texture preparation. Injected contexts remain caller-owned.
See [platform setup and usage](./packages/minerender/reference/platforms.md).

[`apps/api`](./apps/api/README.md) accepts versioned scene documents at `POST /v1/renders` and serves render metadata and PNG images:

- Rendering uses a pool of isolated processes with reusable asset caches, bounded concurrency, deadlines, and an expiring PNG cache.
- V2 deliberately replaces the V1 `GET /render/skin/:texture`, `GET /render/model/:type/:model`, and `minerender-options` contract.
- Returned PNG URLs can be embedded while cached; GET requests do not create renders.

Remaining:

- Hosting and persistent render storage.

### 13. Anvil region (.mca) + schematic loaders — high

Done:

- Add a world-format layer feeding chunk storage: `.mca` sector tables, section palettes, and DataVersion.
  Preserve NBT type/compression metadata, implement legacy `.schematic` ID/metadata and AddBlocks conversion,
  and retain structure entities and DataVersion.
- Support custom legacy schematic mappings and opt-in lenient parsing.
- Decode Anvil LZ4 block streams with checksum validation.
- Read external `.mcc` payloads through caller-supplied readers and local world-folder imports.
- Decode pre-1.13 numeric Anvil chunks with shared schematic mappings, custom overrides, and opt-in lenient parsing.
- Load Sponge v2/v3 `.schem` files with local palettes, block states, offsets, block/entity NBT, and DataVersion;
  add playground and editor imports.
- Load Litematica v5–7 `.litematic` files with named regions, signed dimensions, relative placement, and preserved block/entity NBT;
  add playground and editor imports.
- Add opt-in rendering of supported saved mobs at their positions and yaw, with cleanup on column replacement, unloading, and world clearing.
- Load modern worlds' separate `entities/*.mca` files alongside terrain with shared cache limits and cancellation,
  including entity-only columns and world-folder imports.
- Read structure palettes saved with either `Name`/`Properties` or the Minecraft 26.x `id`/`properties` fields.

Remaining:

- Sponge biome and metadata import.
- DataVersion-based block-state and NBT migration. Renamed IDs are already replaced (section 6).

### 14. GUI renderer parity — medium

Done:

- Implement `GuiObject`: layered textured planes with UV crop, pixel positioning, and ordered layers.
- Wire `scene.addGui(...)`, `inventorySlot`, and a chest demo with camera fitting.
- Add item models in the GUI display pose.
- Draw stack counts and supplied-component durability bars, preserve recipe output counts, and add an inventory-slot playground preview.
- Add shaped/shapeless recipe layouts and update crafting for the newer recipe format.
- Add modern GUI sprite scaling (stretch, tile, nine-slice).
- Render styled bitmap text and tooltips from supplied lines.
- Update V1's boss bar and book layouts for the newer texture paths, expose chest/crafting presets, and add playground controls.
- Load vanilla and resource-pack Unihex providers with size overrides, shared atlas pages, and matching text metrics.

Remaining:

- TrueType providers.
- Translated text.
- Right-to-left shaping.

### 15. Polish: exports, animation API, inspector, demos, docs — medium

Done:

- Port toObj/toGLTF and toImage trim/mime.
- Add a per-frame callback integrated with the dirty flag (replaces V1's CustomEvent contract).
- Fix `SceneInspector` raycast normalization and select individual instances.
- Fix `SceneStatsDisplay`'s leaked interval.
- Fix animated-texture timing, frame grids/sequences, and stationary-camera redraw for all scenes sharing an atlas, respecting `fpsLimit`.
  Stop unused atlas tickers.
- Add texture interpolation.
- Build the V2 website with live examples.
- Rework the demos into configurable playgrounds.
- Add portable scene documents and a browser scene editor.
- Add TypeDoc/VitePress reference tooling and library API JSDoc.
- Host the playgrounds and editor on Cloudflare.
- Add browser video export with recording controls.
- Add scene-driven iframe embeds with shorthand URLs, portable scene links, and editor copy support.
- Remove unused V1 website files from the V2 tree while preserving V1 delivery URLs.
- Deploy the embed Worker at `beta.minerender.org/embed/`.
- Route library logging through leveled per-component loggers; only warnings and errors print by default.

Remaining:

- Extend existing regression coverage as remaining model and blockstate features land.
- Keep the consumer API contract in AGENTS.md as the beta compatibility baseline.
