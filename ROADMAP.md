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
| Block/item model rendering | full incl. tint, display transforms | UV locking, explicit per-index tints, automatic block preview colors, display poses, nested composite items, chest/bed/mob-head/player-head/shulker-box previews, patterned banners/shields, trident/conduit previews, decorated pots, copper-golem statue poses, and component-driven glint on ordinary/composite items, shields, and tridents, including vanilla item glint defaults, compass/clock projected glint, potion effect-derived colors, and vanilla durability/stack-size defaults | high |
| Blockstate resolution | variants + weighted random + multipart AND/OR | Default states and model initialization awaited; multipart AND/OR and weighted alternatives supported; placement preserves rotations | complete |
| Animated textures | frametime honored | Frame grids, sequences, durations, RGBA interpolation, and stationary-camera redraw | complete |
| Entity rendering | 76 hosted models, mirror, inheritance | Versioned dataset, nested parts, mirrored UVs, conditional passes, render-mode materials, scrolling effects, and dataset transforms; runtime gameplay state selection remains | high |
| GUI / inventory / recipes | full GuiRender + Positions + recipe() | Texture/item layers with count labels and durability bars, container presets, recipes, sprite scaling, styled bitmap text, supplied-text tooltips, boss bars, and book layouts; extended fonts and translations remain | medium |
| Structure (.nbt) loading | works via ModelConverter | Bounded placement, signed coordinates, slot cleanup, DataVersion and entity NBT preservation; supported block entities render, with opt-in saved mobs and selected appearance fields | high |
| Legacy .schematic | full incl. AddBlocks nibbles | Numeric block IDs, metadata, AddBlocks, custom mappings, and block/entity NBT parsed; strict by default, with opt-in lenient fallback | complete |
| Combined multi-renderer scene | CombinedRender wrapper | Superseded by design (one scene hosts all types) — **at parity** | — |
| Screenshots, video & 3D export | toImage(trim,mime), toObj/toGLTF/toPLY | Fresh captures with trim/MIME/quality, real-time browser video recording, static OBJ/PLY, and textured browser glTF/GLB snapshots | complete |
| Asset loading & resource packs | swappable assetRoot, fallback | Ordered source selection, ZIP pack overlays and filters, failure-evicting caches, and contextual errors; defaults to 1.21.11, ZIPs browser-only | high |
| Per-frame animation API | `<type>Render` CustomEvents | `onFrame` subscriptions with time/delta, FPS limiting, pause/resume, and disposal | complete |
| Entity keyframe animations | none | Native and sampled procedural clips with synchronized, layer-specific playback and caller-driven time; runtime state selection, blending, visibility, and animated renderer transforms remain | partial |
| Scene documents & editor | n/a | Versioned scene JSON with item state, atomic document loading, and a browser editor with transforms, GUI layouts, import, and image, video, and model export | complete |
| Embeds & website | minerender.org + iframe embeds | V2 website, hosted playgrounds and scene editor, consumer examples, and API reference; iframe embeds remain | low |
| **Large-scale worlds (V2 goal)** | n/a | Paletted signed chunks, opt-in section meshes for static models of any shape built in a browser worker, grouped bulk placement, neighbor face culling, block visibility, and camera-driven chunk streaming with bounded retention; lighting, biome tint, and LOD remain | high |
| **Anvil .mca / world formats (V2 goal)** | n/a | Numeric and paletted Java regions, Sponge v2/v3 schematics with local palettes, offsets, and preserved NBT, Litematica v5–7 named regions with relative placement, lazy multi-region world sources, separate entity regions, DataVersion, gzip/zlib/LZ4/uncompressed payloads, external `.mcc` payloads, and a local world-folder demo with dimension selection; no data fixing | high |
| **Node headless rendering (V2 goal)** | faked externally by MineRenderServer | DOM-free renderer with injected WebGL 2, native `NodeRenderer.create()`, PNG buffers, and a scene-document HTTP API | complete |
| Bedrock geometry (V2 ambition) | n/a | Type declarations only | low |
| Instancing architecture | merged Geometry + instanced-mesh fork | Reusable slots, growing buffers, explicit mesh ownership, and per-placement references; shared-owner transforms affect all live instances, blockstate-level deduplication remains | high |

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
- ~~Load versioned registry and rendering data from `minerender-data`, replacing bundled runtime datasets; select a nearby published release when the exact registry version is unavailable.~~
- ~~Read ZIP pack metadata, select version-applicable overlays, and filter lower-priority resources.~~
- ~~Support chest, bed, mob-head, and shulker-box special item models, including shulker textures, openness, and six orientations.~~ ~~Render banner and shield items with supplied base colors and ordered banner patterns.~~ ~~Render held and throwing trident poses and static conduit items.~~ ~~Render decorated-pot items with four supplied sherd sides.~~ ~~Render player-head items from supplied profiles, including skin lookup, texture properties, resource-pack texture overrides, and default skins.~~ ~~Render copper-golem statue variants and poses from supplied block-state components.~~ ~~Resolve static/default item tint sources.~~ ~~Render nested composite items with each child's textures, display pose, lighting, and tints.~~ ~~Evaluate item properties from supplied data components, stack counts, display contexts, and overrides, with shared playground controls and bundle, bow, crossbow, and indexed custom-model-data presets.~~ ~~Resolve supplied dye, map, firework, potion custom-color, and indexed custom-model-data tints, including GUI item contexts and editable playground presets.~~ ~~Render animated enchantment glint on ordinary and composite items from supplied enchantments and explicit overrides, with playground controls.~~ ~~Render shield and held/throwing trident glint with the shared component controls.~~ ~~Apply vanilla 1.21.11 glint defaults by item ID, retaining explicit overrides and resource-pack model replacements.~~ ~~Render projected glint on compasses, recovery compasses, and clocks; derive normal-compass glint from supplied lodestone tracking and provide direction/time presets.~~ ~~Resolve potion and tipped-arrow colors from supplied potion IDs and visible custom effects using vanilla 1.21.11 data, with a playground potion selector and color overrides.~~ ~~Apply vanilla durability and stack-size defaults to model selectors and GUI bars, with editable playground overrides.~~ Composite items and items with glint do not use instancing. Other special-renderer glint, other special renderers, team colors, other item registry defaults, and automatic calculation of world/player state remain.
- ~~Fix `WrappedImage` frame math.~~

