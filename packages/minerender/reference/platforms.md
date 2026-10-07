# Browser and Node.js

MineRender provides browser and Node.js package entries. Both expose the shared API, but Node support does not include DOM-free `Renderer` construction or a render-to-buffer API.

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
| Node.js | Node.js 22.12 or later, plus a working native `canvas` installation. The Node entry imports `canvas`, even when the API you plan to call does not render an image. |

`canvas` is an optional package dependency so browser-only installs can omit its native build. It is required when importing the Node entry.

## Capability boundaries

Use the environment that supports the operation:

| Operation | Browser | Node.js |
| --- | --- | --- |
| Asset fetching, model processing, and NBT parsing | Supported | Supported with the Node entry |
| Image decoding and 2D texture preparation | Browser canvas and images | Native `canvas` |
| Interactive `Renderer`, controls, inspector, and DOM displays | Supported | Requires a browser environment; the Node provider does not supply one |
| ZIP resource packs | [BrowserArchiveProxy](/api/index/classes/BrowserArchiveProxy) | No Node-specific archive proxy is provided |
| glTF and GLB export | Supported through [SceneExporter](/api/index/classes/SceneExporter) | Requires browser canvas and `FileReader` |

`Renderer.toImage()` returns a data URL from its browser canvas. It does not provide a Node `Buffer` result. Importing the Node build makes the shared APIs available; it does not make every exported class usable without a browser.

## Environment providers

[EnvProvider](/api/index/interfaces/EnvProvider) defines canvas creation, image creation, image-size probing, and persistent-cache access. [BrowserEnv](/api/index.browser/classes/BrowserEnv) and [NodeEnv](/api/index.node/classes/NodeEnv) implement those capabilities for their respective entries. You do not need to register either provider manually when importing the package.

Use [Env](/api/index/classes/Env) to register a custom provider only when embedding MineRender in another host. The provider interface does not inject a WebGL context, implement the DOM, or replace the renderer's animation loop.

Node processes can exit when MineRender is idle without calling `shutdown()`. For final application cleanup, see [ownership and cleanup](./concepts.md#ownership-and-cleanup).
