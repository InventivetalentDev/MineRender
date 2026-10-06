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
