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
| Skins — classic 64×64 | full, named toggleable parts | Works (named groups/meshes, overlay toggling) — missing variant auto-detect, `makeNonTransparentOpaque` | medium |
| Skins — slim + legacy 64×32 | auto-detected, dedicated UVs | Half-done: slim geometry ✔, slim UVs = copy of classic (`SkinTextureCoordinates.ts:690`), no 64×32, no auto-detect | high |
| Capes (vanilla/OptiFine/LabyMod) | full, 3 layouts, capes.dev | Not rendered at all (resolvers exist in `Skins.ts`, no meshes) | medium |
| Block/item model rendering | full incl. tint, display transforms | Common models render; no tint/uvlock/display/builtin-entity | high |
| Blockstate resolution | variants + weighted random + multipart AND/OR | Default states awaited; no AND, no weighted pick, 150ms-setTimeout rotation hack | high |
| Animated textures | frametime honored | Frame extraction handles static images and vertical strips; timing and full mcmeta support remain | medium |
| Entity rendering | 76 hosted models, mirror, inheritance | Richer data (107+19 ModelPart dumps) but children never recursed, mirror TODO, texture paths guessed, box-UV math unverified | high |
| GUI / inventory / recipes | full GuiRender + Positions + recipe() | `GuiObject` is an empty stub | high |
| Structure (.nbt) loading | works via ModelConverter | Parses correctly; placement serialized, debug wireframes hardcoded on, no entities/DataVersion | high |
| Legacy .schematic | full incl. AddBlocks nibbles | `SchematicParser` returns `{}`; mapping data (`res/idsToNames.json`, `legacyBlockList.json`) present but unreferenced | medium |
| Combined multi-renderer scene | CombinedRender wrapper | Superseded by design (one scene hosts all types) — **at parity** | — |
| Screenshots & 3D export | toImage(trim,mime), toObj/toGLTF/toPLY | Bare `toDataURL()`; no exporters | medium |
| Asset loading & resource packs | swappable assetRoot, fallback | Ordered whole-asset source selection; decode fetched bytes; failure-evicting caches; contextual errors; defaults to 1.21.11, ZIPs browser-only | high |
| Per-frame animation API | `<type>Render` CustomEvents | No supported hook (dirty-flag loop only) | medium |
| Embeds & website | minerender.org + iframe embeds | Workspace demos and examples; V2 website and embeds remain | low |
| **Large-scale worlds (V2 goal)** | n/a | Prototype, effectively dead code: 64³ box, `getChunkAt` broken (Map indexed with number), object-per-block, no meshing/culling/lighting/LOD, instance slots never freed | high |
| **Anvil .mca / world formats (V2 goal)** | n/a | Zero code | high |
| **Node headless rendering (V2 goal)** | faked externally by MineRenderServer | No DOM-free Renderer construction, no render-to-buffer API | high |
| Bedrock geometry (V2 ambition) | n/a | Type declarations only | low |
| Instancing architecture | merged Geometry + instanced-mesh fork | Cleaner concept; fixed capacity w/ silent overflow, whole-object transforms move ALL instances, `children[0]` assumption, no slot reclamation, shader material breaks under instancing | high |

## Continuation plan (ordered)

### 1–4. Build and platform support

- ~~Build tooling, package exports, import-time initialization, and browser/Node providers.~~
- ~~Update cache and queue dependencies so idle imports let Node exit.~~

### 5. Renderer core

- ~~Fix start/stop, disposal, resize invalidation, and scene listeners.~~
- ~~Integrate opt-in OrbitControls.~~
- ~~Implement frame limiting.~~
- ~~Align Three types and color spaces; fix direct/composer brightness.~~

### 6. Asset pipeline

- ~~Resolve sources in priority order and return the first defined asset.~~
- ~~Initialize node-persist before use.~~
- ~~Decode fetched image bytes without refetching them; reject invalid images and allow retry.~~
- ~~Skip nullish persistent writes and evict missing or rejected async cache loads.~~
- ~~Bound request concurrency, retries, cancellation, timeouts, and shutdown.~~
- ~~Propagate hosted/archive and model initialization errors with source context.~~
- ~~Default to 1.21.11 with static item definitions, animal texture paths, structure directory aliases, and versioned cache keys.~~
- Add an asset-version selection API.
- Support composite/special item models, tint sources, and gameplay-dependent item selection.
- ~~Fix `WrappedImage` frame math.~~

### 7. Model/blockstate correctness — high
Small, high-impact: (1) ~~`Axis.X = "X"` → lowercase (x-rotations silently no-op)~~; (2) ~~await `BlockStates.getDefaultState`~~; (3) ~~texPosition-undefined crash~~; (4) ~~ModelMerger: child `elements` must override, not concat~~; (5) replace the 150ms setTimeout rotation hack with awaited init ordering; (6) multipart AND + `apply` arrays + weighted variants; (7) `AssetKey.parse` extension fallback + broken `isAssetKey`. Then tintindex, uvlock, display transforms. Grow the test suite around these (`mapStateToVariant`).

