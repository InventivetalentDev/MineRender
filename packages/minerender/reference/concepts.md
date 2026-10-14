# Core concepts

MineRender's APIs use different units for scene geometry, world blocks, GUI layers, and frame timing. Rendering also depends on initialization, dirty notifications, and resource ownership.

## Units and coordinates

Use the units expected by the API you call:

| Context | Units and direction |
| --- | --- |
| Scene geometry and positions | One Minecraft block spans 16 scene units. |
| World block positions | Integer block coordinates, including negative coordinates. A cubic chunk contains 16 × 16 × 16 blocks. |
| GUI layer positions | Pixels measured from the top-left. One GUI pixel is one scene unit; positive GUI y becomes negative scene y. |
| three.js rotations and part poses | Radians. Source model formats may use different units before MineRender converts them. |
| `Renderer.onFrame` | `time` and `delta` are seconds. `time` is the animation-loop timestamp, not time since subscription. |

[MineRenderWorld](/api/index/classes/MineRenderWorld) provides `worldToScenePosition` and `sceneToWorldPosition`. The latter divides by 16 without rounding; world block lookups and setters still require integer coordinates.

For GUI camera fitting, use [GuiObject](/api/index/classes/GuiObject)'s `bounds`. It includes item-model overhang as well as layer rectangles, in GUI coordinates.

`render.pixelRatio` sets drawing-buffer pixels per CSS pixel, with a default of `1`. It changes image-export resolution; layout and inspector picking use CSS pixels.

## Await initialization

The `addModel`, `addBlock`, `addSkin`, `addEntity`, and `addGui` methods on [MineRenderScene](/api/index/classes/MineRenderScene) return promises. Await them before changing the returned object's parts or capturing an image. These methods wait for object initialization, including the required asset work.

Texture changes can also be asynchronous. Await `SkinObject.setSkinTexture` before relying on skin dimensions or model detection, and await `setCapeTexture` before capturing the cape.

World edits such as `setBlockAt`, `placeMultiBlock`, and `clear` also return promises. Await them before reading the resulting rendered state. Bulk placement resolves each distinct block state once, yields to the event loop every few milliseconds, and refreshes neighbor culling once at the end; pass a `BatchedExecutor` to keep per-position batches instead. A failed bulk placement can leave successfully placed blocks in the world; it is not a transaction that rolls back earlier placements.

