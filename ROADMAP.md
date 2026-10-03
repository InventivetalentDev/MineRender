# MineRender V2 — Status, Parity & Continuation Plan

The library's build, packaging, and browser/Node boundary are complete as of `typescript` commit `2d17ebe`. Renderer lifecycle fixes are implemented on `fix/renderer-lifecycle`; built-in controls and color handling remain next. The monorepo migration organizes the existing library and consumers; it does not complete any rendering features.

Library paths in this document (`src/`, `test/`, `dist/`, and build configuration) are relative to `packages/minerender/`. Root `res/` contains offline asset tools and reference data. See [AGENTS.md](./AGENTS.md) for commands and architecture.

## Monorepo migration — 2026-10-03

The migration uses `refactor/v2-monorepo`, based on V2 `typescript`, in the worktree `.worktrees/v2-monorepo`. The private Yarn 4 root contains one public package, `packages/minerender/`, plus `apps/web/`, `examples/vite/`, and `examples/script-tag/`. The library's npm exports, `dist/bundle.js`, and public API remain the compatibility contract.

The companion imports are source snapshots. Their Git history remains in the original repositories; no repository transfer, archive, merge, publication, or domain change is part of this milestone. Source revisions are recorded below.

V2 development returned to `InventivetalentDev/MineRender` on 2026-10-03. Its `typescript` branch was fast-forwarded from `bff759b` to the V2 base `2d17ebe`, preserving history. The monorepo branch is stacked above it in [PR #159](https://github.com/InventivetalentDev/MineRender/pull/159). V1 `master`, tags, and delivery URLs are unchanged; the superseded PR in `MineRender/MineRender` is closed.

| Source repository | Branch and commit | Destination or purpose |
|---|---|---|
| `MineRender/MineRender` | `typescript` · `2d17ebe39d796dd467b20142252a373a18a769fc` | Library moved to `packages/minerender/`; repository history retained. |
| `InventivetalentDev/MineRenderWeb` | `master` · `01ff6efdb2d83549b4ac93f05ae9acc68ac96fee` | Snapshot imported into `apps/web/`. |
| `MineRender/example-vite` | `master` · `1c2fc275d8b3dc9f6c8beb0bcf7d5538975b577d` | Snapshot imported into `examples/vite/`. |
| `MineRender/example-bundle` | `master` · `411044c1edf241bff8b919296a72183e53fcf709` | Snapshot imported into `examples/script-tag/`. |
| `InventivetalentDev/MineRender` | `master` · `5e1ffa3cd8d46334d37e68b2021a9064f32f9202` | V1 reference only; local checkout named `MineRenderV1`. |
| `InventivetalentDev/MineRenderServer` | `master` · `f54d8169f15f84e9aeed2099af727e921fa1fc0b` | Server contract reference only; not imported. |

### Branch audit

All 61 remote branches across these six repositories were inventoried; remote heads matched the locally cached refs on 2026-10-03. No additional feature implementation needs importing for the workspace migration.

- V1 `typescript` (`bff759b`) is a direct ancestor of the V2 migration base, 75 commits behind. V2 `typescript-assetsource` (`72e73b2`) and `typescript-zipsource` (`5a76649`) are also ancestors, 52 and 42 commits behind. The V2 `master` branch is a stripped placeholder after V1 history.
- V1 `capesdev-support` (`ef35054`) and `prefix` (`6539928`) have distinct commit IDs but their work was squash-merged into V1 `master` as `05d31cf` (#72) and `f2a1c89` (#158). V1 `image-cache`, `model_merge`, `skin-textures-fix`, `web_workers`, and `gh-file-sync` are ancestors. Do not merge these branches again.
- Vite `zipsource` equals `master`. The bundle example has only `master`. Web's extra branch, `renovate/configure`, adds only Renovate configuration.
- V2 `test` (`e97a54a`) is an unmerged Jest/Babel experiment with console-only tests and removed memoization. Retain the existing AVA setup. Other unmerged V1 and server branches contain dependency updates, not missing runtime features.

### Preserve V1 delivery URLs

Keep V1 branches, tags, and generated bundles at their existing paths. The skin and model embeds load `https://cdn.jsdelivr.net/gh/InventivetalentDev/MineRender@master/dist/skin.min.js` and `.../dist/model.min.js` directly; homepage examples also use version tags. Moving these files into a `legacy/` directory would break those URLs. Preserve all ten `dist/{all,entity,gui,model,skin}{,.min}.js` files on the V1 refs.

A future website migration must preserve `minerender.org/embed/{skin,model}/`, `/demo/`, `/dist/`, `/res/models/entities/`, `/res/idsToNames.json`, `/CORSpipe.php`, `/nameToUuid.php`, and the deep links and assets at `docs.minerender.org`. The V1 root and `docs/CNAME`, plus the V2 root `CNAME`, all specify `docs.minerender.org`; the actual hosting configuration remains unresolved. Verify it before changing deployment or domains. This milestone leaves the generated root `docs/` and V1 website files in place.

### Verification

The macOS baseline at `2d17ebe`, using Node 26.10.0, passed library typechecking, all three existing AVA tests, and tsup browser/Node/IIFE builds with declarations. The earlier Windows/WSL native-module failure is historical.

The migration passed these checks on macOS with Node 26.10.0 and Yarn 4.5.3:

- `yarn install --immutable`, root `yarn build`, `yarn typecheck`, and all three existing AVA tests pass. Builds cover the library's browser/Node/IIFE outputs and declarations, all eight web pages, the Vue/Vite example, and the script-tag example. CI now runs these commands on Node 22 and 24; the remote jobs have not run yet.
- All 149 library source and test files are unchanged apart from their paths. The packed library preserves the baseline's 17 file paths, package version, entry points, and conditional exports. Browser CJS/ESM, Node CJS/ESM, and IIFE import checks preserve their export names. Browser output contains no Node-only imports. The alpha-version command was checked in a temporary workspace; no release was published.
- Isolated Playwright checks show textured models and skins in both examples, a textured stone block in the web demo, a skin supplied through the URL input, and completed placement of the end-city ship structure. OrbitControls respond to dragging. The four web demos and both examples load without uncaught JavaScript errors or failed local requests. The four manual stress/custom-model pages were built but not visually validated.
- Native Node imports remain blocked by the missing `canvas.node` binary, as they were before the move. Node import checks used a temporary canvas stub; real persistent-cache round trips and `shutdown()` pass. This does not verify native canvas or headless rendering. The web skin demo's default `inventivetalent` lookup returns no UUID, and the entity demo's guessed pig texture path returns 404. The custom-model page still depends on its external Blockbench host. These are runtime or service follow-ups, not completed features.

The approved demo asset configuration uses `https://assets.mcasset.cloud/1.17.1`, including directory-list requests and the existing fallback repository. This endpoint passed browser CORS checks; the library's default root is unchanged. Consumer adaptations also use the current NBT asset API, the library's exported OrbitControls, and a Vite polyfill resolution fix. The release command now uses Yarn workspace versioning and publishing; Git release commits and tags remain separate maintainer actions.

## Feature-parity matrix (V1 → V2)

| Feature | V1 | V2 today | Priority |
|---|---|---|---|
| Build & dev environment | webpack 4 per-feature IIFE bundles | Yarn 4, tsup, and the library baseline pass on macOS; workspace verification recorded above | complete baseline |
| Packaging / npm hygiene | script-tag CDN | Conditional browser/Node/types exports and `files` whitelist; one public workspace | complete baseline |
| Clean import (no side effects) | window globals, telemetry beacon | Benchmark removed; ticker, image creation, and persistent caches are lazy; call `shutdown()` to stop dependency timers | complete baseline |
| Browser/Node dual-target | browser-only by design | Separate entries register browser/Node `EnvProvider` implementations; native canvas is optional for browser consumers | complete baseline |
| Renderer core | continuous loop, SSAA, fps limit, dispose() | Dirty-flag loop, safe start/stop, owned-resource disposal, and resize invalidation; fpsLimit dead, composer default-on with known brightness defect | high |
| Camera controls | built-in OrbitControls via `options.controls` | Vendored twice, integrated nowhere; consumers must wire it + `registerEventDispatcher` manually | high |
| Skins — classic 64×64 | full, named toggleable parts | Works (named groups/meshes, overlay toggling) — missing variant auto-detect, `makeNonTransparentOpaque` | medium |
| Skins — slim + legacy 64×32 | auto-detected, dedicated UVs | Half-done: slim geometry ✔, slim UVs = copy of classic (`SkinTextureCoordinates.ts:690`), no 64×32, no auto-detect | high |
| Capes (vanilla/OptiFine/LabyMod) | full, 3 layouts, capes.dev | Not rendered at all (resolvers exist in `Skins.ts`, no meshes) | medium |
| Block/item model rendering | full incl. tint, display transforms | Works for common blocks; x-axis rotations no-op (`Axis.X` casing), texPosition crash, parent-merge concatenates `elements`, no tint/uvlock/display/builtin-entity | high |
| Blockstate resolution | variants + weighted random + multipart AND/OR | Missing `await` defeats default states (`BlockObject.ts:47`), no AND, no weighted pick, 150ms-setTimeout rotation hack | high |
| Animated textures | frametime honored | Ticks too fast (per-frame not per-50ms-tick), frame-math bugs in `WrappedImage`, no interpolation | medium |
| Entity rendering | 76 hosted models, mirror, inheritance | Richer data (107+19 ModelPart dumps) but children never recursed, mirror TODO, texture paths guessed, box-UV math unverified | high |
| GUI / inventory / recipes | full GuiRender + Positions + recipe() | `GuiObject` is an empty stub | high |
| Structure (.nbt) loading | works via ModelConverter | Parses correctly; placement serialized, debug wireframes hardcoded on, no entities/DataVersion | high |
| Legacy .schematic | full incl. AddBlocks nibbles | `SchematicParser` returns `{}`; mapping data (`res/idsToNames.json`, `legacyBlockList.json`) present but unreferenced | medium |
| Combined multi-renderer scene | CombinedRender wrapper | Superseded by design (one scene hosts all types) — **at parity** | — |
| Screenshots & 3D export | toImage(trim,mime), toObj/toGLTF/toPLY | Bare `toDataURL()`; no exporters | medium |
| Asset loading & resource packs | swappable assetRoot, fallback | More ambitious (sources, caches, zips) but: all-sources-parallel + deep-merge (double fetches, binary corruption risk), every texture downloaded twice, errors swallowed, pinned to 1.17.1 with no version API, zips browser-only | high |
| Per-frame animation API | `<type>Render` CustomEvents | No supported hook (dirty-flag loop only) | medium |
| Embeds & website | minerender.org + iframe embeds | Existing demos and examples imported into workspaces; a complete V2 website and embeds remain to build | low |
| **Large-scale worlds (V2 goal)** | n/a | Prototype, effectively dead code: 64³ box, `getChunkAt` broken (Map indexed with number), object-per-block, no meshing/culling/lighting/LOD, instance slots never freed | high |
| **Anvil .mca / world formats (V2 goal)** | n/a | Zero code | high |
| **Node headless rendering (V2 goal)** | faked externally by MineRenderServer | No DOM-free Renderer construction, no render-to-buffer API | high |
| Bedrock geometry (V2 ambition) | n/a | Type declarations only | low |
| Instancing architecture | merged Geometry + instanced-mesh fork | Cleaner concept; fixed capacity w/ silent overflow, whole-object transforms move ALL instances, `children[0]` assumption, no slot reclamation, shader material breaks under instancing | high |

## Continuation plan (ordered)

### 1-4. Build, packaging, side effects, browser/Node seam — **DONE** (2026-08-12)

**Dev environment.** `node_modules` reinstalled from WSL (linux-x64 natives), `yarn.lock` regenerated for the three→peerDependencies move, npm `package-lock.json` and `yarn-error.log` removed, `.gitignore` updated for yarn 4, `.gitattributes` added (`eol=lf`) so the Windows/WSL split stops rewriting every file. `canvas` moved to `optionalDependencies` — it has no prebuilt binary for current Node and a source build needs cairo/pango/pixman, so a browser-only install must not be blocked by it. TypeScript 4.1 → 5.6 (tsup's `dts` needs ≥4.5), typedoc 0.25 → 0.26 to match.

**Build.** `build.mjs`, `tsconfig-cjs.json` and the `compile*` scripts are gone; tsup is the library build tool, with three passes (browser / node / iife) described in AGENTS.md. `dist/bundle.js` keeps its path. Packaging fixed: conditional `exports` (browser/node × import/require × types), `files` whitelist (tarball: 17 files, was the entire V1 website), `prepublishOnly`, correct `types`. `splitting` off. ava now runs the TS sources through esbuild-runner. `scripts/make-exports.sh` rewritten bottom-up — no more duplicated barrel lines — and it now excludes `src/env/` and the entries. Dead deps pruned: assert, browser-or-node, colors, onscreen, pako, process, stream-http, supports-color, threejs-examples, url, util, @ava/typescript, glob, event-stream, progress-stream, @mapbox/node-pre-gyp, @types/md5.

**Import-time side effects.** Benchmark IIFE deleted; `Ticker` starts lazily, unrefs, and `remove(0)`/`dispose()` fixed; `Materials.MISSING_TEXTURE` and the three `PERSISTENT_CACHE` fields are lazy getters (they used to decode an image / open IndexedDB at import); stray `constants`, `fs` and `node-persist` imports removed. Remaining: `loading-cache` and `jobqu` never `unref()` their self-rescheduling timers, so `shutdown()` (`src/shutdown.ts`) exists to end them — fixing that upstream would let it be optional.

**The seam.** `src/Env.ts` now defines `EnvProvider` (`createCanvas`, `createImage`, `imageSize`, `openCache`) with `src/env/browser/` and `src/env/node/` implementations, selected by the entry (`src/index.browser.ts` / `src/index.node.ts`). `image-size` can't run in a browser (top-level `fs`), so the browser provider ships a small PNG/GIF/JPEG header probe instead. `NodeCache` now calls node-persist's required `init()` (lazily) — the Node cache path had never actually worked. `ts-deepmerge` is inlined to dodge a CJS/ESM interop break, and the `crypto-js/core` deep import was dropped as unresolvable under Node ESM.

Verified in August 2026: `tsc --noEmit` clean; all three targets build; browser output contains **zero** Node-module references (only a dynamic `import("prismarine-nbt")` remains, and only structure loading triggers it); CJS+ESM browser builds and the Node build (canvas stubbed — no native binary was available in that environment) all load, register the right provider, round-trip the persistent cache, and exit cleanly after `shutdown()`.

**Follow-ups:** consumer build and delivery-format verification is tracked in the monorepo milestone above; `unref()` upstream in loading-cache and jobqu; `@types/three` is still 33 minors behind; `src/lib/OrbitControls.js`, `src/_model/`, root `three/`, `mccolor.js` still un-deleted; console.log sweep still pending.

### 5. Renderer core fixes + built-in OrbitControls — high

**Lifecycle batch implemented — 2026-10-03, `fix/renderer-lifecycle`.** `start()` now calls `this.stop()` instead of the browser's `window.stop()`. `dispose()` stops animation, removes owned listeners and DOM, detaches scene objects, disposes debug helpers and rendering resources, and releases the owned GL context. Disposal is final and idempotent; cleanup continues if a scene removal or resource disposal callback throws, then rethrows the first error. Shared scene assets, caller-owned controls, global caches, and the shared Ticker are retained. Resizing marks the renderer dirty. Scene add/remove operations pair change listeners with direct-child membership, so duplicate adds, reparenting, removal, and re-addition keep object counts consistent. Instance allocation and `instanceCount` semantics are unchanged.

**Verified:** all workspace builds, typechecks, and the three existing AVA tests pass. Temporary regression checks pass 12 scene cases (66 assertions) and 27 isolated-browser lifecycle assertions, including stop/resume, resize, repeat disposal, cleanup errors, and pixel-identical rendering by a second composer sharing assets. The unchanged baseline fails both the multi-add count and `window.stop()` regression checks. The built Vite, script-tag, and web block consumers render, respond to OrbitControls, and remove their renderer canvas/stats on disposal without uncaught browser errors. Browser CJS/ESM imports and `shutdown()` pass. Temporary regression scripts remain outside the repository; the native canvas limitation recorded above is unchanged.

**Remaining:** restore or delete `fpsLimit`. Resolve the composer brightness defect or default `composer.enabled` to false. Integrate vendored OrbitControls behind `options.controls` with automatic `registerEventDispatcher` (MineRenderWeb's TODO asks for exactly this). Bump `@types/three` to ~0.158, migrate `outputEncoding` → `outputColorSpace`, and rewrite `three/src/*` deep imports to bare `three`.

### 6. Asset pipeline correctness & performance — high
Sequential-priority source resolution with early return (replace Promise.all + unconditional deep-merge, which double-fetches everything and can corrupt binary assets). `PersistentCache`: stop persisting `undefined` (`NodeCache` already initializes node-persist lazily). Raise request concurrency (currently 1 req/10ms globally), add retry to the CDN queue, stop mutating global axios defaults. Decode images from the already-fetched Buffer (every texture is currently downloaded twice). Stop caching fake 0×0 images on error — surface errors. Replace `@Memoize` on async statics with failure-evicting caches. Add an asset-version selection API (root is hardcoded to 1.17.1). Fix `WrappedImage` frame math.

### 7. Model/blockstate correctness bug batch — high
Small, high-impact: (1) `Axis.X = "X"` → lowercase (x-rotations silently no-op); (2) missing `await` on `BlockStates.getDefaultState` (`BlockObject.ts:47`); (3) texPosition-undefined crash (`UVMapper.ts:426`); (4) ModelMerger: child `elements` must override, not concat; (5) replace the 150ms setTimeout rotation hack with awaited init ordering; (6) multipart AND + `apply` arrays + weighted variants; (7) `AssetKey.parse` extension fallback + broken `isAssetKey`. Then tintindex, uvlock, display transforms. Grow the test suite around these (ModelMerger, `mapStateToVariant`).

### 8. Finish skins: slim, cape, legacy — high
Preferred route: migrate `SkinObject` onto the ModelPart pipeline using the completely unused `src/skin/playerModels.json` (correct default+slim trees already there), unifying with `EntityObject` — slim UVs come for free and the hand-written slim stub retires. Add cape meshes (vanilla layout first; OptiFine/LabyMod layouts portable from V1 `texturePositions.js:896-1047`) wired to the existing `Skins.ts` resolvers. Add 64×32 legacy layout + slim/legacy auto-detection (port V1's pixel-scan, V1 `src/skin/index.js:129-158`). Dispose replaced geometries/materials on `setSlim` rebuilds.

### 9. Entity rendering completion — high
Recurse `ModelPart.children` (most multi-part entities currently render incomplete). Implement `mirror`. Verify the five TODO face-UV methods in `MinecraftCubeTexture.ts` and the possibly-doubled pivot translation. Replace guessed `textures/entity/<name>.png` with a proper mapping (subdirs/variants). In `res/tools`, remap intermediary names (`field_20813`) in blockEntityModels and regenerate the hosted JSON.

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
Port toObj/toGLTF and toImage trim/mime. Add a per-frame callback + `autoRotate` convenience integrated with the dirty flag (replaces V1's CustomEvent contract). Fix `SceneInspector` raycast normalization (against canvas rect, not window) and `SceneStatsDisplay`'s leaked interval. Fix animated-texture tick rate + full mcmeta support. Finish consumer behavior and presentation in `apps/web/` and `examples/vite/`, including the Vite renderer leak on recreate. Workspace wiring belongs to the migration milestone above. Grow the test suite beyond AssetKey and document the consumer API contract (see AGENTS.md) as the beta compatibility baseline.
