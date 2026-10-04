# MineRender V2 — Agent & Contributor Guide

MineRender V2 is a from-scratch TypeScript rewrite of [MineRender](https://minerender.org), a three.js-based library for interactive 3D renders of Minecraft content: player skins, block/item models, entities, GUIs, and structures/worlds. Published on npm as `minerender`; V2 is in alpha.

V2's goals beyond V1 parity: cleaner code, better performance, **usable from both browser and server-side Node**, and **large-scale rendering of full Minecraft worlds** (V1 topped out at structure files).

See **[ROADMAP.md](./ROADMAP.md)** for the V1→V2 feature-parity matrix, the full known-bug list, and the ordered continuation plan. Start there before picking up work.

## Workspace and ecosystem map

The private Yarn workspace root contains the public library and its consumers. Unless a path starts with `apps/`, `examples/`, or `packages/`, library paths below (including `src/`, `test/`, `dist/`, and `tsup.config.ts`) are relative to `packages/minerender/`. Run the documented Yarn commands from the repository root. Root `docs/`, website files, and `res/` remain outside the library package.

| Repo / service | Role |
|---|---|
| `packages/minerender/` | Public `minerender` library, moved from the V2 repository root. Browser, Node, and IIFE delivery formats retain their package paths. |
| `apps/web/` | MineRenderWeb demo/test pages, built with esbuild against the library workspace. |
| `examples/vite/` | Vue 3 + Vite consumer, imported from `MineRender/example-vite`. Uses ESM named imports and a workspace dependency. |
| `examples/script-tag/` | Plain HTML consumer, imported from `MineRender/example-bundle`. Loads the library's IIFE as `MineRender`. |
| `InventivetalentDev/MineRender` (V1 checkout: `MineRenderV1`) | `master` contains V1 (JS, webpack 4, three 0.93, browser-only), the feature-parity reference. V2 development shares this repository on `typescript` and the stacked refactor branches. Preserve V1 tags, bundles, and website URLs. |
| `InventivetalentDev/MineRenderServer`  | V1-era headless render HTTP API (Express + headless-gl + patched node-canvas + three-png-stream under xvfb). Reference only; not imported. Its contract includes `GET /render/skin/[:texture]`, `GET /render/model/:type/:model`, the `minerender-options` header, and an MD5-keyed PNG cache. |
| [minecraft-entity-models](https://github.com/InventivetalentDev/minecraft-entity-models) | Per-model entity and block-entity geometry at `assets.mcasset.cloud/<version>/entity-models/<namespace>/<id>.json`; default blockstates and fallback vanilla assets remain in [minerender-fallback-assets](https://github.com/InventivetalentDev/minerender-fallback-assets). |
| `assets.mcasset.cloud` | Primary vanilla-asset CDN, defaults to MC **1.21.11** in `src/assets/Assets.ts` (`DEFAULT_ROOT`). Provides synthetic `_list.json` directory indexes that `getList()` APIs depend on. |
| `minecraft-skin-proxy.inventive.workers.dev` | Own Cloudflare worker for CORS-safe skin/cape/UUID lookups (`src/skin/Skins.ts`); also api.mineskin.org, api.capes.dev. |

## Build, test, publish

- **Runtime: Node.js 22+**, or a browser with native Fetch and AbortController. Node builds target Node 22.
- **Package manager: yarn 4 (`packageManager: yarn@4.5.3`, corepack), `nodeLinker: node-modules`.** Do not use npm here.
- Install dependencies on the OS that runs the build; esbuild, Rollup, and `canvas` use platform-specific binaries.
- Root commands delegate to the workspaces:

  | Command | Scope |
  |---|---|
  | `yarn build` | Build the library, web demos, and both examples. |
  | `yarn build:lib` | Build the public library only. |
  | `yarn test` | Run the library's AVA tests. |
  | `yarn typecheck` | Typecheck the library and Vite example. |
  | `yarn dev:web`, `yarn dev:vite`, `yarn dev:script-tag` | Start the corresponding local consumer. |

- **tsup builds the library** (`tsup.config.ts` exports three passes; Rollup only appears through the declaration build). The web demos use esbuild, and the Vue example uses Vite.

  | Pass | Entry | Output | Notes |
  |---|---|---|---|
  | `browser` | `src/index.browser.ts` | `dist/browser/index.{js,mjs,d.ts,d.mts}` | deps external, for bundlers |
  | `node` | `src/index.node.ts` | `dist/node/index.{js,mjs,d.ts,d.mts}` | `canvas` external (optional dep) |
  | `iife` | `src/index.browser.ts` | `dist/bundle.js` | `globalName: MineRender`, everything inlined incl. three, node-polyfilled for prismarine-nbt's `zlib` |

  `package.json` `exports` routes `browser`/`node` conditions to the matching build; `dist/bundle.js` keeps its historical path for unpkg/script-tag consumers.
- `ts-deepmerge` is deliberately `noExternal` (inlined): it is CJS exporting `{default: fn}`, which Node's ESM loader will not unwrap, so `import merge from "ts-deepmerge"` breaks in `.mjs` output unless esbuild does the interop at build time.
- `yarn test` runs AVA tests from `test/*.test.ts` through `esbuild-runner`. Follow the existing test style and cover behavior that can regress.
- Publish only the `minerender` workspace with `yarn publish:alpha`: build, increment the prerelease version with Yarn, and publish under `alpha`. Commit and tag the release separately. The package includes `dist`, README, and LICENSE.
- `src/index.ts` is **autogenerated** by `scripts/make-exports.sh` — the *shared* barrel, and everything in it must work on both platforms. `src/env/` is excluded on purpose (see the Env seam below), as are the two entry files. Don't hand-edit it beyond regenerating (`yarn workspace minerender exports`).
- Root `res/tools/` contains offline scripts that generate entity-model JSON for the fallback-assets repo (java-parser over decompiled vanilla renderers and a Bedrock geometry converter). It is not a workspace or part of the library build.

## Architecture


**Rendering core** (`src/renderer/`): `Renderer` owns a `WebGLRenderer` and an optional `postprocessing` EffectComposer and a **dirty-flag render loop** — frames render only when `dirty` (or `options.render.renderAlways`). `MineRenderScene extends THREE.Scene` with asset-aware `addModel/addBlock/addSkin/addEntity`, all funneling through `addSceneObject`. `SceneObject extends Object3D` is the base for `ModelObject`, `BlockObject`, `SkinObject`, `EntityObject`, `GuiObject` (empty stub); it provides named-group/mesh addressing (`group:head`, `mesh:head` via `getGroupByName`/`getMeshByName`) and the instancing plumbing.

**Instancing** (`src/instance/`): `InstanceManager` dedupes models with the same `AssetKey.serialize()`, display position, UV-lock rotation, and tint palette into shared fixed-capacity `InstancedMesh`es (default 50, 2000 for world blocks); callers get an `InstanceReference` (instanceable + index) that proxies transforms to `set*At(index)`. This is the core large-world performance mechanism, and its lifecycle (grow/free/count) is unfinished — see ROADMAP.

**Asset pipeline** (`src/assets/`, `src/cache/`, `src/request/`): assets are addressed by `AssetKey` `{namespace, path, assetType, type, rootType, extension, root}`; `AssetKey.serialize()` is the universal cache key and includes the explicit root or `AssetLoader.ROOT`, separating versions in persistent caches. `AssetLoader` holds an ordered `AssetSource` registry (`HostedAssetSource` for CDNs, `ArchiveAssetSource` + `BrowserArchiveProxy` for resource-pack zips — browser-only today). Added sources have highest priority. `get()` snapshots that order and returns the first defined result; `getFirst()` tries alternative paths within each source, and `getAll()` collects all sources. Hosted namespace/root retries remain per-source; use `retryDefaults: false` for strict layering. Caching layers: in-memory TTL caches (`Caching`, 10min/5min) over `PersistentCache` (node-persist in Node / localforage in browser; `VERSION = 2` selects fresh directories/databases and leaves older stores untouched). Requests go through `jobqu` queues over native Fetch (`Requests.ts`). `RequestConfig` extends Fetch options with `url`, `baseURL`, `timeout`, and `responseType`; `RequestResponse` contains decoded data, native `Headers`, and the final URL. Custom response parsers use these library-owned types. `AssetLoader.setVersion(version)` selects the mcassets version, exposed by `AssetLoader.version`, and clears in-memory caches.

**Model pipeline** (`src/model/`, `src/UVMapper.ts`): Java-edition model JSON → `ModelMerger` resolves the parent chain (ts-deepmerge) → `UVMapper.createAtlas` builds a **per-model texture atlas** on a compat canvas and bakes atlas UVs into `element.mappedUv` *before* geometry creation → `ModelObject.init` builds cached `BoxGeometry`s per element, optionally merges (`mergeMeshes`) and instances (`instanceMeshes`). Blockstates (`src/model/block/`): `BlockObject` resolves variants/multipart via `mapStateToVariant` and creates its visuals as `ModelObject`s through `scene.addModel` (so blocks share model instances). Modern `items/` definitions resolve to model files before parent merging; legacy `models/item/` files remain supported. Generated item models get elements from `ModelGenerator`.

**Skins** (`src/skin/`): `SkinObject` builds classic and slim players from per-part box sizes (`SkinGeometries`) and UV tables (`SkinTextureCoordinates`). `setSlim` updates arm geometry and spacing in place, preserving named parts, poses, materials, and visibility. Geometry and image materials are shared cache entries. The unused `playerModels.json` uses the legacy entity schema.

**Entities** (`src/entity/`): `Entities.getEntity` loads a versioned `entity-models` file and selects a layer (`main` by default). Parts form a nested `Object3D` hierarchy with radian poses, inherited texture dimensions, cube growth, and mirrored box UVs. The entity root uses scale `(-1, -1, 1)` when `flip` is enabled (default `true`). Without an explicit texture key, use dataset `textureLocation` first, then the resolver (model path, a same-named texture in its directory, then variant data); `getBlock` and `getBlockList` are deprecated aliases. `src/bedrock/` contains type declarations only.

**World** (`src/world/`): early prototype — `MineRenderWorld` (hardcoded 4×4×4 chunks, non-negative coords) → cubic 16³ `Chunk`s holding sparse `BlockInfo[]` (a retained `Block` + `BlockObject` per placed block). No chunk meshing, no cullface/neighbor culling, no lighting/tint/LOD. Only loadable format is vanilla structure `.nbt` (`StructureParser` via dynamically-imported prismarine-nbt); `SchematicParser` is a stub. The demos in `apps/web/` exercise `MineRenderWorld`.

**Animation**: mcmeta texture-frame cycling only (atlas repaint closures driven by `src/Ticker.ts`). No skeletal/pose animation anywhere.

## Load-bearing conventions

- **Dirty flag**: anything that mutates visuals must end up calling `notifyDirty()` / setting `scene.dirty`, or the frame never repaints. Built-in OrbitControls (`controls: { enabled: true }`) register automatically and update before the dirty check and frame limit. `render.fpsLimit` caps draws (default 60; nonpositive values disable the cap), retaining dirty state on skipped frames. Register external event sources, including manually created controls, via `renderer.registerEventDispatcher(...)`.
- **Renderer ownership**: `stop()` pauses; `dispose()` is final. Dispose only owned resources; shared assets, global caches, and caller-owned controls retain their owners.
- **Color pipeline**: image and canvas color-texture factories set `SRGBColorSpace`; the renderer uses sRGB output in both direct and composer mode. Custom model shaders apply shading in linear light and include Three's tone-mapping and output-color chunks. Keep the generic `Textures.initTextureProps` helper limited to sampling settings so it preserves caller-supplied data-texture color spaces.
- **Block preview colors**: `src/model/block/blockTints.json` maps block IDs to preview rules. Grass uses the active resource pack's colormap; cauldron water defaults to blue. Explicit `tints` override automatic colors. Biome colors require world context and remain separate.
- **Face order**: `CUBE_FACES` = east, west, up, down, south, north (three.js BoxGeometry material order). UV buffers are written at `faceIndex * 4` vertices. Skins, entities, and models all rely on this ordering.
- **Scale**: 1 block = 16 scene units (= Minecraft model space); 1 chunk = 256 units.
- **Instance deletion = scale-to-zero**: removal writes a zero-scale matrix; slots are never reclaimed (known design debt).
- **Instancing gate**: `addSceneObject` only dedupes when `asset.key.assetType === "models"`; `BlockObject`s are deliberately **not added to the scene graph** (their ModelObjects are) — block transforms only exist through instance references.
- **`isX: true` marker + guard-function pattern** (`isMineRenderScene`, `isAssetKey`, …) is used instead of `instanceof` throughout.
- **The Env seam** (`src/Env.ts`) is the browser/Node boundary and the thing that keeps the build working. `EnvProvider` declares the four platform-dependent capabilities — `createCanvas`, `createImage`, `imageSize`, `openCache` — and `src/env/browser/` + `src/env/node/` implement them. **Nothing outside `src/env/node/` may import `canvas`, `node-persist`, `image-size`, or a Node builtin as a value**; type-only imports (`import type`) are fine because they erase. The entries (`src/index.browser.ts`, `src/index.node.ts`) each `import "./env/<platform>/register"` *first*, so the provider is installed before any other module body runs. Verify with:
  `rg -o 'from ?"[^"]+"' packages/minerender/dist/browser/index.mjs | sort -u` — that list must stay free of Node modules.
- **No work at import time.** Anything expensive or platform-dependent must be lazy (`Materials.MISSING_TEXTURE`, the `PERSISTENT_CACHE` getters and `Ticker`'s timers are all deferred for this reason). A static field initializer that decodes an image or opens a cache will run before any consumer has configured anything, and in Node it will run in a process that has no DOM.

## Gotchas

- Idle caches and request queues let Node exit. `shutdown()` clears shared caches, permanently ends request queues, and stops Ticker.
- Requests require Fetch and `AbortSignal.any/timeout`, with bounded GET retries and timeouts through body reading. Cancellation aborts a call; shutdown rejects waiting work and lets active calls finish.
- Async list/dictionary caches evict missing and rejected loads. Clear in-memory caches when sources change; persistent storage must be cleared separately.
- Image decode failures reject and evict the matching cache entry. Failed synchronous image placeholders are retried on the next lookup.
- Item previews use the GUI context, false conditions, and zero numeric properties. Composite/special item renderers, tint sources, and gameplay-dependent selection remain unsupported.
- Hosted/archive failures reject with `AssetLoadError`. Only missing assets or an explicit `undefined` parser result permit fallback.
- Keep `@types/three` and `three` on the same minor version; import geometry/material types from bare `three`.
- Node imports require a working native `canvas` installation; browser-only installs can skip its optional build.
- `src/_model/`, `src/lib/OrbitControls.js`, root `mccolor.js`, and the empty root `three/` are unused legacy code.
- Preserve V1 `master`, tags, bundles, and website URLs. Legacy website files are excluded from the V2 npm package.

## Public API compatibility contract

The union of what the three consumers (`examples/vite`, `apps/web`, `examples/script-tag`) actually call — treat as semi-frozen until a deliberate break:

`new Renderer({camera, render: {stats, fpsLimit, antialias}, composer: {enabled}, debug: {grid, axes}})`, `renderer.appendTo/start/registerEventDispatcher/toImage`, `renderer.scene` / `renderer.camera` / `renderer.renderer`; `scene.addModel/addBlock/addSkin/addEntity/stats`; `Models.getMerged/clearCache`; `BlockStates.get/getList`; `Entities.getEntity/getBlock/getEntityList/getBlockList`; `Skins.fromUuidOrUsername`; `SkinObject.setSkinTexture`; `AssetKey` (5–7 arg ctor, `AssetKey.parse`); `AssetLoader.ROOT/addSource/loadOrRetryWithDefaults/NBT`; `HostedAssetSource`, `ArchiveAssetSource`, `BrowserArchiveProxy`; `Caching.clear`; `StructureParser.parse`; `MineRenderWorld(scene).setBlockAt/clear/placeMultiBlock`; `BatchedExecutor`; `Ticker.tpsOneSecond/tpsFiveSeconds`; `SceneInspector`; re-exported `OrbitControls`; per-object `setPosition/removeFromScene/disposeAndRemoveAllChildren/isInstanced/instanceCounter`.

Delivery formats that must all keep working: ESM named imports under a bundler, CJS require, and the `window.MineRender` IIFE bundle (script tag / unpkg). All three are built by `yarn build:lib`. Check imports under Node as well as loading the consumers in a browser.

Additional public APIs: `shutdown()`, `Env`/`EnvProvider`, `BrowserEnv`/`NodeEnv` (per-entry), `Caching.end`, `Requests.end`, `Ticker.start/stop`, `Renderer.dispose`, optional `controls.enabled`, and `renderer.controls` (undefined unless enabled at construction, and after disposal).

## Where to continue

Follow the ordered tasks in [ROADMAP.md](./ROADMAP.md).