### 8. Finish skins: slim, cape, legacy — high
Preferred route: migrate `SkinObject` onto the ModelPart pipeline using the completely unused `src/skin/playerModels.json` (correct default+slim trees already there), unifying with `EntityObject` — slim UVs come for free and the hand-written slim stub retires. Add cape meshes (vanilla layout first; OptiFine/LabyMod layouts portable from V1 `texturePositions.js:896-1047`) wired to the existing `Skins.ts` resolvers. Add 64×32 legacy layout + slim/legacy auto-detection (port V1's pixel-scan, `MineRender/src/skin/index.js:129-158`). Dispose replaced geometries/materials on `setSlim` rebuilds.

### 9. Entity rendering completion — high
Recurse `ModelPart.children` (most multi-part entities currently render incomplete). Implement `mirror`. Verify the five TODO face-UV methods in `MinecraftCubeTexture.ts` and the possibly-doubled pivot translation. Extract model, texture, and variant metadata from Minecraft to replace guessed paths and the limited bundled `entityTextures.json` mapping. In `res/tools`, remap intermediary names (`field_20813`) in blockEntityModels and regenerate the hosted JSON.

### 10. Instance lifecycle overhaul — high (prerequisite for worlds)
Manage `InstancedMesh.count` (GPU currently always processes full capacity); add a free-list so removal reclaims slots (deletion today = zero-scale forever); grow capacity on demand instead of silent out-of-bounds writes; route whole-object transforms through per-index `InstanceReference`s (four "TODO specific instance" sites move ALL instances today); replace the `children[0]`-is-the-InstancedMesh assumption with a stored reference; extend dedup beyond `assetType === "models"` to blockstate level.

### 11. World subsystem redesign for scale — high (the V2 differentiator)
Immediate fixes: `getChunkAt` uses `this._chunks[numericIndex]` on a Map — use `.get(key)` (`MineRenderWorld.ts:104`); remove the 4×4×4 bound and negative-coordinate rejection (1.18+ needs negative Y); remove hardcoded debug wireframes (`Chunk.ts:34-43, 102-107`); fix `BatchedExecutor`'s missing setInterval delay + add `stop()`; parallelize `placeMultiBlock` (the `await` inside the loop serializes everything). Then the real redesign: palette + typed-array section storage (drop object-per-block `BlockInfo`), one merged mesh per chunk section with neighbor face culling via the model `cullface` attribute (currently entirely unhandled), chunk load/unload + frustum culling, baked per-vertex AO (SSAO was abandoned at ~2fps), biome tint. Keep 1 block = 16 units.

### 12. Node headless rendering entry point — high
Make `Renderer` constructible without DOM: injectable canvas + GL context (headless-gl or OffscreenCanvas), `renderOnce()`/`renderToBuffer()` bypassing the animation loop, `toImage()` returning a Buffer in Node (V1's `trimCanvas` is portable). `InventivetalentDev/MineRenderServer` is the reference contract — it faked all of this against V1 and reached into `_scene`/`_camera`; V2 already exposes them publicly. Then a thin V2 server can revive `GET /render/skin/:texture` and `GET /render/model/:type/:model`.

### 13. Anvil region (.mca) + schematic loaders — high
New world-format layer feeding the redesigned chunk storage: .mca region parsing (sector table, section palettes, DataVersion) — `NBTHelper` must stop discarding prismarine-nbt type/compression metadata; implement `SchematicParser` (legacy .schematic) using the already-present `legacyBlockList.json` / `res/idsToNames.json` mappings (V1 reference: `modelConverter.js:209-275`); Sponge `.schem` + litematica as follow-ups; structure entities + DataVersion handling.

### 14. GUI renderer parity — medium
Implement `GuiObject` (empty stub today): layered textured planes with UV crop, pixel positioning, z-layering, camera auto-fit. V1's `guiPositions.js` (boss bars, book, chest, crafting table atlases) and `guiHelper.js` (`inventorySlot` math + `recipe()` for crafting_shaped/shapeless JSON) port nearly verbatim; update texture paths for the newer asset layout. Wire `scene.addGui(...)`.

### 15. Polish: exports, animation API, inspector, demos, docs — medium
Port toObj/toGLTF and toImage trim/mime. Add a per-frame callback integrated with the dirty flag (replaces V1's CustomEvent contract). Fix `SceneInspector` raycast normalization (against canvas rect, not window) and `SceneStatsDisplay`'s leaked interval. Fix animated-texture tick rate + full mcmeta support. Finish the demos and V2 website, including embeds. Remove unused V1 website files from the V2 tree while preserving V1 delivery URLs. Add regression coverage for remaining model and blockstate work; keep the consumer API contract in AGENTS.md as the beta compatibility baseline.