With `sectionMeshing: true`, changed sections rebuild after the placement promise resolves. The browser build prepares section geometry in a Web Worker when the bundle keeps `section.worker` beside the module; otherwise it builds synchronously. See [Browser and Node.js](./platforms.md#capability-boundaries).

## Versioned registry data

`AssetLoader.setVersion(version)` selects both vanilla assets and the registry data used for item defaults, potion colors, block properties, preview tints, fluids, dyes, legacy numeric mappings, and renamed IDs. These datasets load from `assets.mcasset.cloud/<version>/minerender-data/` when needed.

When the exact dataset version is missing, MineRender selects the nearest published patch in the same release line, preferring the older patch on a tie. Otherwise it uses the latest earlier published release. Releases older than the published data use the oldest available release; an unpublished snapshot rejects. Models and textures retain the requested asset version. A missing dataset or failed request rejects rather than returning an empty registry.

`BlockStates.get`, item keys in `Models.getMerged`, and saved world entities replace older IDs through the optional `renames` dataset. An ID the selected version still registers keeps its meaning, and stored world data keeps the input's ID. Published data without this dataset applies no renames and does not reject. `Renames.resolve(kind, id, dataVersion?, root?)` returns the replacement directly and accepts the input's DataVersion when the caller knows it.

Inspect the selected registry version with `resolve`:

```ts
AssetLoader.setVersion("1.21.6");
const data = await MineRenderData.resolve();
console.log(data.requestedVersion, data.version);
const defaults = await ItemDefaults.get("minecraft:diamond_sword");
```

Pass an explicit asset root as the second argument to `MineRenderData.get(dataset, root)` or `ItemDefaults.get(itemId, root)` when loading another version or a mirror. `SchematicParser`, `AnvilParser`, and `AnvilWorldSource` accept `root` in their options to select the target registry for numeric block mappings; the file's DataVersion does not choose or migrate that target.

The former synchronous data lookups now return promises: `ItemDefaults.get`, `ItemTints.getPotionList`, `getBlockFluidState`, `getFluidKind`, and `resolveLegacyBlock`. For repeated synchronous calculations, load `fluids` or `legacyBlocks` once with `MineRenderData.get` and pass the table to `resolveBlockFluidState` or `resolveLegacyBlockState`. Rendering and parser entry points await their data automatically. `BannerPatterns.getColors(root?)` provides versioned texture dyes; `DYE_COLORS` and `BannerPatterns.getColor` retain the fixed 1.21.11 palette for compatibility and are deprecated.

## Redrawing after changes

[Renderer](/api/index/classes/Renderer) draws only when the scene is dirty, `render.renderAlways` is enabled, an `onFrame` subscription is active, or a video is recording. Calling `start()` runs this loop; it does not force an unchanged scene to redraw continuously.

MineRender setters such as `setPosition` notify the scene. When you change a three.js property directly, such as a named part's `rotation` or `visible`, call the owning [SceneObject](/api/index/classes/SceneObject)'s `notifyDirty()` or set `renderer.scene.dirty = true`. The loop draws the change on its next eligible frame.

Built-in controls created with `controls.enabled` handle redraw notifications. `controls.mode` selects `orbit` (OrbitControls, the default) or `fly`, creative-style flight with WASD, space/shift, R to sprint, mouse look through pointer lock or dragging, the wheel to change speed, and a touch joystick on the left half of the canvas. `renderer.orbitControls` and `renderer.flyControls` return the active one, and `renderer.setControlsMode(...)` switches at runtime while keeping the camera in place; the switch creates a new controls object, so add listeners and settings again. `renderer.controls` is typed as either class; read OrbitControls members such as `target` from `renderer.orbitControls`. Register controls you create yourself with `renderer.registerEventDispatcher(...)` so their change events mark the renderer dirty.

For continuous animation, use `renderer.onFrame(...)`. Its synchronous callback runs before each draw and keeps rendering active. `render.fpsLimit` caps these draws; its default is `60`, and a nonpositive value disables the cap. The first callback after subscribing or restarting receives `delta: 0`. Call the returned unsubscribe function when the animation ends.

`renderer.toImage()` renders a fresh frame even while stopped. It does not call `onFrame` callbacks, so update the pose first when exporting a specific animation frame.

## Video export

Call `renderer.toVideo({ duration: 5, fps: 30 })` to record five seconds of the current scene, including running animations and camera movements. It returns a silent video `Blob`. The browser selects a supported WebM or MP4 encoder; use `blob.type` to choose the file extension. Set `mimeType` to request a specific supported format, or `videoBitsPerSecond` to request an encoding bitrate.

Recording runs in real time. Keep the tab visible; browser scheduling and `render.fpsLimit` can reduce the frame rate or affect duration. The video keeps the canvas's initial drawing-buffer dimensions, scales later resizes to fit, and fills transparent pixels with black. It does not trim frames or rewind animations.

Only one video can record per renderer. A stopped renderer starts for the recording and stops again afterward. Pass an `AbortSignal` as `signal` to cancel. Calling `stop()` or disposing the renderer also cancels the recording and rejects its promise. Calling `start()` while the renderer is running leaves the recording active.

## Item state

`Models.getMerged(key, context)` evaluates an item definition with the supplied [ItemModelContext](/api/index/interfaces/ItemModelContext): data `components`, item-model `properties`, a stack `count`, a `displayContext`, and `itemReferences` for nodes such as `minecraft:bundle/selected_item`. The same state selects models, special renderers, and automatic tints.

```ts
const key = new AssetKey("minecraft", "leather_chestplate", "models", "item");
const model = await Models.getMerged(key, { components: { "minecraft:dyed_color": 0x3f76e4 } });
await scene.addGui([{ item: "minecraft:item/shield", context: { components: {
    "minecraft:base_color": "blue",
    "minecraft:banner_patterns": [{ pattern: "minecraft:stripe_center", color: "white" }]
} } }]);
```

Bundled vanilla 1.21.11 stack-size, durability, and glint defaults apply unless overridden by supplied components. Supply any other components a selector reads. GUI item layers and scene-document item definitions take the same `context`; documents name item references by item ID. Explicit `tints` still override automatic colors. See the [AGENTS.md item notes](https://github.com/InventivetalentDev/MineRender/blob/main/AGENTS.md#gotchas) for the supported components and renderers.

## Objects and instance references

With model instancing enabled, scene methods can return an [InstanceReference](/api/index/classes/InstanceReference) instead of a separate model object. Use the reference's transform methods to change that placement. Changing the underlying shared object's transform can affect its other instances.

Calling `removeFromScene()` or `dispose()` on an instance reference releases its slot. A released reference rejects transform access; create another placement to obtain a usable reference.

With `sectionMeshing: true`, [MineRenderWorld](/api/index/classes/MineRenderWorld) merges eligible blocks into section meshes. A merged block has no individual `BlockInfo.object`. Edit it through the world or chunk setters so geometry and neighbor culling update together.

Model elements with `shade: false` skip directional face shading in separate, merged, and instanced models, including world section meshes. Tints, saved world light, and ambient occlusion still apply. Omitted or `true` values retain directional shading; GUI items with `gui_light: "front"` disable it for the whole model.

World placement selects weighted block models from absolute block coordinates, so unloading and reloading preserves their appearance in both rendering modes. Standalone `scene.addBlock` previews remain random unless you supply `variantPosition: [x, y, z]` in block units. The position is copied at construction; moving the object does not change its selection. The pick is vanilla-identical for the same coordinates and ordered weights. Position-based selection rejects total weights above 2,147,483,647.

## Inspecting world blocks

Pass a three.js `Raycaster` to `world.raycast` to find the nearest visible block in that world. It works with individual instances and merged sections, including fluid surfaces and block entities. It does not load chunks or select unrelated objects in the same scene.

```ts
import { Raycaster, Vector2 } from "three";

const rect = renderer.renderer.domElement.getBoundingClientRect();
const pointer = new Vector2(
    (event.clientX - rect.left) / rect.width * 2 - 1,
    1 - (event.clientY - rect.top) / rect.height * 2
);
renderer.camera.updateWorldMatrix(true, false);
const raycaster = new Raycaster();
raycaster.setFromCamera(pointer, renderer.camera);
const hit = world.raycast(raycaster);
if (hit) console.log(hit.position, hit.block.type, hit.block.properties);
```

`hit.position` contains integer block coordinates, and `hit.block` is a detached data snapshot. `hit.point` and `hit.distance` use scene units; `hit.normal` is the triangle's unit normal in world space. The raycaster's distance range and layers apply. Picking tests geometry, including transparent texture pixels, and returns `undefined` when no block is hit. Await world edits before picking their resulting geometry.

## Saved entities

Enable `renderEntities` to render supported mobs from parsed structures or Anvil entity records:

```ts
const world = new MineRenderWorld(renderer.scene, { renderEntities: true });
await world.placeMultiBlock(structure);
```

The option defaults to `false`. With `renderEntities`, supported mobs render at their saved position and yaw; sheep wool colour and shearing and fox, axolotl and parrot variants apply; other appearance state is ignored. Unsupported entities retain their NBT without creating a render object.

The world owns these entity objects. Replacing or unloading a chunk column disposes its entities, including structure entities positioned within that column. `await world.clear()` removes all of them.

Use `world.raycastEntities(raycaster)` to inspect the nearest visible rendered mob. The hit includes its canonical `type` (such as `minecraft:pig`), a copy of its saved fractional `position` in block units, and its live `object`. The `point`, `normal`, and `distance` fields use the same units as block hits. Hidden or detached entities and objects owned by another world are excluded. Picking respects the raycaster's layers and distance range and tests geometry, including transparent texture pixels.

Compare the block and entity hit distances to select whichever is in front:

```ts
const block = world.raycast(raycaster);
const entity = world.raycastEntities(raycaster);
const hit = entity && (!block || entity.distance < block.distance) ? entity : block;
```

Without `renderEntities`, or when no rendered mob is hit, `raycastEntities` returns `undefined`.

## Streaming a Java world

Use a dedicated `MineRenderWorld` with `sectionMeshing: true` and a `WorldStreamer` to render nearby chunk columns. This example reads one dimension's terrain and entity regions at region coordinates:

```ts
const readRegion = (directory: "region" | "entities") => async (x: number, z: number, signal?: AbortSignal) => {
    const response = await fetch(`/world/${directory}/r.${x}.${z}.mca`, { signal });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Region request failed: ${response.status}`);
    return response.arrayBuffer();
};
const source = new AnvilWorldSource(readRegion("region"), {
    readEntityRegion: readRegion("entities"),
    readExternalChunk: async (x, z, signal) => {
        const response = await fetch(`/world/region/c.${x}.${z}.mcc`, { signal });
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error(`External chunk request failed: ${response.status}`);
        return response.arrayBuffer();
    }
});
const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true, renderEntities: true });
const stream = new WorldStreamer(world, source, { loadRadius: 1, unloadRadius: 2 });
await stream.updatePosition(renderer.camera.position);
```

`readEntityRegion` is optional. Terrain and entity regions share the configured cache limits. A stored entity chunk replaces embedded entity records, including when its list is empty; a missing entity chunk preserves them. Entity-only columns have an empty `sections` array. The resulting chunk keeps the entity file's `DataVersion` in `entityDataVersion`, separate from terrain `dataVersion`.

For direct decoding, call `AnvilParser.parseEntityChunk(bytes, localX, localZ)`. It returns absolute chunk coordinates, `dataVersion`, and typed entity NBT, or `undefined` when the region has no entry there.

Call `updatePosition` after the camera or view center moves. It accepts scene units; `update(x, z)` accepts absolute chunk coordinates.

The streamer aborts obsolete reads and active reads during disposal. Source callbacks must forward the optional signal to cancellable I/O to stop that work.

`readExternalChunk` handles oversized chunks stored beside their region file. Its coordinates are absolute chunk coordinates, and it reads from the same dimension as the region reader. The source caches region files within its configured limits; external payloads are read on demand without retaining them. A missing external file is a chunk error and can be retried.

Source errors appear in `failedChunks` while other columns continue loading. Call `await stream.retryFailedChunks()` to retry them. Placement or unloading failures reject the update.

Await `stream.dispose()` before editing or clearing the world; it unloads its columns and leaves the world and source caller-owned.

Numeric and paletted Java chunks support gzip, zlib, LZ4, and uncompressed payloads, including external `.mcc` files. Pre-1.13 numeric chunks use the same block mappings as legacy schematics. Pass `legacyMappings: { "id:metadata": "namespace:block[property=value]" }` to `AnvilParser.parse`, `AnvilParser.parseChunk`, or `AnvilWorldSource` to override those mappings. Set `lenient: true` to try metadata 0 for unmapped numeric states and skip unknown IDs; malformed arrays still fail validation.

Numeric mappings do not reconstruct states that depend on neighbors or block-entity NBT, such as paired doors or bed colors. DataVersion migration remains unsupported.

Modern Anvil sections retain their biome palettes as 64 IDs in `section.biomes`, ordered by `x + z * 4 + y * 16`. Each sample covers 4×4×4 blocks. `placeChunk` copies these samples, including in air-only sections. Call `world.getBiomeAt(x, y, z)` with integer world block coordinates to read the saved ID, or `undefined` when biome data is absent. Block edits preserve samples; replacing or unloading the column removes its previous biome data.

World blocks use these samples for grass, foliage, dry foliage, and water colors in both rendering modes, including multiple water colors within a merged section. Biome definitions come from the selected version's `data/<namespace>/worldgen/biome/` directory, with colors sampled from resource-pack colormaps or explicit biome effects. Grass colors include dark forest and swamp modifiers; swamp colors use world block coordinates. Waterlogged blocks keep separate model and water colors. Missing biome data or definitions retain preview colors; source errors reject placement. Older numeric `Biomes` arrays and world-seed-based biome sampling remain unsupported.

Await `chunk.setBiomes(samples)` to replace a section's samples and refresh its placed blocks, including tall-plant halves in the section above. Hidden blocks remain hidden. For standalone previews, pass `biome` and optional `biomePosition: [x, y, z]` to `scene.addBlock`; explicit `tints` still take precedence.

Set `biomeBlendRadius` together with `sectionMeshing` to an integer from `0` to `7` to smooth grass, foliage, dry-foliage, and water colors across biome borders. The radius is in blocks; `0` disables blending and is the default. Read it through `world.biomeBlendRadius`, or update loaded terrain without reloading the source:

```ts
const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true, biomeBlendRadius: 3 });
await world.placeChunk(chunk);
await world.setBiomeBlendRadius(0);
```

Blending averages colors over a horizontal square at the sampled block's height. It applies to section meshes; blocks that keep individual objects, such as block entities, keep unblended colors. It leaves `getBiomeAt` unchanged, honors explicit tints, and works with saved lighting and ambient occlusion. Missing neighbors, and neighbors whose biome fails to load, are excluded; a missing center biome or definition retains preview colors. Biome edits and column loading or unloading refresh only the neighboring cells whose color changes. Colors are cached and updated with terrain, with no per-frame averaging. Larger radii add update work.

Enable `savedLighting` together with `sectionMeshing` to shade blocks and fluids from imported light data:

```ts
const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true, savedLighting: true });
await world.placeChunk(chunk);
const light = world.getLightAt(x, y, z); // { block, sky }, each from 0 to 15, or undefined
```

Anvil sections retain packed `BlockLight` and `SkyLight` arrays in `section.light`, including light-only sections. Each channel has 2,048 bytes: the cell index is `x + 16*z + 256*y`, with the even cell in the low nibble. An omitted channel in a saved section is zero, and an absent section has unknown light. Above a column's highest saved sky-light array, sky light is 15, as in vanilla; a column without any sky-light array has none. `placeChunk` copies the arrays, and column replacement, unloading, or clearing removes them. `getLightAt` returns stored values even when the save marks them invalid. `savedLighting` without `sectionMeshing` throws.

Rendering uses the brighter of sky and block light with a neutral daylight brightness curve, multiplied by the existing face shading and biome colors. `ambientLight`, from 0 to 1 and 0 by default, sets a minimum brightness the way a dimension type's `ambient_light` does. Vanilla uses 0.1 for the Nether and 0.25 for the End. Boundary faces sample the adjacent cell; inset faces sample their own cell. Water and lava use the brighter of their cell and the cell above, or below for bottom faces. Loading or unloading adjacent columns refreshes these samples.

`savedLighting` defaults to `false`. When enabled, missing sections and lighting marked invalid by the save retain preview brightness. Modern saves without a lighting-validity flag count as invalid. Block edits and visibility changes preserve the saved samples without recalculating light. Light propagation, entity and block-entity lighting, and dimension-, weather-, or time-dependent lightmap colors are not applied.

Enable `ambientOcclusion` to darken block corners near opaque full-cube neighbors. It requires `sectionMeshing` and works with or without saved lighting:

```ts
const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true, ambientOcclusion: true });
await world.placeChunk(chunk);
await world.setAmbientOcclusion(false); // Rebuilds loaded terrain without reloading the source.
```

Ambient occlusion defaults to `false`; `world.ambientOcclusion` reports the setting. It shades axis-aligned faces on block boundaries and honors a model's `ambientocclusion: false`. Inset and non-axis-aligned faces keep their existing shading. Partial boundary faces interpolate full-face corners; this does not reproduce exact vanilla shading for partial shapes. Light-emitting blocks are not automatically exempt. Block edits, visibility changes, and chunk loading or unloading refresh affected corners, including across section boundaries. Fluids, entities, and block entities are unchanged.

Enabling ambient occlusion adds work during placement and geometry updates, with no extra per-frame rendering pass. Keep it disabled when load or edit performance matters more than corner shading.

## Ownership and cleanup

Choose cleanup according to the resource you own:

| Resource | Cleanup behavior |
| --- | --- |
| Renderer | `stop()` pauses rendering and frame callbacks. `dispose()` permanently releases renderer-owned resources, clears subscriptions, and detaches scene objects. |
| Scene objects and worlds | Dispose objects you own when finished. Use `await world.clear()` to release a world's block handles, section meshes, and owned entities. Renderer disposal does not replace this cleanup. |
| Controls | Renderer-created controls are disposed with the renderer. Dispose caller-created controls yourself. |
| [SceneStatsDisplay](/api/index/classes/SceneStatsDisplay) | Call `dispose()` separately to remove its timer and DOM elements. |
| Shared library services | Call [shutdown](/api/index/functions/shutdown) only when all MineRender work is finished. It stops shared queues and timers and clears in-memory caches; request shutdown is permanent. |

Cached materials, textures, and geometry can be shared by several objects. Do not manually dispose a shared resource while another object still uses it.
