# MineRender V2

A TypeScript library for interactive Minecraft skins, models, blocks, entities, and worlds.
V2 is in alpha. See the [roadmap](https://github.com/InventivetalentDev/MineRender/blob/main/ROADMAP.md) for feature parity and remaining work.

Install the alpha package with its three.js peer:

```sh
yarn add minerender@alpha three@^0.158.0
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

For development, use Node.js 22+ and Yarn 4.5.3 through Corepack. Run `yarn install --immutable`, `yarn build`, `yarn typecheck`, and `yarn test`. See [AGENTS.md](./AGENTS.md) for contributor guidance.
