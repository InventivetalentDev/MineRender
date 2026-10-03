# MineRender V2 — Agent & Contributor Guide

MineRender V2 is a from-scratch TypeScript rewrite of [MineRender](https://minerender.org), a three.js-based library for interactive 3D renders of Minecraft content: player skins, block/item models, entities, GUIs, and structures/worlds. Published on npm as `minerender` (currently `2.0.0-alpha.15`). Development uses the `typescript` branch in `InventivetalentDev/MineRender`. The monorepo migration uses `refactor/v2-monorepo`; lifecycle fixes use `fix/renderer-lifecycle`, based on that migration, in a separate worktree.

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
| `InventivetalentDev/MineRenderServer` (local checkout: `MineRenderServer`) | V1-era headless render HTTP API (Express + headless-gl + patched node-canvas + three-png-stream under xvfb). Reference only; not imported. Its contract includes `GET /render/skin/[:texture]`, `GET /render/model/:type/:model`, the `minerender-options` header, and an MD5-keyed PNG cache. |
| [minerender-fallback-assets](https://github.com/InventivetalentDev/minerender-fallback-assets) | GitHub repo serving the custom `minerender:` namespace assets (entityModels, blockEntityModels, defaultBlockStates) and fallback copies of vanilla assets. The JSON files inside `src/` here are **reference copies only** — runtime fetches from that repo (see Gotchas). |
| `cdn.mcasset.cloud` | Primary vanilla-asset CDN, hardcoded to MC **1.17.1** in `src/assets/Assets.ts` (`DEFAULT_ROOT`). Provides synthetic `_list.json` directory indexes that `getList()` APIs depend on. |
| `minecraft-skin-proxy.inventive.workers.dev` | Own Cloudflare worker for CORS-safe skin/cape/UUID lookups (`src/skin/Skins.ts`); also api.mineskin.org, api.capes.dev. |

## Build, test, publish

- **Package manager: yarn 4 (`packageManager: yarn@4.5.3`, corepack), `nodeLinker: node-modules`.** Do not use npm here.
- **The migration checkout is on macOS.** Install dependencies on the machine that runs the build; esbuild, Rollup, and `canvas` binaries are platform-specific. Do not reuse `node_modules` from the earlier Windows/WSL checkout.
- Root commands delegate to the workspaces:

  | Command | Scope |
  |---|---|
  | `yarn build` | Build the library, web demos, and both examples. |
  | `yarn build:lib` | Build the public library only. |
  | `yarn test` | Run the library's existing AVA tests. |
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
- The library tests run TS sources through `esbuild-runner`. One test file exists (`test/AssetKey.test.ts`), containing three AVA tests. Use the existing test style and keep the library type-clean.
- Publish only the `minerender` workspace; the root, web app, and examples are private. The library `files` whitelist includes `dist` + README + LICENSE. `yarn publish:alpha` builds the library, computes the next `alpha` version with semver, applies it with Yarn, and publishes to the registry's `alpha` tag. It does not create a Git commit or Git tag; no publication is part of the migration. The npm package retains `dist/bundle.js`, browser/Node exports, and its public API.
- `src/index.ts` is **autogenerated** by `scripts/make-exports.sh` — the *shared* barrel, and everything in it must work on both platforms. `src/env/` is excluded on purpose (see the Env seam below), as are the two entry files. Don't hand-edit it beyond regenerating (`yarn workspace minerender exports`).
- Root `res/tools/` contains offline scripts that generate entity-model JSON for the fallback-assets repo (java-parser over decompiled vanilla renderers and a Bedrock geometry converter). Its historical package manifest is absent from this checkout; it is not a workspace or part of the library build.

## Architecture

~130 TS files, ~8k lines (excluding vendored three helpers in `src/three/` and `src/lib/`).

**Rendering core** (`src/renderer/`): `Renderer` owns a `WebGLRenderer` + `postprocessing` EffectComposer and a **dirty-flag render loop** — frames render only when `dirty` (or `options.render.renderAlways`). `MineRenderScene extends THREE.Scene` with asset-aware `addModel/addBlock/addSkin/addEntity`, all funneling through `addSceneObject`. `SceneObject extends Object3D` is the base for `ModelObject`, `BlockObject`, `SkinObject`, `EntityObject`, `GuiObject` (empty stub); it provides named-group/mesh addressing (`group:head`, `mesh:head` via `getGroupByName`/`getMeshByName`) and the instancing plumbing.

**Instancing** (`src/instance/`): `InstanceManager` dedupes identical models — same `AssetKey.serialize()` — into shared fixed-capacity `InstancedMesh`es (default 50, 2000 for world blocks); callers get an `InstanceReference` (instanceable + index) that proxies transforms to `set*At(index)`. This is the core large-world performance mechanism, and its lifecycle (grow/free/count) is unfinished — see ROADMAP.

**Asset pipeline** (`src/assets/`, `src/cache/`, `src/request/`): assets are addressed by `AssetKey` `{namespace, path, assetType, type, rootType, extension, root}`; `AssetKey.serialize()` is the universal cache key (it embeds the asset root). `AssetLoader` holds an ordered `AssetSource` registry (`HostedAssetSource` for CDNs, `ArchiveAssetSource` + `BrowserArchiveProxy` for resource-pack zips — browser-only today). Added sources have highest priority. `get()` snapshots that order and returns the first defined result unchanged; `getAll()` still collects all sources. Hosted namespace/root retries remain per-source; use `retryDefaults: false` for strict layering. Caching layers: in-memory TTL caches (`Caching`, 10min/5min) over `PersistentCache` (node-persist in Node / localforage in browser; `VERSION = 2` selects fresh directories/databases and leaves older stores untouched). Requests go through `jobqu` queues over axios (`Requests.ts`).

**Model pipeline** (`src/model/`, `src/UVMapper.ts`): Java-edition model JSON → `ModelMerger` resolves the parent chain (ts-deepmerge) → `UVMapper.createAtlas` builds a **per-model texture atlas** on a compat canvas and bakes atlas UVs into `element.mappedUv` *before* geometry creation → `ModelObject.init` builds cached `BoxGeometry`s per element, optionally merges (`mergeMeshes`) and instances (`instanceMeshes`). Blockstates (`src/model/block/`): `BlockObject` resolves variants/multipart via `mapStateToVariant` and creates its visuals as `ModelObject`s through `scene.addModel` (so blocks share model instances). Item models get synthesized elements via `ModelGenerator`.

**Skins** (`src/skin/`): `SkinObject` builds the player from hand-written per-part box sizes (`SkinGeometries`) and UV tables (`SkinTextureCoordinates`). Slim is half-done: geometry yes, UVs no. `playerModels.json` (unused) carries correct default+slim `ModelPart` trees — migrating SkinObject onto the entity/ModelPart path is the intended fix.

**Entities** (`src/entity/`): models are dumps of vanilla (Java) `ModelPart` trees — *not* Bedrock JSON — fetched as `minerender:entityModels` / `minerender:blockEntityModels` assets; rendered via `MinecraftCubeTexture` box-UV math. Child parts are not yet recursed. `src/bedrock/` is type declarations only (no parser/renderer).

**World** (`src/world/`): early prototype — `MineRenderWorld` (hardcoded 4×4×4 chunks, non-negative coords) → cubic 16³ `Chunk`s holding sparse `BlockInfo[]` (a retained `Block` + `BlockObject` per placed block). No chunk meshing, no cullface/neighbor culling, no lighting/tint/LOD. Only loadable format is vanilla structure `.nbt` (`StructureParser` via dynamically-imported prismarine-nbt); `SchematicParser` is a stub. The demos in `apps/web/` exercise `MineRenderWorld`.

**Animation**: mcmeta texture-frame cycling only (atlas repaint closures driven by `src/Ticker.ts`). No skeletal/pose animation anywhere.

## Load-bearing conventions

- **Dirty flag**: anything that mutates visuals must end up calling `notifyDirty()` / setting `scene.dirty`, or the frame never repaints. Built-in OrbitControls (`controls: { enabled: true }`) register automatically and update before the dirty check and frame limit. `render.fpsLimit` caps draws (default 60; nonpositive values disable the cap), retaining dirty state on skipped frames. Register external event sources, including manually created controls, via `renderer.registerEventDispatcher(...)`.
- **Renderer ownership**: `stop()` pauses and `start()` resumes. `dispose()` is final and idempotent: it detaches scene children, removes the renderer's listeners and DOM, disposes its built-in controls/debug helpers/composer/WebGL renderer, and releases its owned GL context. Caller-owned controls and shared scene assets remain the caller's responsibility; it does not clear global caches or stop the shared Ticker.
- **Color pipeline**: image and canvas color-texture factories set `SRGBColorSpace`; the renderer uses sRGB output in both direct and composer mode. Custom model shaders apply shading in linear light and include Three's tone-mapping and output-color chunks. Keep the generic `Textures.initTextureProps` helper limited to sampling settings so it preserves caller-supplied data-texture color spaces.
- **Face order**: `CUBE_FACES` = east, west, up, down, south, north (three.js BoxGeometry material order). UV buffers are written at `faceIndex * 4` vertices. Skins, entities, and models all rely on this ordering.
- **Scale**: 1 block = 16 scene units (= Minecraft model space); 1 chunk = 256 units.
- **Instance deletion = scale-to-zero**: removal writes a zero-scale matrix; slots are never reclaimed (known design debt).
- **Instancing gate**: `addSceneObject` only dedupes when `asset.key.assetType === "models"`; `BlockObject`s are deliberately **not added to the scene graph** (their ModelObjects are) — block transforms only exist through instance references.
- **`isX: true` marker + guard-function pattern** (`isMineRenderScene`, `isAssetKey`, …) is used instead of `instanceof` throughout.
- **The Env seam** (`src/Env.ts`) is the browser/Node boundary and the thing that keeps the build working. `EnvProvider` declares the four platform-dependent capabilities — `createCanvas`, `createImage`, `imageSize`, `openCache` — and `src/env/browser/` + `src/env/node/` implement them. **Nothing outside `src/env/node/` may import `canvas`, `node-persist`, `image-size`, or a Node builtin as a value**; type-only imports (`import type`) are fine because they erase. The entries (`src/index.browser.ts`, `src/index.node.ts`) each `import "./env/<platform>/register"` *first*, so the provider is installed before any other module body runs. Verify with:
  `rg -o 'from ?"[^"]+"' packages/minerender/dist/browser/index.mjs | sort -u` — that list must stay free of Node modules.
- **No work at import time.** Anything expensive or platform-dependent must be lazy (`Materials.MISSING_TEXTURE`, the `PERSISTENT_CACHE` getters and `Ticker`'s timers are all deferred for this reason). A static field initializer that decodes an image or opens a cache will run before any consumer has configured anything, and in Node it will run in a process that has no DOM.

## Gotchas

- **The JSON data files in `src/` (`entityModels.json`, `blockEntityModels.json`, `defaultBlockStates.json`, `playerModels.json`, `legacyBlockList.json`) are not imported by code.** Runtime fetches them as `minerender:` namespace assets from the fallback-assets GitHub repo. Editing the local copies changes nothing until pushed there.
- **Idle Node processes can exit without `shutdown()`.** `@inventivetalent/loading-cache` 1.x unrefs cache expiry timers; `jobqu` 3.x creates timers only for pending work and keeps them referenced by default. Each request queue dispatches up to one attempt per 10 ms, with at most eight active requests. Transient GET failures can retry three times through the same queue, with 100/200/400 ms delays. `Retry-After` can extend a delay to 30 seconds; longer requests for delay fail without retrying early. Cancellation removes queued work and interrupts retry waits. `Requests.queueSizes` counts unsettled API calls, including retry waits and active calls after shutdown; coalesced callers each count once. Call `shutdown()` (`src/shutdown.ts`) only for final cleanup: it clears caches and stops the shared Ticker and queues. Queued, retrying, and future calls reject, active HTTP calls can finish, and queues do not restart. Retry counters stay local, and MineRender headers are set only on its Axios instances.
- Item/blockstate lists, default blockstates, and entity model dictionaries use the shared async caches (10 minutes after write, 5 minutes after access). Missing or rejected loads are evicted; valid empty results stay cached. `Caching.clear()` resets these entries after a source change, and `Caching.end()` clears them and stops their timers. `PersistentCache.getOrLoad()` skips nullish writes; explicit persistent-cache clearing remains separate.
- `ImageLoader` decodes fetched bytes, and its async methods reject request, dimension, and decode errors. Failed loads can retry; corrupt raw/model texture bytes are evicted without removing a newer cache entry. Synchronous `Textures.getImage` and `Materials.getImage` replace failed cached placeholders on the next lookup; existing object references are not replaced automatically. Hosted and archive sources still collapse request/parser failures to `undefined`, so those APIs cannot distinguish a missing asset from a network failure.
- `@types/three` (~0.158) matches the runtime `three` peer (^0.158). Keep their minor versions aligned. Import geometry/material types from bare `three`; any remaining deep helper imports must stay type-only.
- `canvas` is an **optionalDependency**: browser-only installs must not be forced to compile node-canvas, and it has no prebuilt binary for recent Node (a source build needs cairo/pango/pixman). Its *types* still resolve because the package is downloaded either way. The Node entry genuinely requires the binary at runtime.
- Dead code to not be confused by: `src/_model/` (orphaned schema experiment), `src/lib/OrbitControls.js` (older duplicate of `src/three/OrbitControls.js`), root `mccolor.js`, the empty root `three/` dir.
- V1's repo doubles as the live minerender.org website; V2's repo also carries website leftovers (`index.html`, `manifest.json`) — now excluded from the tarball by the `files` whitelist.

## Public API compatibility contract

The union of what the three consumers (`examples/vite`, `apps/web`, `examples/script-tag`) actually call — treat as semi-frozen until a deliberate break:

`new Renderer({camera, render: {stats, fpsLimit, antialias}, composer: {enabled}, debug: {grid, axes}})`, `renderer.appendTo/start/registerEventDispatcher/toImage`, `renderer.scene` / `renderer.camera` / `renderer.renderer`; `scene.addModel/addBlock/addSkin/addEntity/stats`; `Models.getMerged/clearCache`; `BlockStates.get/getList`; `Entities.getEntity/getBlock/getEntityList/getBlockList`; `Skins.fromUuidOrUsername`; `SkinObject.setSkinTexture`; `AssetKey` (5–7 arg ctor, `AssetKey.parse`); `AssetLoader.ROOT/addSource/loadOrRetryWithDefaults/NBT`; `HostedAssetSource`, `ArchiveAssetSource`, `BrowserArchiveProxy`; `Caching.clear`; `StructureParser.parse`; `MineRenderWorld(scene).setBlockAt/clear/placeMultiBlock`; `BatchedExecutor`; `Ticker.tpsOneSecond/tpsFiveSeconds`; `SceneInspector`; re-exported `OrbitControls`; per-object `setPosition/removeFromScene/disposeAndRemoveAllChildren/isInstanced/instanceCounter`.

Delivery formats that must all keep working: ESM named imports under a bundler, CJS require, and the `window.MineRender` IIFE bundle (script tag / unpkg). All three are built by `yarn build:lib`. Check imports under Node as well as loading the consumers in a browser.

Added since: `shutdown()`, `Env`/`EnvProvider`, `BrowserEnv`/`NodeEnv` (per-entry), `Caching.end`, `Requests.end`, `Ticker.start/stop`, `Renderer.dispose`, optional `controls.enabled`, and `renderer.controls` (undefined unless enabled at construction, and after disposal).

## Where to continue

Steps 1–4 of the original plan are **done** (dev env, tsup migration, import-time side effects, the browser/Node seam). The workspace migration and its verification status are recorded in [ROADMAP.md](./ROADMAP.md). It does not complete any renderer or feature-parity work. The remaining order is:

1. **Asset pipeline correctness** — renderer fixes and ordered source selection are implemented. Image decoding reuses fetched bytes and retries failures. Lists and model dictionaries can recover from failed loads, and persistent loads skip nullish writes. Request concurrency, retries, and shutdown are bounded. Continue with source error reporting, asset-version selection, and animated-texture frame math.
2. **Model/blockstate bug batch** — `Axis.X = "X"` silently disables every x-axis element rotation; the missing `await` on `BlockStates.getDefaultState`.
3. **Finish skins** (slim UVs, capes) and entity child-part recursion.
4. **Instance lifecycle overhaul** (slot reclamation, grow) then the world redesign for large-scale renders.
5. **Headless Node rendering** — the seam and `shutdown()` are in place; what's missing is a GL context (`headless-gl`) and an image encode path, per the MineRenderServer spec.