### 7. Model/blockstate correctness — complete
Small, high-impact: (1) ~~`Axis.X = "X"` → lowercase (x-rotations silently no-op)~~; (2) ~~await `BlockStates.getDefaultState`~~; (3) ~~texPosition-undefined crash~~; (4) ~~ModelMerger: child `elements` must override, not concat~~; (5) ~~remove the 150ms rotation workaround and preserve multipart rotations during placement~~; (6) ~~multipart AND/OR + `apply` arrays + weighted variants~~; (7) ~~`AssetKey.parse` extension fallback + broken `isAssetKey`~~. Then ~~tintindex with explicit colors~~, ~~automatic block preview colors~~, ~~uvlock~~, ~~display transforms~~.

### 8. Skins and capes — medium
~~Correct slim arm/sleeve UVs and preserve named parts, poses, visibility, and shared resources when switching classic/slim.~~ ~~Add 64×32 legacy layout and slim/legacy auto-detection.~~ ~~Match vanilla base opacity, overlay blending, dimensions, UVs, and joint pivots.~~ Consider sharing geometry construction with `EntityObject`; the unused `src/skin/playerModels.json` needs conversion from the legacy schema before reuse. ~~Add vanilla cape meshes wired to the existing `Skins.ts` resolvers.~~ ~~Add OptiFine/LabyMod layouts and capes.dev lookup.~~ Animated capes remain.

### 9. Entity rendering completion — high
~~Recurse `ModelPart.children`.~~ ~~Implement `mirror`.~~ ~~Verify the face UVs and pivot translation.~~ ~~Compose selected entity layers with separate textures and named groups (e.g. sheep body and wool).~~ ~~Support dataset render passes, emissive and scrolling materials, tint overrides, and renderer-specific root transforms.~~ ~~Render supported block entities during block placement.~~

