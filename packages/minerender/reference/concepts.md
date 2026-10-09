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

World edits such as `setBlockAt`, `placeMultiBlock`, and `clear` also return promises. Await them before reading the resulting rendered state. A failed bulk placement can leave successfully placed blocks in the world; it is not a transaction that rolls back earlier placements.

## Redrawing after changes

[Renderer](/api/index/classes/Renderer) draws only when the scene is dirty, `render.renderAlways` is enabled, an `onFrame` subscription is active, or a video is recording. Calling `start()` runs this loop; it does not force an unchanged scene to redraw continuously.

MineRender setters such as `setPosition` notify the scene. When you change a three.js property directly, such as a named part's `rotation` or `visible`, call the owning [SceneObject](/api/index/classes/SceneObject)'s `notifyDirty()` or set `renderer.scene.dirty = true`. The loop draws the change on its next eligible frame.

Built-in controls created with `controls.enabled` handle redraw notifications. Register controls you create yourself with `renderer.registerEventDispatcher(...)` so their change events mark the renderer dirty.

For continuous animation, use `renderer.onFrame(...)`. Its synchronous callback runs before each draw and keeps rendering active. `render.fpsLimit` caps these draws; its default is `60`, and a nonpositive value disables the cap. The first callback after subscribing or restarting receives `delta: 0`. Call the returned unsubscribe function when the animation ends.

`renderer.toImage()` renders a fresh frame even while stopped. It does not call `onFrame` callbacks, so update the pose first when exporting a specific animation frame.

## Video export

Call `renderer.toVideo({ duration: 5, fps: 30 })` to record five seconds of the current scene, including running animations and camera movements. It returns a silent video `Blob`. The browser selects a supported WebM or MP4 encoder; use `blob.type` to choose the file extension. Set `mimeType` to request a specific supported format, or `videoBitsPerSecond` to request an encoding bitrate.

Recording runs in real time. Keep the tab visible; browser scheduling and `render.fpsLimit` can reduce the frame rate or affect duration. The video keeps the canvas's initial drawing-buffer dimensions, scales later resizes to fit, and fills transparent pixels with black. It does not trim frames or rewind animations.

Only one video can record per renderer. A stopped renderer starts for the recording and stops again afterward. Pass an `AbortSignal` as `signal` to cancel. Calling `stop()` or disposing the renderer also cancels the recording and rejects its promise. Calling `start()` while the renderer is running leaves the recording active.

## Objects and instance references

With model instancing enabled, scene methods can return an [InstanceReference](/api/index/classes/InstanceReference) instead of a separate model object. Use the reference's transform methods to change that placement. Changing the underlying shared object's transform can affect its other instances.

Calling `removeFromScene()` or `dispose()` on an instance reference releases its slot. A released reference rejects transform access; create another placement to obtain a usable reference.

With `sectionMeshing: true`, [MineRenderWorld](/api/index/classes/MineRenderWorld) merges eligible blocks into section meshes. A merged block has no individual `BlockInfo.object`. Edit it through the world or chunk setters so geometry and neighbor culling update together.

World placement selects weighted block models from absolute block coordinates, so unloading and reloading preserves their appearance in both rendering modes. Standalone `scene.addBlock` previews remain random unless you supply `variantPosition: [x, y, z]` in block units. The position is copied at construction; moving the object does not change its selection. The pick is vanilla-identical for the same coordinates and ordered weights. Position-based selection rejects total weights above 2,147,483,647.

## Streaming a Java world

Use a dedicated `MineRenderWorld` with `sectionMeshing: true` and a `WorldStreamer` to render nearby chunk columns. This example reads one dimension's `r.<x>.<z>.mca` files at region coordinates:

```ts
const source = new AnvilWorldSource(async (x, z, signal) => {
    const response = await fetch(`/world/region/r.${x}.${z}.mca`, { signal });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Region request failed: ${response.status}`);
    return response.arrayBuffer();
});
const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true });
const stream = new WorldStreamer(world, source, { loadRadius: 1, unloadRadius: 2 });
await stream.updatePosition(renderer.camera.position);
```

Call `updatePosition` after the camera or view center moves. It accepts scene units; `update(x, z)` accepts absolute chunk coordinates.

The streamer aborts obsolete reads and active reads during disposal. Source callbacks must forward the optional signal to cancellable I/O to stop that work.

Source errors appear in `failedChunks` while other columns continue loading. Call `await stream.retryFailedChunks()` to retry them. Placement or unloading failures reject the update.

Await `stream.dispose()` before editing or clearing the world; it unloads its columns and leaves the world and source caller-owned.

Java 1.13+ paletted chunks support gzip, zlib, and uncompressed payloads; pre-1.13 numeric chunks, LZ4, external `.mcc` payloads, and DataVersion migration remain unsupported.

## Ownership and cleanup

Choose cleanup according to the resource you own:

| Resource | Cleanup behavior |
| --- | --- |
| Renderer | `stop()` pauses rendering and frame callbacks. `dispose()` permanently releases renderer-owned resources, clears subscriptions, and detaches scene objects. |
| Scene objects and worlds | Dispose objects you own when finished. Use `await world.clear()` to release a world's block handles and section meshes. Renderer disposal does not replace this cleanup. |
| Controls | Renderer-created controls are disposed with the renderer. Dispose caller-created controls yourself. |
| [SceneStatsDisplay](/api/index/classes/SceneStatsDisplay) | Call `dispose()` separately to remove its timer and DOM elements. |
| Shared library services | Call [shutdown](/api/index/functions/shutdown) only when all MineRender work is finished. It stops shared queues and timers and clears in-memory caches; request shutdown is permanent. |

Cached materials, textures, and geometry can be shared by several objects. Do not manually dispose a shared resource while another object still uses it.
