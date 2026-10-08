# Browser and Node.js

MineRender provides browser and Node.js package entries. Both expose the shared API; the Node entry also exports `NodeRenderer` for rendering PNGs without a browser DOM.

## Package imports

Import from `minerender` to let the package's export conditions select the environment. Browser bundlers select the browser build; Node selects the Node build. Each entry registers its environment provider before loading the shared API.

Use named imports with ESM:

```ts
import { AssetKey, Models } from "minerender";
```

CommonJS is also supported:

```js
const { AssetKey, Models } = require("minerender");
```

If your tool needs an explicit entry, use `minerender/browser` or `minerender/node`. Keep the entry consistent with the runtime; importing the browser entry in Node does not supply a DOM or WebGL context.

The script-tag build is `dist/bundle.js`, exposed by the package as `minerender/bundle`. It provides the browser global `MineRender` and includes three.js. Consumers of the ESM and CommonJS builds need the package's three.js peer dependency.

## Platform requirements

The supported environments have these requirements:

| Environment | Requirements |
| --- | --- |
| Browser | Fetch, `AbortSignal.any()`, and `AbortSignal.timeout()`. Interactive rendering also requires a DOM and WebGL 2. |
| Node.js | Node.js 22.12 or later, plus a working native `canvas` 3 installation. The Node entry imports `canvas`, even when the API you plan to call does not render an image. |

`canvas` is an optional package dependency so browser-only installs can omit its native build. It is required when importing the Node entry.

`NodeRenderer.create()` also requires the optional `gl` package, pinned to `9.0.0-rc.10` for its experimental WebGL 2 support. On headless Linux, provide Mesa, the Wayland client library (`libwayland-client0` on Debian/Ubuntu), and an X server such as Xvfb; see the [upstream system requirements](https://github.com/stackgl/headless-gl#system-dependencies) and [headless Linux setup](https://github.com/stackgl/headless-gl#how-can-headless-gl-be-used-on-a-headless-linux-machine).

Use separate Node processes for parallel native rendering. Loading `gl` in concurrent `worker_threads` can fail with `Module did not self-register`.

## Render a PNG in Node.js

Save this as `render.mjs` beside a Minecraft `skin.png`, then run `node render.mjs`. On headless Linux, run `xvfb-run -a node render.mjs` after installing the native dependencies.

```js
import { readFile, writeFile } from "node:fs/promises";
import { NodeRenderer, shutdown } from "minerender/node";

const renderer = await NodeRenderer.create({
    width: 256,
    height: 256,
    camera: {
        position: [40, 30, 60],
        lookingAt: [0, 16, 0]
    }
});
try {
    const skin = await readFile("skin.png");
    await renderer.scene.addSkin(`data:image/png;base64,${skin.toString("base64")}`);
    await writeFile("render.png", await renderer.renderToBuffer({ trim: true }));
} finally {
    renderer.dispose();
    shutdown();
}
```

`width` and `height` are positive integer logical dimensions. `render.pixelRatio` scales the output resolution; `resize(width, height)` updates both the camera and native drawing buffer. The native factory disables antialiasing and rejects `render.antialias: true`; increasing the pixel ratio produces a larger image without automatically downsampling it.

`renderToBuffer({ trim })` draws a fresh frame and returns a PNG `Buffer` with straight alpha. Trimming keeps every pixel with nonzero alpha; an empty image becomes one transparent pixel. `renderOnce()` draws without encoding. Neither method invokes `onFrame` callbacks or advances entity animation time. Set the entity animation time before capturing each frame.

Node renderers disable stats, automatic window resizing, and controls; explicitly enabling them throws. `start()` and `toImage()` are unsupported: use `renderOnce()` or `renderToBuffer()`. `dispose()` destroys factory-owned native contexts. `shutdown()` ends shared library services; call it only after all MineRender work is finished.

### Supply a WebGL 2 context

Use `new NodeRenderer(options, surface)` with a caller-owned `RendererSurface`, or pass the same surface as the second argument to `new Renderer(options, surface)`. A surface contains `canvas`, `context`, logical `width` and `height`, and an optional `resize(physicalWidth, physicalHeight)` callback for native drawing-buffer resizing. The canvas needs mutable dimensions and event-listener methods. The surface stays separate from the renderer options so its objects are not deep-merged.

For `NodeRenderer`, an injected context with alpha enabled must use `premultipliedAlpha: true` so PNG capture can restore straight alpha. Opaque contexts are also accepted. Disposal releases renderer-owned resources while retaining an injected canvas and context; the caller is responsible for destroying it. Supplying a context avoids loading `gl`; the Node entry still requires `canvas` for image decoding and texture preparation.

## Capability boundaries

Use the environment that supports the operation:

| Operation | Browser | Node.js |
| --- | --- | --- |
| Asset fetching, model processing, and NBT parsing | Supported | Supported with the Node entry |
| Image decoding and 2D texture preparation | Browser canvas and images | Native `canvas` |
| Single-frame rendering and PNG export | `Renderer.renderOnce()` and `toImage()` | `NodeRenderer.renderOnce()` and `renderToBuffer()` |
| Interactive `Renderer`, controls, inspector, and DOM displays | Supported | Requires a browser environment; the Node provider does not supply one |
| ZIP resource packs | [BrowserArchiveProxy](/api/index/classes/BrowserArchiveProxy) | No Node-specific archive proxy is provided |
| glTF and GLB export | Supported through [SceneExporter](/api/index/classes/SceneExporter) | Requires browser canvas and `FileReader` |
| Video export | `Renderer.toVideo()` requires canvas `captureStream()` and `MediaRecorder`; formats depend on the browser | Requires a browser environment |

`Renderer.toImage()` returns a data URL from its browser canvas. `NodeRenderer.renderToBuffer()` returns PNG bytes. DOM controls, displays, and glTF/GLB export remain browser-only; importing the Node build does not supply those browser APIs.

## Environment providers

[EnvProvider](/api/index/interfaces/EnvProvider) defines canvas creation, image creation, image-size probing, and persistent-cache access. [BrowserEnv](/api/index.browser/classes/BrowserEnv) and [NodeEnv](/api/index.node/classes/NodeEnv) implement those capabilities for their respective entries. You do not need to register either provider manually when importing the package.

Use [Env](/api/index/classes/Env) to register a custom provider only when embedding MineRender in another host. The provider interface does not inject a WebGL context, implement the DOM, or replace the renderer's animation loop.

Node processes can exit when MineRender is idle without calling `shutdown()`. For final application cleanup, see [ownership and cleanup](./concepts.md#ownership-and-cleanup).
