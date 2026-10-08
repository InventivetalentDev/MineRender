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
