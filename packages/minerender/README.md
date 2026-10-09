# MineRender V2

A TypeScript library for interactive Minecraft skins, models, blocks, entities, and worlds.
V2 is in beta. See the [roadmap](https://github.com/InventivetalentDev/MineRender/blob/main/ROADMAP.md) for feature parity and remaining work.

Install the beta package with its three.js peer:

```sh
yarn add minerender@beta three@^0.186.1
```

In a browser application:

```ts
import { Renderer } from "minerender";

const renderer = new Renderer();
renderer.appendTo(document.body);
renderer.start();
```

The package provides ESM and CommonJS entries for browsers and Node.js, plus
`dist/bundle.js` for the `MineRender` browser global. Node imports require the optional
native `canvas` dependency; headless rendering is still in development.

Requires Node.js 22.12+ or a browser with WebGL 2, Fetch, `AbortSignal.any()`, and `AbortSignal.timeout()`.

## Resource-pack ZIPs

Register a browser `File` or `Blob` before loading models or textures:

```ts
import { ArchiveAssetSource, AssetLoader } from "minerender";

AssetLoader.setVersion("1.21.11");
AssetLoader.addSource("pack", ArchiveAssetSource.blob(resourcePackFile));
```

`ArchiveAssetSource` reads the root `pack.mcmeta` once. Matching overlays take
precedence in reverse declaration order, followed by the pack's base files.
Both legacy `formats` ranges and modern `min_format`/`max_format` ranges are
supported. A pack's `filter.block` rules suppress matching files in lower-priority
sources, including contributions to combined fonts; the pack's own files remain available.

Packs with overlays lazily resolve the selected Minecraft version's resource and
data pack formats from `https://assets.mcasset.cloud/<version>/game-version.json`.
[MCAsset-Downloader](https://github.com/InventivetalentDev/MCAsset-Downloader) extracts
this file unchanged from the official client JAR's root `version.json`.
For offline use, older JARs without this metadata, or versions not yet re-extracted,
pass explicit formats:

```ts
const pack = ArchiveAssetSource.blob(resourcePackFile, { resourcePackFormat: [75, 0] });
```

A number selects minor version zero. Use `dataPackFormat` separately for files
under `data/`. Packs without overlays make no version-metadata request. Missing
`pack.mcmeta` keeps plain archive loading; invalid metadata rejects the lookup.

Filter expressions use JavaScript regular expressions with substring matching.
Namespace and path matches can come from different rules, following vanilla's
filter behavior. Paths include the asset type and extension, such as
`textures/block/stone.png`. Java-only regular expression syntax is not supported.

## Independent asset configurations

Use an `AssetContext` to load different versions or resource packs concurrently:

```ts
import { AssetContext, AssetKey, ArchiveAssetSource, Renderer } from "minerender";

const assets = new AssetContext({
    version: "1.21.11",
    sources: [{ key: "pack", source: ArchiveAssetSource.blob(resourcePackFile) }]
});
const renderer = new Renderer({ assets });
const model = await renderer.assets.models.getMerged(AssetKey.parse("models", "block/stone"));
if (model) await renderer.scene.addModel(model);
```

Sources are ordered highest priority first, followed by vanilla and fallback assets.
Configure source objects before constructing the context. Its version and source
stack stay fixed; create another context and reload objects to change them.
Context-bound `blockStates`, `modelTextures`, `entities`, and `fonts` loaders use
the same configuration. Loaded assets retain their context when added to another
scene unless the object's `options.assets` explicitly overrides it. Objects created
from raw data inherit their scene's context when attached.
Worlds and scene documents inherit their scene's context.

Without an explicit context, renderers and static loaders use `AssetLoader`'s
global configuration. Global source changes affect future loads; in-flight loads
and existing objects retain their configuration. The previous global context's
in-memory entries are invalidated without clearing independent contexts. Use
`assets.clearCache()` to clear one context or `Caching.clear()` to clear all of them.
Disposing a renderer leaves
shared contexts and their cached assets available to other renderers.

## Load an editable scene

The web scene editor saves versioned JSON that the library can load directly:

```ts
import { AssetLoader, Renderer, SceneDocumentLoader } from "minerender";

const response = await fetch("./scene.json");
if (!response.ok) throw new Error("Could not fetch scene.json");
const definition = SceneDocumentLoader.parse(await response.json());
if (definition.minecraftVersion) AssetLoader.setVersion(definition.minecraftVersion);

const renderer = new Renderer({
    controls: { enabled: true },
    ...(definition.camera ? { camera: {
        position: definition.camera.position,
        lookingAt: definition.camera.target
    } } : {})
});
renderer.appendTo(document.body);
const scene = await SceneDocumentLoader.load(renderer.scene, definition);
const unsubscribe = renderer.onFrame(({ delta }) => scene.advanceAnimations(delta));
renderer.start();

// Release the scene when its view closes.
function dispose() {
    unsubscribe();
    scene.dispose();
    renderer.dispose();
}
```

A minimal document contains a format, schema version, and object definitions:

```json
{
  "format": "minerender-scene",
  "version": 1,
  "minecraftVersion": "1.21.11",
  "objects": [
    {
      "id": "stairs",
      "type": "block",
      "asset": "minecraft:oak_stairs",
      "state": { "facing": "east", "half": "bottom", "shape": "straight" },
      "position": [0, 0, 0],
      "rotation": [0, 0, 0]
    }
  ]
}
```

Supported object types are `skin`, `block`, `item`, `model`, `entity`, and `gui`.
Positions use model units (16 per block); JSON rotations use radians.

Callers apply the saved camera settings and select the matching asset version.