Default textures and root transforms come from the versioned entity dataset; callers can override textures and select conditional passes. `flip: false` explicitly keeps raw model space rather than applying the dataset transform. The old `res/tools` intermediary-name remapping task is superseded by the `minecraft-entity-models` dataset integration.

~~Play native and sampled procedural clips with synchronized, layer-specific playback.~~ Runtime gameplay state selection, animation blending, visibility changes, and animated renderer transforms remain.

Regenerate and publish the `1.21.11` entity dataset with the procedural clips from [minecraft-entity-models #7](https://github.com/InventivetalentDev/minecraft-entity-models/pull/7), then verify hosted clips through `Entities.getAnimations`. As checked on 2026-10-09, the published branch predates that merge and contains only 17 native animation files, with no `animations/minecraft/chest.json`.

### 10. Instance lifecycle overhaul — high (prerequisite for worlds)
~~Limit `InstancedMesh.count` to allocated slots~~; ~~add a free-list so removal reclaims slots~~; ~~grow capacity on demand instead of silent out-of-bounds writes~~; ~~provide per-placement transforms through `InstanceReference`s~~; ~~replace the `children[0]`-is-the-InstancedMesh assumption with a stored reference~~. Shared-owner transforms still affect all live instances; changing that API remains separate work. Extend dedup beyond `assetType === "models"` to blockstate level.

### 11. World subsystem redesign for scale — high (the V2 differentiator)
Immediate fixes: ~~fix `getChunkAt` to use `Map.get(key)`~~; ~~remove the 4×4×4 bound and negative-coordinate rejection~~; ~~remove hardcoded debug wireframes~~; ~~fix `BatchedExecutor`'s missing setInterval delay + add `stop()`~~; ~~place structures and chunks in bounded batches with one final neighbor-culling pass~~. Then the redesign: ~~palette + typed-array section storage~~, ~~opt-in merged meshes and bounded atlas pages per chunk section for models of any shape, including cutout, translucent, multipart, and animated models, plus fluid surfaces~~ (block entities retain per-block objects), ~~neighbor face culling via model `cullface` against opaque full cubes~~ (partial-shape and matching transparent-block rules remain), ~~explicit chunk load/unload~~, ~~per-block visibility without deleting block data~~, ~~camera-driven streaming~~. Chunk-level visibility management, baked per-vertex ambient occlusion, biome tint, and LOD remain. Section meshes already have bounds for Three.js frustum culling.

~~Preserve modern Anvil biome palettes during import and placement, including air-only sections, with world-coordinate lookup.~~ Older numeric biome arrays remain unsupported. Apply biome colors to grass, foliage, and water in both rendering modes, then follow with saved light data and ambient occlusion. Measure real-world decoding, placement, frame stalls, and retained memory before choosing further worker or LOD work.

~~Seed weighted blockstate alternatives by world position so unloading and reloading a chunk preserves its appearance.~~ Individual blocks and section meshes share vanilla-identical weighted selection from absolute block coordinates. Standalone previews remain random unless given `variantPosition`.

~~Resolve each block state once per placement group and yield to the event loop instead of a timer-driven batch queue.~~ ~~Build section geometry in a browser worker.~~ Region decoding still runs on the main thread; wasm or worker-side chunk parsing remains a scale option once placement stops dominating.

~~Render sloped water/lava surfaces with still/flow textures and waterlogged blocks.~~ ~~Cover intrinsic water in kelp, seagrass, and bubble columns.~~ For remaining fluid parity, obtain vanilla block-state fluid definitions, face-occlusion shapes, and solidity/flow-blocking flags; add water overlays against glass/leaves. Keep 1 block = 16 units.

### 12. Node headless rendering entry point — high
~~Make `Renderer` constructible without DOM through an injected canvas and WebGL 2 context.~~ ~~Add `renderOnce()` and Node-only `NodeRenderer.renderToBuffer()` for fresh frames and PNG buffers without the animation loop.~~ `NodeRenderer.create({ width, height, ...options })` owns a native context from optional `gl@9.0.0-rc.10` (experimental WebGL 2); the Node entry uses `canvas` 3 for texture preparation. Injected contexts remain caller-owned. See [platform setup and usage](./packages/minerender/reference/platforms.md).

~~Add a V2 HTTP rendering service.~~ [`apps/api`](./apps/api/README.md) accepts versioned scene documents at `POST /v1/renders` and serves render metadata and PNG images. Rendering uses a pool of isolated processes with reusable asset caches, bounded concurrency, deadlines, and an expiring PNG cache. V2 deliberately replaces the V1 `GET /render/skin/:texture`, `GET /render/model/:type/:model`, and `minerender-options` contract. Returned PNG URLs can be embedded while cached; GET requests do not create renders. Hosting and persistent render storage remain separate work.

### 13. Anvil region (.mca) + schematic loaders — high
~~Add a world-format layer feeding chunk storage: `.mca` sector tables, section palettes and DataVersion; preserve NBT type/compression metadata; implement legacy `.schematic` ID/metadata and AddBlocks conversion; retain structure entities and DataVersion.~~ ~~Support custom legacy schematic mappings and opt-in lenient parsing.~~ ~~Decode Anvil LZ4 block streams with checksum validation.~~ ~~Read external `.mcc` payloads through caller-supplied readers and local world-folder imports.~~ ~~Decode pre-1.13 numeric Anvil chunks with shared schematic mappings, custom overrides, and opt-in lenient parsing.~~ ~~Load Sponge v2/v3 `.schem` files with local palettes, block states, offsets, block/entity NBT, and DataVersion; add playground and editor imports.~~ ~~Load Litematica v5–7 `.litematic` files with named regions, signed dimensions, relative placement, and preserved block/entity NBT; add playground and editor imports.~~ ~~Add opt-in rendering of supported saved mobs at their positions and yaw, with cleanup on column replacement, unloading, and world clearing.~~ Sponge biome and metadata import and DataVersion-based migration remain. ~~Load modern worlds' separate `entities/*.mca` files alongside terrain with shared cache limits and cancellation, including entity-only columns and world-folder imports.~~

### 14. GUI renderer parity — medium
~~Implement `GuiObject`: layered textured planes with UV crop, pixel positioning, and ordered layers.~~ ~~Wire `scene.addGui(...)`, `inventorySlot`, and a chest demo with camera fitting.~~ ~~Add item models in the GUI display pose.~~ ~~Draw stack counts and supplied-component durability bars, preserve recipe output counts, and add an inventory-slot playground preview.~~ ~~Add shaped/shapeless recipe layouts and update crafting for the newer recipe format.~~ ~~Add modern GUI sprite scaling (stretch, tile, nine-slice).~~ ~~Render styled bitmap text and tooltips from supplied lines.~~ ~~Update V1's boss bar and book layouts for the newer texture paths, expose chest/crafting presets, and add playground controls.~~ Extend fonts with Unihex/TrueType providers, translated text, and right-to-left shaping.

### 15. Polish: exports, animation API, inspector, demos, docs — medium
~~Port toObj/toGLTF and toImage trim/mime.~~ ~~Add a per-frame callback integrated with the dirty flag (replaces V1's CustomEvent contract).~~ ~~Fix `SceneInspector` raycast normalization and select individual instances.~~ ~~Fix `SceneStatsDisplay`'s leaked interval.~~ ~~Fix animated-texture timing, frame grids/sequences, and stationary-camera redraw for all scenes sharing an atlas, respecting `fpsLimit`; stop unused atlas tickers.~~ ~~Add texture interpolation.~~

~~Build the V2 website with live examples.~~ ~~Rework the demos into configurable playgrounds.~~ ~~Add portable scene documents and a browser scene editor.~~ ~~Add TypeDoc/VitePress reference tooling and library API JSDoc.~~ ~~Host the playgrounds and editor on Cloudflare.~~ ~~Add browser video export with recording controls.~~

Iframe embeds remain. Remove unused V1 website files from the V2 tree while preserving V1 delivery URLs. Extend existing regression coverage as remaining model and blockstate features land; keep the consumer API contract in AGENTS.md as the beta compatibility baseline.
